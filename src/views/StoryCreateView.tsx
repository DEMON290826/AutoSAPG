import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Database, FolderPlus, LoaderCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { analyzeStoryWithBeeApi } from "../dna/analysisApi";
import { isLocalDnaPersistenceAvailable, saveStoryDnaToLibrary } from "../dna/dnaStorage";
import type { StoryCreateMode, StoryFileType, StorySourceStatus } from "../dna/analysisTypes";
import type { DnaEntry } from "../dna/types";
import type { ModelRegistryItem } from "../types/appSettings";
import { readJsonStorage, writeJsonStorage } from "../utils/localState";
import { recordMetric } from "../utils/metrics";

type StorySourceRow = {
  id: string;
  title: string;
  content: string;
  sourceSizeBytes: number;
  charCount: number;
  fileType: StoryFileType;
  createMode: StoryCreateMode;
  authorName: string;
  sourcePath: string;
  status: StorySourceStatus;
  statusDetail: string;
  mainGenre: string;
  mainStyle: string;
  score: number | null;
  dnaSaved: boolean;
  dnaId: string;
  dnaDirectory: string;
  summary: string;
  errorMessage: string;
};

type Props = {
  onSavedEntry: (entry: DnaEntry) => void;
  apiKey: string;
  apiUrl: string;
  dnaStoragePath: string;
  models: ModelRegistryItem[];
  selectedVendor: string;
  selectedModel: string;
  batchSize: number;
  onSelectVendor: (vendor: string) => void;
  onSelectModel: (model: string) => void;
};

type PersistedCreatorState = {
  sources: StorySourceRow[];
  selectedSourceIds: string[];
  selectedSourceId: string;
  authorNameDraft: string;
  libraryDir: string;
};

const viNumber = new Intl.NumberFormat("vi-VN");
const utf8Encoder = new TextEncoder();

function storyStatusLabel(status: StorySourceStatus): string {
  if (status === "dang_cho") return "Đang chờ";
  if (status === "dang_chay") return "Đang chạy";
  if (status === "xong") return "Xong";
  return "Lỗi";
}

function storyStatusDetail(status: StorySourceStatus, source: Pick<StorySourceRow, "statusDetail" | "errorMessage" | "dnaId">): string {
  if (source.statusDetail?.trim()) return source.statusDetail.trim();
  if (status === "dang_cho") return "Chờ phân tích DNA";
  if (status === "dang_chay") return "Đang tạo DNA từ truyện nguồn";
  if (status === "xong") return source.dnaId ? `Hoàn tất và đã lưu ${source.dnaId}` : "Hoàn tất tạo DNA";
  return source.errorMessage?.trim() || "Lỗi khi tạo DNA";
}

function modeLabel(mode: StoryCreateMode, authorName: string): string {
  if (mode === "tac_gia") return authorName ? `Tác giả (${authorName})` : "Tác giả";
  return "Tự phân tích";
}

function fileTypeLabel(type: StoryFileType): string {
  return type === "word" ? "Word" : "TXT";
}

function detectFileType(fileName: string): StoryFileType {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return ext === "doc" || ext === "docx" ? "word" : "txt";
}

function isReadableStoryFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return ["txt", "md", "json", "doc", "docx"].includes(ext);
}

function getTitleFromFileName(fileName: string): string {
  const parts = fileName.split(".");
  if (parts.length <= 1) return fileName;
  parts.pop();
  return parts.join(".").trim() || fileName;
}

function normalizeFileContent(raw: string): string {
  return raw.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeSourcePath(pathValue: string): string {
  return String(pathValue ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
}

function buildSourceIdentityKey(sourcePath: string, fallbackFileName: string): string {
  const normalizedPath = normalizeSourcePath(sourcePath);
  if (normalizedPath) return normalizedPath;
  return normalizeSourcePath(fallbackFileName);
}

function estimateUtf8Bytes(value: string): number {
  return utf8Encoder.encode(value).length;
}

function formatSourceSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${viNumber.format(Math.round(bytes))} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatCharacterCount(count: number): string {
  const safe = Number.isFinite(count) && count >= 0 ? Math.round(count) : 0;
  return `${viNumber.format(safe)} ký tự`;
}

function formatCategoryName(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const map: Record<string, string> = {
    truyen_ma: "Truyện ma",
    nosleep: "NoSleep",
    creepypasta: "Creepypasta",
  };
  if (map[normalized]) return map[normalized];
  return normalized
    .split("_")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function normalizePersistedSource(source: StorySourceRow): StorySourceRow {
  const content = typeof source.content === "string" ? source.content : "";
  const charCount = Number.isFinite(source.charCount) && source.charCount > 0 ? source.charCount : content.length;
  const sourceSizeBytes = Number.isFinite(source.sourceSizeBytes) && source.sourceSizeBytes > 0 ? source.sourceSizeBytes : estimateUtf8Bytes(content);

  return {
    ...source,
    content,
    charCount,
    sourceSizeBytes,
    mainGenre: formatCategoryName(source.mainGenre),
    statusDetail: source.statusDetail?.trim() || storyStatusDetail(source.status, source),
  };
}

async function readWordFile(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "doc") {
    throw new Error("File .doc chưa hỗ trợ đọc trực tiếp. Hãy lưu sang .docx hoặc .txt.");
  }

  const mammoth = (await import("mammoth/mammoth.browser")) as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value?: string }>;
  };

  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const content = normalizeFileContent(result.value ?? "");
    if (!content) {
      throw new Error("File Word không có nội dung đọc được.");
    }
    return content;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error ?? "");
    const normalizedMessage = rawMessage.toLowerCase();
    if (normalizedMessage.includes("end of data reached") || normalizedMessage.includes("corrupted") || normalizedMessage.includes("zip")) {
      throw new Error("File .docx bị lỗi hoặc không đúng định dạng. Hãy mở bằng Word rồi Save As lại .docx, hoặc chuyển sang .txt.");
    }
    throw new Error(`Không đọc được file Word: ${rawMessage}`);
  }
}

async function readStoryFile(file: File): Promise<string> {
  const type = detectFileType(file.name);
  const content = type === "word" ? await readWordFile(file) : normalizeFileContent(await file.text());
  if (!content) throw new Error("File không có nội dung đọc được.");
  if (content.length < 40) throw new Error("Nội dung file quá ngắn để phân tích.");
  return content;
}

export function StoryCreateView({ onSavedEntry, apiKey, apiUrl, dnaStoragePath, models, selectedVendor, selectedModel, batchSize, onSelectVendor, onSelectModel }: Props) {
  const persistedStateRef = useRef<PersistedCreatorState | null>(readJsonStorage<PersistedCreatorState | null>("creator.state", null));
  const persistedState = persistedStateRef.current;

  const [sources, setSources] = useState<StorySourceRow[]>(() => (persistedState?.sources ?? []).map(normalizePersistedSource));
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() => persistedState?.selectedSourceIds ?? []);
  const [selectedSourceId, setSelectedSourceId] = useState(() => persistedState?.selectedSourceId ?? "");
  const [openAuthorModal, setOpenAuthorModal] = useState(false);
  const [authorNameDraft, setAuthorNameDraft] = useState(() => persistedState?.authorNameDraft ?? "");
  const [pendingAuthorName, setPendingAuthorName] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeMessage, setAnalyzeMessage] = useState("");
  const [libraryDir, setLibraryDir] = useState(() => persistedState?.libraryDir ?? "");
  const [analysisDone, setAnalysisDone] = useState(0);
  const [analysisTotal, setAnalysisTotal] = useState(0);
  const [analysisCurrentTitle, setAnalysisCurrentTitle] = useState("");

  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const authorFolderInputRef = useRef<HTMLInputElement>(null);

  const allSourceSelected = sources.length > 0 && selectedSourceIds.length === sources.length;
  const selectedSources = sources.filter((source) => selectedSourceIds.includes(source.id));
  const runningCount = sources.filter((source) => source.status === "dang_chay").length;
  const pendingCount = sources.filter((source) => source.status === "dang_cho").length;
  const doneCount = sources.filter((source) => source.status === "xong").length;
  const errorCount = sources.filter((source) => source.status === "loi").length;
  const vendors = useMemo(() => Array.from(new Set(models.map((item) => item.vendor))).sort((a, b) => a.localeCompare(b, "vi")), [models]);
  const modelsByVendor = useMemo(
    () =>
      models
        .filter((item) => item.vendor === selectedVendor)
        .map((item) => item.model)
        .sort((a, b) => a.localeCompare(b, "vi")),
    [models, selectedVendor],
  );
  const vendorOptions = useMemo(() => [{ value: "", label: "Chọn hãng" }, ...vendors.map((vendor) => ({ value: vendor, label: vendor }))], [vendors]);
  const modelOptions = useMemo(() => {
    if (!selectedVendor) return [{ value: "", label: "Chọn hãng trước", disabled: true }];
    return [{ value: "", label: "Chọn model" }, ...modelsByVendor.map((model) => ({ value: model, label: model }))];
  }, [selectedVendor, modelsByVendor]);

  useEffect(() => {
    if (authorFolderInputRef.current) {
      authorFolderInputRef.current.setAttribute("webkitdirectory", "");
      authorFolderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    writeJsonStorage<PersistedCreatorState>("creator.state", {
      sources,
      selectedSourceIds,
      selectedSourceId,
      authorNameDraft,
      libraryDir,
    });
  }, [sources, selectedSourceIds, selectedSourceId, authorNameDraft, libraryDir]);

  useEffect(() => {
    if (!sources.length) {
      setSelectedSourceId("");
      return;
    }
    if (!sources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(sources[0].id);
    }
  }, [sources, selectedSourceId]);

  const importFiles = async (fileList: FileList | null, createMode: StoryCreateMode, authorName = ""): Promise<void> => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const addedRows: StorySourceRow[] = [];
    const errors: string[] = [];
    const existingKeys = new Set(
      sources.map((source) => buildSourceIdentityKey(source.sourcePath || source.title, source.title)),
    );
    let duplicateCount = 0;

    for (const file of files) {
      if (!isReadableStoryFile(file.name)) continue;
      const fileWithPath = file as File & { path?: string };
      const sourcePath = fileWithPath.path || file.name;
      const identityKey = buildSourceIdentityKey(sourcePath, file.name);
      if (existingKeys.has(identityKey)) {
        duplicateCount += 1;
        continue;
      }
      existingKeys.add(identityKey);
      try {
        const content = await readStoryFile(file);

        addedRows.push({
          id: `story_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
          title: getTitleFromFileName(file.name),
          content,
          sourceSizeBytes: file.size > 0 ? file.size : estimateUtf8Bytes(content),
          charCount: content.length,
          fileType: detectFileType(file.name),
          createMode,
          authorName: createMode === "tac_gia" ? authorName : "",
          sourcePath,
          status: "dang_cho",
          statusDetail: "Chờ phân tích DNA",
          mainGenre: "",
          mainStyle: "",
          score: null,
          dnaSaved: false,
          dnaId: "",
          dnaDirectory: "",
          summary: "",
          errorMessage: "",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Không đọc được file.";
        errors.push(`${file.name}: ${message}`);
      }
    }

    if (addedRows.length) {
      setSources((prev) => [...addedRows, ...prev]);
      setSelectedSourceId(addedRows[0].id);
    }
    const messages: string[] = [];
    if (addedRows.length) messages.push(`Đã nạp ${addedRows.length} truyện mới từ máy.`);
    if (duplicateCount > 0) messages.push(`Bỏ qua ${duplicateCount} truyện đã có sẵn trong bảng.`);
    if (errors.length) messages.push(errors.slice(0, 3).join(" | "));
    if (messages.length) setAnalyzeMessage(messages.join(" "));
  };

  const handlePickSourceFiles = () => sourceFileInputRef.current?.click();

  const handlePickAuthorFolder = () => {
    const cleanAuthorName = authorNameDraft.trim();
    if (!cleanAuthorName) {
      setAnalyzeMessage("Bạn cần nhập tên tác giả trước khi chọn thư mục.");
      return;
    }
    setPendingAuthorName(cleanAuthorName);
    authorFolderInputRef.current?.click();
  };

  const handleSourceFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await importFiles(event.target.files, "tu_phan_tich");
    event.target.value = "";
  };

  const handleAuthorFolderInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await importFiles(event.target.files, "tac_gia", pendingAuthorName);
    event.target.value = "";
    setOpenAuthorModal(false);
  };

  const toggleSource = (id: string, checked: boolean) => {
    setSelectedSourceIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((item) => item !== id)));
  };

  const toggleAllSources = (checked: boolean) => {
    if (checked) setSelectedSourceIds(sources.map((source) => source.id));
    else setSelectedSourceIds([]);
  };

  const cleanupSelected = () => {
    if (isAnalyzing) return;
    if (!selectedSourceIds.length) {
      setAnalyzeMessage("Chưa có dòng nào được chọn để dọn dẹp.");
      return;
    }
    const selectedSet = new Set(selectedSourceIds);
    setSources((prev) => prev.filter((item) => !selectedSet.has(item.id)));
    setSelectedSourceIds([]);
    setAnalyzeMessage("Đã dọn dẹp các dòng đã chọn. DNA đã lưu vẫn giữ nguyên.");
  };

  const cleanupAll = () => {
    if (isAnalyzing) return;
    if (!sources.length) return;
    const ok = window.confirm("Dọn toàn bộ danh sách nguồn trong màn hình này? DNA đã lưu trên ổ đĩa sẽ không bị xóa.");
    if (!ok) return;
    setSources([]);
    setSelectedSourceIds([]);
    setSelectedSourceId("");
    setAnalyzeMessage("Đã dọn toàn bộ danh sách nguồn. DNA đã lưu vẫn giữ nguyên.");
  };

  const cleanupByStatus = (status: StorySourceStatus, label: string) => {
    if (isAnalyzing) return;
    const matched = sources.filter((item) => item.status === status);
    if (!matched.length) {
      setAnalyzeMessage(`Không có dòng ${label} để dọn.`);
      return;
    }
    const idSet = new Set(matched.map((item) => item.id));
    setSources((prev) => prev.filter((item) => !idSet.has(item.id)));
    setSelectedSourceIds((prev) => prev.filter((id) => !idSet.has(id)));
    setAnalyzeMessage(`Đã dọn ${matched.length} dòng ${label}. DNA đã lưu vẫn giữ nguyên.`);
  };

  const analyzeOneSource = async (source: StorySourceRow): Promise<void> => {
    setAnalysisCurrentTitle(source.title);
    setSources((prev) =>
      prev.map((item) =>
        item.id === source.id
          ? {
              ...item,
              status: "dang_chay",
              statusDetail: "Đang tạo DNA từ truyện nguồn...",
              errorMessage: "",
            }
          : item,
      ),
    );

    try {
      const analysis = await analyzeStoryWithBeeApi({
        apiKey,
        apiUrl,
        model: selectedModel,
        input: { title: source.title, content: source.content, createMode: source.createMode },
      });

      setSources((prev) =>
        prev.map((item) =>
          item.id === source.id
            ? {
                ...item,
                status: "dang_chay",
                statusDetail: "Đang lưu DNA vào thư viện...",
              }
            : item,
        ),
      );

      const saveResult = saveStoryDnaToLibrary({
        title: source.title,
        storyContent: source.content,
        createMode: source.createMode,
        fileType: source.fileType,
        authorName: source.authorName,
        sourcePath: source.sourcePath,
        storageDir: dnaStoragePath,
        analysis,
      });
      recordMetric("dna_created", 1);

      setLibraryDir(saveResult.baseDir);
      onSavedEntry(saveResult.entry);
      setSources((prev) =>
        prev.map((item) =>
          item.id === source.id
            ? {
                ...item,
                status: "xong",
                statusDetail: `Hoàn tất tạo DNA (${saveResult.entry.dna_id})`,
                mainGenre: formatCategoryName(saveResult.entry.category),
                mainStyle: analysis.main_style,
                score: analysis.score_report.overall_score.score,
                dnaSaved: true,
                dnaId: saveResult.entry.dna_id,
                dnaDirectory: saveResult.dnaDirectory,
                summary: analysis.story_summary,
                errorMessage: "",
              }
            : item,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      setSources((prev) =>
        prev.map((item) =>
          item.id === source.id
            ? {
                ...item,
                status: "loi",
                statusDetail: `Lỗi: ${message.slice(0, 88)}`,
                errorMessage: message,
              }
            : item,
        ),
      );
      setAnalyzeMessage(`Phân tích thất bại: ${source.title}. ${message}`);
    } finally {
      setAnalysisDone((prev) => prev + 1);
    }
  };

  const runAnalyze = async () => {
    if (isAnalyzing) return;
    const queueCandidates = selectedSources.length ? selectedSources : sources.filter((source) => source.status === "dang_cho");
    if (!queueCandidates.length) {
      setAnalyzeMessage("Không có truyện đang chờ để phân tích.");
      return;
    }
    if (!apiKey.trim()) {
      setAnalyzeMessage("Thiếu khóa API Bee.");
      return;
    }
    if (!apiUrl.trim()) {
      setAnalyzeMessage("Thiếu địa chỉ API.");
      return;
    }
    if (!selectedModel.trim()) {
      setAnalyzeMessage("Thiếu model đã chọn trong mục Model.");
      return;
    }

    const queue = [...queueCandidates];
    const queueIds = new Set(queue.map((item) => item.id));
    const parallel = Math.min(5, Math.max(1, Math.round(batchSize || 1)), queue.length);

    setAnalyzeMessage("");
    setIsAnalyzing(true);
    setAnalysisDone(0);
    setAnalysisTotal(queue.length);
    setAnalysisCurrentTitle(queue[0]?.title ?? "");
    setSelectedSourceIds((prev) => prev.filter((id) => !queueIds.has(id)));
    setAnalyzeMessage(`Đã bắt đầu phân tích ${queue.length} truyện với batch ${parallel}.`);

    let cursor = 0;
    const workers = Array.from({ length: parallel }, async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= queue.length) return;
        await analyzeOneSource(queue[currentIndex]);
      }
    });

    await Promise.all(workers);
    setIsAnalyzing(false);
    setAnalysisCurrentTitle("");
  };

  return (
    <section className="story-create-view minimal-create-view">
      <header className="story-head">
        <div>
          <p className="breadcrumb">Auto Stories &gt; Tạo DNA</p>
          <h1>Tạo DNA từ truyện nguồn</h1>
        </div>
        <div className="story-head-actions">
          <button type="button" className="ghost-btn" onClick={handlePickSourceFiles}>
            <Plus size={14} />
            Thêm truyện nguồn
          </button>
          <button type="button" className="ghost-btn" onClick={() => setOpenAuthorModal(true)}>
            <FolderPlus size={14} />
            Folder tác giả
          </button>
          <button type="button" className="ghost-btn" onClick={cleanupSelected} disabled={isAnalyzing || !selectedSourceIds.length}>
            <Trash2 size={14} />
            Dọn đã chọn
          </button>
          <button type="button" className="ghost-btn" onClick={cleanupAll} disabled={isAnalyzing || !sources.length}>
            <Trash2 size={14} />
            Dọn tất cả
          </button>
          <button type="button" className={`primary-btn ${isAnalyzing ? "is-disabled" : ""}`} onClick={runAnalyze} disabled={isAnalyzing}>
            {isAnalyzing ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
            {isAnalyzing ? "Đang phân tích..." : "Phân tích đã chọn"}
          </button>
        </div>
      </header>

      <input ref={sourceFileInputRef} type="file" multiple accept=".txt,.md,.json,.doc,.docx" style={{ display: "none" }} onChange={handleSourceFileInputChange} />
      <input ref={authorFolderInputRef} type="file" multiple style={{ display: "none" }} onChange={handleAuthorFolderInputChange} />

      <div className="api-runtime-strip">
        <span>API: {apiUrl || "-"}</span>
        <span>Model: {selectedModel || "Chưa chọn model"}</span>
        <span>Batch: {Math.min(5, Math.max(1, Math.round(batchSize || 1)))}</span>
        <span>Key DNA: {apiKey ? "Đã cấu hình" : "Chưa cấu hình"}</span>
        <span>Lưu DNA: {dnaStoragePath.trim() || "Mặc định (Documents/DNA_Library)"}</span>
      </div>

      <div className="runtime-model-grid">
        <label>
          Hãng AI
          <CustomSelect value={selectedVendor} options={vendorOptions} onChange={onSelectVendor} placeholder="Chọn hãng" className="settings-custom-select" />
        </label>
        <label>
          Model
          <CustomSelect
            value={selectedModel}
            options={modelOptions}
            onChange={onSelectModel}
            placeholder={selectedVendor ? "Chọn model" : "Chọn hãng trước"}
            disabled={!selectedVendor}
            className="settings-custom-select"
          />
        </label>
      </div>

      <div className="story-hints">
        <span>{selectedSourceIds.length} truyện đã chọn</span>
        <span>{isLocalDnaPersistenceAvailable() ? "Lưu cục bộ: sẵn sàng" : "Lưu cục bộ: chỉ chạy trong Electron"}</span>
        {libraryDir ? <span>Thư mục DNA: {libraryDir}</span> : null}
      </div>

      {isAnalyzing ? (
        <div className="analysis-progress">
          <LoaderCircle size={15} className="spin" />
          <span>
            Đang chạy {runningCount} luồng | Hoàn tất {analysisDone}/{analysisTotal}
            {analysisCurrentTitle ? `: ${analysisCurrentTitle}` : ""}
          </span>
        </div>
      ) : null}

      {analyzeMessage ? <p className="story-message">{analyzeMessage}</p> : null}

      <section className="story-table-card story-table-only">
        <div className="story-table-toolbar">
          <button type="button" className="ghost-btn compact" onClick={() => cleanupByStatus("dang_cho", "đang chờ")} disabled={isAnalyzing || !pendingCount}>
            <Clock3 size={14} />
            Dọn đang chờ
          </button>
          <button type="button" className="ghost-btn compact" onClick={() => cleanupByStatus("xong", "đã xong")} disabled={isAnalyzing || !doneCount}>
            <CheckCircle2 size={14} />
            Dọn đã xong
          </button>
          <button type="button" className="ghost-btn compact" onClick={() => cleanupByStatus("loi", "lỗi")} disabled={isAnalyzing || !errorCount}>
            <AlertTriangle size={14} />
            Dọn lỗi
          </button>
          <button type="button" className="ghost-btn compact" onClick={cleanupSelected} disabled={isAnalyzing || !selectedSourceIds.length}>
            <Trash2 size={14} />
            Dọn đã chọn
          </button>
          <button type="button" className="ghost-btn compact" onClick={cleanupAll} disabled={isAnalyzing || !sources.length}>
            <Trash2 size={14} />
            Dọn tất cả
          </button>
        </div>
        <div className="story-table-wrap">
          <table className="story-table">
            <thead>
              <tr>
                <th className="center">
                  <input type="checkbox" checked={allSourceSelected} onChange={(event) => toggleAllSources(event.target.checked)} />
                </th>
                <th>STT</th>
                <th>Tên truyện</th>
                <th>Dung lượng / ký tự</th>
                <th>Loại tệp</th>
                <th>Kiểu tạo</th>
                <th>Trạng thái</th>
                <th>Thể loại</th>
                <th>Phong cách</th>
                <th>Điểm</th>
                <th>DNA</th>
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <div className="empty-state">
                      <Database size={22} />
                      <p>Chưa có truyện nguồn. Hãy chọn file từ máy để bắt đầu.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                sources.map((source, index) => (
                  <tr key={source.id} className={selectedSourceId === source.id ? "active" : ""} onClick={() => setSelectedSourceId(source.id)}>
                    <td className="center" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selectedSourceIds.includes(source.id)} onChange={(event) => toggleSource(source.id, event.target.checked)} />
                    </td>
                    <td>{index + 1}</td>
                    <td>
                      <div className="story-title-cell">
                        <strong>{source.title}</strong>
                        <small>{source.sourcePath || source.dnaId || "Chưa có DNA ID"}</small>
                      </div>
                    </td>
                    <td>
                      <div className="story-size-cell">
                        <strong>{formatSourceSize(source.sourceSizeBytes)}</strong>
                        <small>{formatCharacterCount(source.charCount)}</small>
                      </div>
                    </td>
                    <td>{fileTypeLabel(source.fileType)}</td>
                    <td>{modeLabel(source.createMode, source.authorName)}</td>
                    <td>
                      <div className="story-status-cell">
                        <span className={`story-status ${source.status}`}>{storyStatusLabel(source.status)}</span>
                        <small>{storyStatusDetail(source.status, source)}</small>
                      </div>
                    </td>
                    <td>{source.mainGenre || "-"}</td>
                    <td>{source.mainStyle || "-"}</td>
                    <td>{source.score !== null ? source.score.toFixed(1) : "-"}</td>
                    <td>
                      <span className={`dna-chip ${source.dnaSaved ? "saved" : "unsaved"}`}>{source.dnaSaved ? "Đã lưu" : "Chưa lưu"}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {openAuthorModal ? (
        <div className="modal-backdrop" onClick={() => setOpenAuthorModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>Nhập folder tác giả</h3>
              <button type="button" className="icon-square" onClick={() => setOpenAuthorModal(false)}>
                <X size={14} />
              </button>
            </header>
            <label>
              Tên tác giả
              <input value={authorNameDraft} onChange={(event) => setAuthorNameDraft(event.target.value)} placeholder="Ví dụ: Nguyễn Văn A" />
            </label>
            <footer>
              <button type="button" className="ghost-btn" onClick={() => setOpenAuthorModal(false)}>
                Hủy
              </button>
              <button type="button" className="primary-btn" onClick={handlePickAuthorFolder}>
                <FolderPlus size={15} />
                Chọn thư mục tác giả
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
