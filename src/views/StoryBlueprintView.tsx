import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Copy, Database, FileText, FolderOpen, LoaderCircle, Plus, Settings2, Sparkles, X, XCircle } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { generateStoryBlueprintWithBrowser, type BlueprintDnaSource, type StoryBlueprintResult } from "../dna/blueprintApi";
import { getSortedCategoryKeys, loadCategoryEntries, normalizeText } from "../dna/libraryService";
import { canSaveStoryProject, saveStoryProject } from "../dna/storyStorage";
import { isLocalDnaPersistenceAvailable, saveStoryDnaToLibrary, readFullDnaPayload } from "../dna/dnaStorage";
import type { StoryFactorDefinition } from "../dna/storyFactors";
import {
  generateStoryDraftWithBrowserWriter,
  parseStoryCreationRequest,
  pickActiveFactors,
  reviewStoryDraftWithBeeApi,
  reviewStoryDraftWithBrowserWriter,
  toStoryDnaSources,
  type StoryCreationRequest,
  type StoryReviewResult,
} from "../dna/storyWriterApi";
import type { DnaEntry } from "../dna/types";
import type { ModelRegistryItem } from "../types/appSettings";
import {
  closeBrowserWriterSession,
  startBrowserWriterSession,
  closeBrowserAllSessions,
  getBrowserWriterSessionCount,
} from "../utils/electronBridge";
import { readJsonStorage, writeJsonStorage } from "../utils/localState";
import { recordMetric } from "../utils/metrics";
import { openPathInExplorer } from "../utils/openPath";

type Props = {
  manualEntries: DnaEntry[];
  storyApiKeys: string;
  apiUrl: string;
  storyStoragePath: string;
  storyCookieJsonPath: string;
  storyWriterChatUrl: string;
  models: ModelRegistryItem[];
  reviewerVendor: string;
  reviewerModel: string;
  useStoryReviewer: boolean;
  batchSize: number;
  factors: StoryFactorDefinition[];
  maxRetries: number;
  retryDelay: number;
  onSelectReviewerVendor: (vendor: string) => void;
  onSelectReviewerModel: (model: string) => void;
  onToggleReviewer: (value: boolean) => void;
};

type StoryBuildJobStatus = "dang_cho" | "dang_chay" | "xong" | "loi";

type StoryBuildJob = {
  id: string;
  request: StoryCreationRequest;
  request_raw: string;
  matched_dna_ids: string[];
  active_factor_keys: string[];
  status: StoryBuildJobStatus;
  statusDetail: string;
  message: string;
  output_directory: string;
  output_json: string;
  reviewer_result: StoryReviewResult | null;
  created_at: string;
  updated_at: string;
};

type PersistedStoryBuildState = {
  jsonInput: string;
  jobs: StoryBuildJob[];
  selectedJobIds: string[];
  activeJobId: string;
};

type StoryOutputSummary = {
  hasStory: boolean;
  chapterCount: number;
  totalChars: number;
  previewText: string;
  isTruncated: boolean;
};

const sampleJsonInput = `{
  "story_title": "Dem Thu Ba Sau Canh Cua",
  "genre": "truyen_ma",
  "styles": ["quy_tac", "nhat_ky"],
  "length_mode": "total_words",
  "total_words": 35000,
  "avg_words_per_chapter": 5000,
  "story_language": "tieng_viet",
  "character_name_language": "tieng_anh",
  "target_intensity": "cao",
  "ending_type": "du_am_bat_an",
  "extra_prompt": "Khong khi am u, co lap, mua dem, am thanh go cua luc 3h13 sang.",
  "yeu_to_dien_anh": true
}`;

const statusLabelMap: Record<StoryBuildJobStatus, string> = {
  dang_cho: "Đang chờ",
  dang_chay: "Đang chạy",
  xong: "Xong",
  loi: "Lỗi",
};

function statusDefaultDetail(status: StoryBuildJobStatus): string {
  if (status === "dang_cho") return "Chờ bắt đầu tạo truyện";
  if (status === "dang_chay") return "Đang xử lý";
  if (status === "xong") return "Hoàn tất";
  return "Có lỗi";
}

function toBlueprintSource(entry: DnaEntry): BlueprintDnaSource {
  return {
    dna_id: entry.dna_id,
    title: entry.title,
    category: entry.category,
    sub_category: entry.sub_category,
    styles: entry.styles,
    tags: entry.tags,
    score: Number(entry.scores.overall.toFixed(2)),
  };
}

function calcChapterCount(request: StoryCreationRequest): number {
  const avg = Math.max(1000, Math.min(5000, Math.round(request.avg_words_per_chapter || 5000)));
  const total = Math.max(3000, Math.min(50000, Math.round(request.total_words || 35000)));
  return Math.max(1, Math.min(30, Math.ceil(total / avg)));
}

const STORY_MATCH_LIMIT = 1;

function tokenizeNormalized(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const tokens = normalized
    .split(/[^a-z0-9_]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return Array.from(new Set(tokens));
}

function countOverlap(tokens: string[], tokenSet: Set<string>): number {
  let total = 0;
  tokens.forEach((token) => {
    if (tokenSet.has(token)) total += 1;
  });
  return total;
}

function rankDnaMatch(entry: DnaEntry, request: StoryCreationRequest): { relatedScore: number; isRelated: boolean } {
  const requestStyleTokens = tokenizeNormalized(request.styles.join(" "));
  const requestTitleTokens = tokenizeNormalized(request.story_title);
  const requestPromptTokens = tokenizeNormalized(request.extra_prompt);

  const category = normalizeText(entry.category);
  const subCategory = normalizeText(entry.sub_category);
  const styleTerms = entry.styles.map((style) => normalizeText(style));
  const tagTerms = entry.tags.map((tag) => normalizeText(tag));
  const titleTerm = normalizeText(entry.title);

  const entryJoined = [category, subCategory, ...styleTerms, ...tagTerms, titleTerm].join(" ");
  const entryTokenSet = new Set(tokenizeNormalized(entryJoined));

  const requestGenre = normalizeText(request.genre);
  const requestGenreTokens = tokenizeNormalized(request.genre);
  const requestStyleTerms = request.styles.map((style) => normalizeText(style));

  const categoryExact = Boolean(requestGenre) && (category === requestGenre || subCategory === requestGenre);
  const categoryContains = Boolean(requestGenre) && !categoryExact && entryJoined.includes(requestGenre);
  const stylePhraseHits = requestStyleTerms.reduce((hits, needle) => hits + (needle && entryJoined.includes(needle) ? 1 : 0), 0);
  const genreTokenHits = countOverlap(requestGenreTokens, entryTokenSet);
  const styleTokenHits = countOverlap(requestStyleTokens, entryTokenSet);
  const titleTokenHits = countOverlap(requestTitleTokens, entryTokenSet);
  const promptTokenHits = countOverlap(requestPromptTokens, entryTokenSet);

  const isRelated = categoryExact || categoryContains || stylePhraseHits > 0 || genreTokenHits > 0 || styleTokenHits > 0 || titleTokenHits > 1 || promptTokenHits > 2;

  const relatedScore =
    entry.scores.overall * 12 +
    (categoryExact ? 520 : 0) +
    (categoryContains ? 220 : 0) +
    stylePhraseHits * 95 +
    genreTokenHits * 50 +
    styleTokenHits * 34 +
    titleTokenHits * 42 +
    promptTokenHits * 28 +
    tagTerms.length * 0.12;

  return { relatedScore, isRelated };
}

function pickMatchedDnaIds(request: StoryCreationRequest, sourcePool: DnaEntry[]): string[] {
  const ranked = sourcePool
    .map((entry) => {
      const match = rankDnaMatch(entry, request);
      return {
        entry,
        relatedScore: match.relatedScore,
        isRelated: match.isRelated,
        qualityScore: entry.scores.overall,
      };
    })
    .sort((left, right) => right.relatedScore - left.relatedScore);

  const relatedRanked = ranked.filter((item) => item.isRelated);
  const qualityRanked = [...ranked].sort((left, right) => {
    if (right.qualityScore !== left.qualityScore) return right.qualityScore - left.qualityScore;
    return right.relatedScore - left.relatedScore;
  });

  const picked = new Set<string>();
  const relatedTake = Math.min(3, STORY_MATCH_LIMIT, relatedRanked.length);
  for (let index = 0; index < relatedTake; index += 1) {
    picked.add(relatedRanked[index].entry.dna_id);
  }

  qualityRanked.forEach((item) => {
    if (picked.size >= STORY_MATCH_LIMIT) return;
    picked.add(item.entry.dna_id);
  });

  if (picked.size < STORY_MATCH_LIMIT) {
    ranked.forEach((item) => {
      if (picked.size >= STORY_MATCH_LIMIT) return;
      picked.add(item.entry.dna_id);
    });
  }

  return Array.from(picked);
}

function jobTitle(job: StoryBuildJob): string {
  return job.request.story_title || "Bộ truyện chưa tên";
}

function reviewerLabel(review: StoryReviewResult | null): string {
  if (!review) return "Chưa có reviewer";
  return `${review.is_pass ? "Đạt" : "Cần sửa"} (${review.quality_score.toFixed(1)})`;
}

function parseOutputSummary(rawJson: string): StoryOutputSummary {
  if (!rawJson.trim()) {
    return { hasStory: false, chapterCount: 0, totalChars: 0, previewText: "", isTruncated: false };
  }
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const draft = parsed.draft && typeof parsed.draft === "object" ? (parsed.draft as Record<string, unknown>) : null;
    if (!draft) return { hasStory: false, chapterCount: 0, totalChars: 0, previewText: "", isTruncated: false };
    const chaptersRaw = Array.isArray(draft.chapters) ? (draft.chapters as Record<string, unknown>[]) : [];
    const chapters = chaptersRaw
      .map((row, index) => ({
        chapterNumber: Number.isFinite(Number(row.chapter_number)) ? Math.max(1, Math.round(Number(row.chapter_number))) : index + 1,
        chapterTitle: String(row.chapter_title ?? `Chương ${index + 1}`).trim() || `Chương ${index + 1}`,
        content: String(row.content ?? "").trim(),
      }))
      .filter((chapter) => chapter.content.length > 0);

    const directStoryText = typeof draft.full_story === "string" ? draft.full_story.trim() : "";
    if (!chapters.length && directStoryText) {
      const previewLimit = 12000;
      const previewText = directStoryText.slice(0, previewLimit);
      const isTruncated = directStoryText.length > previewLimit;
      const chapterCount = Number.isFinite(Number(draft.chapter_count)) ? Math.max(1, Math.round(Number(draft.chapter_count))) : 1;
      return {
        hasStory: true,
        chapterCount,
        totalChars: directStoryText.length,
        previewText: isTruncated ? `${previewText}\n\n... (đã rút gọn bên giao diện)` : previewText,
        isTruncated,
      };
    }

    if (!chapters.length) return { hasStory: false, chapterCount: 0, totalChars: 0, previewText: "", isTruncated: false };

    const fullText = chapters
      .map((chapter) => `### ${chapter.chapterNumber}. ${chapter.chapterTitle}\n${chapter.content}`)
      .join("\n\n");
    const previewLimit = 12000;
    const previewText = fullText.slice(0, previewLimit);
    const isTruncated = fullText.length > previewLimit;

    return {
      hasStory: true,
      chapterCount: chapters.length,
      totalChars: fullText.length,
      previewText: isTruncated ? `${previewText}\n\n... (đã rút gọn bên giao diện)` : previewText,
      isTruncated,
    };
  } catch {
    return { hasStory: false, chapterCount: 0, totalChars: 0, previewText: "", isTruncated: false };
  }
}

function buildStoryTextFromOutput(rawJson: string): string {
  if (!rawJson.trim()) throw new Error("Chưa có dữ liệu truyện để xem.");
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const draft = parsed.draft && typeof parsed.draft === "object" ? (parsed.draft as Record<string, unknown>) : null;
  if (!draft) throw new Error("Không tìm thấy khối draft trong kết quả.");

  const storyTitle = String(draft.story_title ?? parsed.story_title ?? "Bộ truyện").trim() || "Bộ truyện";
  const fullStory = typeof draft.full_story === "string" ? draft.full_story.trim() : "";
  if (fullStory) return fullStory;

  const chaptersRaw = Array.isArray(draft.chapters) ? (draft.chapters as Record<string, unknown>[]) : [];
  const chapters = chaptersRaw
    .map((row, index) => ({
      chapterNumber: Number.isFinite(Number(row.chapter_number)) ? Math.max(1, Math.round(Number(row.chapter_number))) : index + 1,
      chapterTitle: String(row.chapter_title ?? `Chương ${index + 1}`).trim() || `Chương ${index + 1}`,
      content: String(row.content ?? "").trim(),
    }))
    .filter((chapter) => chapter.content.length > 0);

  if (!chapters.length) throw new Error("Kết quả chưa có nội dung chương truyện.");

  const lines: string[] = [`# ${storyTitle}`, ""];
  chapters.forEach((chapter) => {
    lines.push(`## ${chapter.chapterNumber}. ${chapter.chapterTitle}`);
    lines.push("");
    lines.push(chapter.content);
    lines.push("");
  });
  return lines.join("\n");
}

function normalizePersistedJob(job: StoryBuildJob): StoryBuildJob {
  const normalized: StoryBuildJob = {
    ...job,
    statusDetail: job.statusDetail?.trim() || statusDefaultDetail(job.status),
    reviewer_result: job.reviewer_result ?? null,
  };
  if (normalized.status === "dang_chay") {
    const interruptedAt = new Date().toISOString();
    return {
      ...normalized,
      status: "loi",
      statusDetail: "Tiến trình bị dừng đột ngột. Hãy bấm Tạo truyện đã chọn để chạy lại.",
      message:
        normalized.message?.trim() ||
        "Tiến trình tạo truyện đã bị dừng bất ngờ (đóng app/reload/mất kết nối). Bạn có thể chạy lại job này.",
      updated_at: interruptedAt,
    };
  }
  if (normalized.status !== "xong") return normalized;
  const summary = parseOutputSummary(normalized.output_json ?? "");
  if (summary.hasStory) return normalized;
  return {
    ...normalized,
    status: "dang_cho",
    statusDetail: "Kết quả cũ thiếu nội dung truyện, chờ tạo lại",
    message: "Kết quả cũ chưa có nội dung truyện, vui lòng chạy tạo lại.",
    output_json: "",
    reviewer_result: null,
  };
}

export function StoryBlueprintView({
  manualEntries,
  storyApiKeys,
  apiUrl,
  storyStoragePath,
  storyCookieJsonPath,
  storyWriterChatUrl,
  models,
  reviewerVendor,
  reviewerModel,
  useStoryReviewer,
  batchSize,
  factors,
  maxRetries,
  retryDelay,
  onSelectReviewerVendor,
  onSelectReviewerModel,
  onToggleReviewer,
}: Props) {
  const persisted = readJsonStorage<PersistedStoryBuildState | null>("story.create.state", null);

  const [jsonInput, setJsonInput] = useState(() => persisted?.jsonInput ?? sampleJsonInput);
  const [jobs, setJobs] = useState<StoryBuildJob[]>(() => (persisted?.jobs ?? []).map((job) => normalizePersistedJob(job)));
  const apiKeys = useMemo(() => storyApiKeys.split(/[;,\n]+/).map(k => k.trim()).filter(Boolean), [storyApiKeys]);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>(() => persisted?.selectedJobIds ?? []);
  const [activeJobId, setActiveJobId] = useState(() => persisted?.activeJobId ?? "");
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [previewDnaIds, setPreviewDnaIds] = useState<string[]>([]);
  const [openRuntimeConfig, setOpenRuntimeConfig] = useState(false);
  const [openStoryViewer, setOpenStoryViewer] = useState(false);
  const [storyViewerContent, setStoryViewerContent] = useState("");
  const [storyViewerError, setStoryViewerError] = useState("");

  const [dnaSelectorJobId, setDnaSelectorJobId] = useState<string | null>(null);
  const [dnaSelectorIds, setDnaSelectorIds] = useState<string[]>([]);

  const vendors = useMemo(() => Array.from(new Set(models.map((item) => item.vendor))).sort((a, b) => a.localeCompare(b, "vi")), [models]);
  const reviewerModelsByVendor = useMemo(
    () =>
      models
        .filter((item) => item.vendor === reviewerVendor)
        .map((item) => item.model)
        .sort((a, b) => a.localeCompare(b, "vi")),
    [models, reviewerVendor],
  );
  const vendorOptions = useMemo(
    () => [{ value: "", label: "Chọn hãng" }, ...vendors.map((vendor) => ({ value: vendor, label: vendor }))],
    [vendors],
  );

  const reviewerModelOptions = useMemo(() => {
    if (!reviewerVendor) {
      return [{ value: "", label: "Chọn hãng trước", disabled: true }];
    }
    return [{ value: "", label: "Chọn model" }, ...reviewerModelsByVendor.map((modelName) => ({ value: modelName, label: modelName }))];
  }, [reviewerVendor, reviewerModelsByVendor]);

  const sourcePool = useMemo(() => {
    const fromLibrary = getSortedCategoryKeys().flatMap((categoryKey) => loadCategoryEntries(categoryKey));
    const merged = new Map<string, DnaEntry>();
    [...fromLibrary, ...manualEntries].forEach((entry) => {
      if (!merged.has(entry.dna_id)) merged.set(entry.dna_id, entry);
    });
    return Array.from(merged.values()).sort((left, right) => right.scores.overall - left.scores.overall);
  }, [manualEntries]);

  const sourceById = useMemo(() => new Map(sourcePool.map((entry) => [entry.dna_id, entry])), [sourcePool]);
  const allSelected = jobs.length > 0 && selectedJobIds.length === jobs.length;
  const selectedJobs = jobs.filter((job) => selectedJobIds.includes(job.id));
  const activeJob = jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null;
  const activeOutputSummary = useMemo(() => parseOutputSummary(activeJob?.output_json ?? ""), [activeJob?.output_json]);

  useEffect(() => {
    writeJsonStorage<PersistedStoryBuildState>("story.create.state", {
      jsonInput,
      jobs,
      selectedJobIds,
      activeJobId,
    });
    
    // Auto-match DNA when JSON input changes
    try {
      const request = parseStoryCreationRequest(jsonInput);
      const matches = pickMatchedDnaIds(request, sourcePool);
      setPreviewDnaIds(matches);
    } catch {
      setPreviewDnaIds([]);
    }
  }, [jsonInput, jobs, selectedJobIds, activeJobId, sourcePool]);

  useEffect(() => {
    let timer: any;
    const updateCount = async () => {
       try {
         const count = await getBrowserWriterSessionCount();
         setActiveSessionCount(count);
       } catch (e) {}
       timer = setTimeout(updateCount, 3000);
    };
    updateCount();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!jobs.length) {
      setActiveJobId("");
      return;
    }
    if (!jobs.some((job) => job.id === activeJobId)) {
      setActiveJobId(jobs[0].id);
    }
  }, [jobs, activeJobId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const request = parseStoryCreationRequest(jsonInput);
        const matched = pickMatchedDnaIds(request, sourcePool);
        setPreviewDnaIds(matched);
      } catch (e) {
        setPreviewDnaIds([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [jsonInput, sourcePool]);

  const toggleAllJobs = (checked: boolean) => {
    setSelectedJobIds(checked ? jobs.map((job) => job.id) : []);
  };

  const toggleOneJob = (jobId: string, checked: boolean) => {
    setSelectedJobIds((prev) => (checked ? Array.from(new Set([...prev, jobId])) : prev.filter((id) => id !== jobId)));
  };

  const addJobFromJson = () => {
    try {
      const request = parseStoryCreationRequest(jsonInput);
      const matchedIds = pickMatchedDnaIds(request, sourcePool);
      const activeFactorKeys = pickActiveFactors(request, factors).map((factor) => factor.key);
      const createdAt = new Date().toISOString();
      const nextJob: StoryBuildJob = {
        id: `job_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        request,
        request_raw: jsonInput.trim(),
        matched_dna_ids: matchedIds,
        active_factor_keys: activeFactorKeys,
        status: "dang_cho",
        statusDetail: "Chờ bắt đầu tạo truyện",
        message: "",
        output_directory: "",
        output_json: "",
        reviewer_result: null,
        created_at: createdAt,
        updated_at: createdAt,
      };

      setJobs((prev) => [nextJob, ...prev]);
      setSelectedJobIds([]);
      setActiveJobId(nextJob.id);
      setMessage(`Đã thêm bộ truyện: ${request.story_title} (khớp ${matchedIds.length} DNA).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thêm được JSON truyện.");
    }
  };

  const cleanupSelectedJobs = () => {
    if (isGenerating) return;
    if (!selectedJobIds.length) {
      setMessage("Chưa chọn bộ truyện để dọn.");
      return;
    }
    const selectedSet = new Set(selectedJobIds);
    setJobs((prev) => prev.filter((job) => !selectedSet.has(job.id)));
    setSelectedJobIds([]);
    setMessage("Đã dọn các bộ truyện đã chọn.");
  };

  const cleanupAllJobs = () => {
    if (isGenerating) return;
    if (!jobs.length) return;
    const ok = window.confirm("Dọn toàn bộ hàng đợi tạo truyện?");
    if (!ok) return;
    setJobs([]);
    setSelectedJobIds([]);
    setActiveJobId("");
    setMessage("Đã dọn toàn bộ hàng đợi tạo truyện.");
  };

  const generateOneJob = async (job: StoryBuildJob, windowIndex: number = 0): Promise<void> => {
    const markJob = (detail: string, status: StoryBuildJobStatus = "dang_chay") => {
      setJobs((prev) =>
        prev.map((item) =>
          item.id === job.id
            ? {
                ...item,
                status,
                statusDetail: detail,
                updated_at: new Date().toISOString(),
              }
            : item,
        ),
      );
    };

    setJobs((prev) =>
      prev.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: "dang_chay",
              statusDetail: "Đang chuẩn bị dữ liệu DNA nguồn...",
              message: "",
              updated_at: new Date().toISOString(),
            }
          : item,
      ),
    );

    try {
      if (!storyCookieJsonPath.trim()) {
        throw new Error("Thiếu file cookie JSON ChatGPT trong phần Cài đặt.");
      }

      const matchedEntries = job.matched_dna_ids.map((id) => sourceById.get(id)).filter((item): item is DnaEntry => Boolean(item));
      const fallbackEntries = sourcePool.slice(0, STORY_MATCH_LIMIT);
      const dnaEntries = matchedEntries.length ? matchedEntries : fallbackEntries;
      const activeFactors = factors.filter((factor) => job.active_factor_keys.includes(factor.key));
      const chapterCount = calcChapterCount(job.request);
      
      const currentApiKey = apiKeys.length ? apiKeys[windowIndex % apiKeys.length] : "";

      const blueprintAdditionalNotes = [
        job.request.extra_prompt,
        `Mục tiêu cường độ: ${job.request.target_intensity}`,
        `Kết thúc: ${job.request.ending_type}`,
        `Yêu tố bật: ${activeFactors.map((factor) => factor.key).join(", ") || "không có"}`,
      ]
        .filter(Boolean)
        .join("\n");

      markJob("Đang mở Chromium và nạp phiên ChatGPT...");
      const writerSession = await startBrowserWriterSession({
        cookieFilePath: storyCookieJsonPath,
        chatUrl: storyWriterChatUrl,
        windowIndex,
      });

      try {
        const dnaSourcesWithPayload = dnaEntries.map((entry) => {
          const base = toBlueprintSource(entry);
          const rawEntry = entry as any;
          const payload = rawEntry.full_payload || rawEntry.core || readFullDnaPayload("", entry);
          if (payload) {
             base.full_payload = payload;
          } else {
             throw new Error(`Không đọc được file cấu trúc DNA cho [${entry.dna_id}].`);
          }
          return base;
        });

        let blueprint: StoryBlueprintResult | null = null;
        let draft: any = null;
        let review: StoryReviewResult | null = null;
        let lastError = "";

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            if (attempt > 0) {
              markJob(`Thử lại lần ${attempt}/${maxRetries} sau lỗi (đợi ${retryDelay/1000}s)...`);
              await new Promise(r => setTimeout(r, retryDelay));
            }

            if (!blueprint) {
              markJob(`Đang dựng sườn bằng Chrome...`);
              blueprint = await generateStoryBlueprintWithBrowser({
                writerSessionId: writerSession.sessionId,
                onProgress: (detail) => markJob(detail),
                requirements: {
                  chapter_count: chapterCount,
                  genre: job.request.genre,
                  setting: job.request.story_language,
                  character_name_language: job.request.character_name_language,
                  additional_notes: blueprintAdditionalNotes,
                },
                sources: dnaSourcesWithPayload,
                activeFactors,
                reviewerApiKey: currentApiKey,
                reviewerApiUrl: apiUrl,
                reviewerModel,
              });
            }

            if (!draft) {
              markJob(`Đang tạo ${chapterCount} chương qua Chrome...`);
              draft = await generateStoryDraftWithBrowserWriter({
                writerSessionId: writerSession.sessionId,
                cookieFilePath: storyCookieJsonPath,
                chatUrl: storyWriterChatUrl,
                windowIndex,
                reviewerApiKey: currentApiKey,
                reviewerApiUrl: apiUrl,
                reviewerModel,
                request: job.request,
                blueprint,
                sources: toStoryDnaSources(dnaEntries),
                factors: activeFactors,
                skipReview: !useStoryReviewer,
                onProgress: (detail) => markJob(detail, "dang_chay"),
              });
            }

            if (!review) {
              if (useStoryReviewer) {
                markJob("Đang đánh giá tổng thể bằng Reviewer...");
                review = await reviewStoryDraftWithBeeApi({
                  apiKey: currentApiKey,
                  apiUrl,
                  model: reviewerModel,
                  request: job.request,
                  blueprint,
                  draft,
                  sources: toStoryDnaSources(dnaEntries),
                  factors: activeFactors,
                });
              } else {
                markJob("Đang yêu cầu ChatGPT tự chấm điểm (Self-Review)...");
                review = await reviewStoryDraftWithBrowserWriter(writerSession.sessionId, {
                  writerSessionId: writerSession.sessionId,
                  cookieFilePath: storyCookieJsonPath,
                  chatUrl: storyWriterChatUrl,
                  windowIndex,
                  reviewerApiKey: currentApiKey,
                  reviewerApiUrl: apiUrl,
                  reviewerModel,
                  request: job.request,
                  blueprint,
                  sources: toStoryDnaSources(dnaEntries),
                  factors: activeFactors,
                  skipReview: true,
                }, draft);
              }
            }
            
            break; // Success!
          } catch (e: any) {
            lastError = e.message || String(e);
            console.error(`Attempt ${attempt} failed:`, e);
            if (attempt === maxRetries) throw e;
          }
        }

        if (!blueprint || !draft) throw new Error("Thất bại sau nhiều lần thử: " + lastError);

        markJob("Đang lưu bộ truyện vào thư viện...");
        let outputDirectory = "";
        if (canSaveStoryProject()) {
          const saveResult = saveStoryProject({
            request: job.request,
            blueprint,
            draft,
            dnaSources: toStoryDnaSources(dnaEntries),
            factors: activeFactors,
            storageDir: storyStoragePath,
          });
          outputDirectory = saveResult.storyDir;
        }

        const outputJson = JSON.stringify(
          {
            request: job.request,
            active_factor_keys: activeFactors.map((factor) => factor.key),
            matched_dna_ids: dnaEntries.map((entry) => entry.dna_id),
            blueprint,
            draft,
            reviewer: review,
            output_directory: outputDirectory || null,
            writer_session: {
              browser_name: writerSession.browserName,
              chat_url: writerSession.chatUrl,
            },
          },
          null,
          2,
        );

        setJobs((prev) =>
          prev.map((item) =>
            item.id === job.id
              ? {
                  ...item,
                  status: "xong",
                  statusDetail: review
                    ? `Hoàn tất ${draft.chapter_count} chương, reviewer ${review.is_pass ? "đạt" : "cần sửa"} (${review.quality_score.toFixed(1)})`
                    : `Hoàn tất ${draft.chapter_count} chương truyện`,
                  output_directory: outputDirectory,
                  output_json: outputJson,
                  reviewer_result: review,
                  message: review ? review.summary : "Hoàn tất (chưa có review)",
                  updated_at: new Date().toISOString(),
                }
              : item,
          ),
        );
      } finally {
        await closeBrowserWriterSession(writerSession.sessionId);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Có lỗi không xác định";
      markJob("Lỗi: " + errMsg, "loi");
      setJobs((prev) =>
        prev.map((item) =>
          item.id === job.id
            ? {
                ...item,
                message: errMsg,
                updated_at: new Date().toISOString(),
              }
            : item,
        ),
      );
    }
  };

  const runGenerate = async () => {
    if (isGenerating) return;
    const queue = selectedJobs.length ? selectedJobs : jobs.filter((job) => job.status === "dang_cho");
    if (!queue.length) {
      setMessage("Không có bộ truyện đang chờ để tạo.");
      return;
    }
    if (!apiKeys.length) {
      setMessage("Thiếu khóa API Reviewer truyện trong phần Cài đặt.");
      return;
    }
    if (!apiUrl.trim()) {
      setMessage("Thiếu địa chỉ API.");
      return;
    }
    if (!reviewerModel.trim()) {
      setMessage("Thiếu model reviewer.");
      return;
    }
    if (!storyCookieJsonPath.trim()) {
      setMessage("Thiếu file cookie JSON ChatGPT trong phần Cài đặt.");
      return;
    }
    if (!sourcePool.length) {
      setMessage("Chuưa có DNA nguồn trong thư viện để tạo truyện.");
      return;
    }

    const requestedBatch = Math.min(15, Math.max(1, Math.round(batchSize || 1)));
    const parallel = requestedBatch;
    const queueIds = new Set(queue.map((job) => job.id));
    setIsGenerating(true);
    setSelectedJobIds((prev) => prev.filter((id) => !queueIds.has(id)));
    setMessage(
      requestedBatch > 1
        ? `Đang tạo ${queue.length} bộ truyện với ${parallel} luồng song song (Batch: ${requestedBatch}).`
        : `Đang tạo ${queue.length} bộ truyện bằng Chromium writer.`
    );

    let cursor = 0;
    const workers = Array.from({ length: parallel }, async (_, workerIndex) => {
      if (workerIndex > 0) {
        await new Promise((r) => setTimeout(r, workerIndex * 5000));
      }
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) return;
        await generateOneJob(queue[index], workerIndex);
      }
    });

    await Promise.all(workers);
    setIsGenerating(false);
    setMessage("Đã hoàn tất tiến trình tạo truyện.");
  };
  const copyActiveOutput = async () => {
    if (!activeJob?.output_json.trim()) return;
    try {
      await navigator.clipboard.writeText(activeJob.output_json);
      setMessage("Đã sao chép kết quả JSON.");
    } catch {
      setMessage("Không thể sao chép vào clipboard.");
    }
  };

  const openActiveOutputFolder = async () => {
    if (!activeJob?.output_directory) {
      setMessage("Bộ truyện này chưa có thư mục lưu cục bộ.");
      return;
    }
    try {
      await openPathInExplorer(activeJob.output_directory);
      setMessage(`Đã mở thư mục truyện: ${activeJob.output_directory}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không mở được thư mục truyện.");
    }
  };

  const viewActiveStory = () => {
    if (!activeJob?.output_json.trim()) {
      setMessage("Bộ truyện này chưa có kết quả để xem.");
      return;
    }
    try {
      const fullText = buildStoryTextFromOutput(activeJob.output_json);
      setStoryViewerError("");
      setStoryViewerContent(fullText);
      setOpenStoryViewer(true);
    } catch (error) {
      setStoryViewerContent("");
      setStoryViewerError(error instanceof Error ? error.message : "Không đọc được nội dung truyện.");
      setOpenStoryViewer(true);
    }
  };

  return (
    <section className="blueprint-view story-builder-view">
      <header className="story-head">
        <div>
          <p className="breadcrumb">AUTO STORIES &gt; TẠO TRUYỆN</p>
          <h1>Tạo truyện từ DNA</h1>
        </div>
      </header>

      <div className="api-runtime-strip">
        <span className="runtime-label">API: {apiUrl || "-"}</span>
        <span className="runtime-label border-l pl-3">AI Review: <strong style={{ color: useStoryReviewer ? "#10b981" : "#9ca3af" }}>{useStoryReviewer ? "Bật" : "Tắt"}</strong></span>
        <span className="runtime-label border-l pl-3">Model reviewer: <strong className="text-white">{reviewerModel || "Chưa chọn"}</strong></span>
        <span className="runtime-label border-l pl-3">
          Batch: <span className="status-badge" style={{ backgroundColor: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.4)" }}>
            {Math.min(5, Math.max(1, Math.round(batchSize || 1)))}
          </span>
        </span>
        <span className="runtime-label border-l pl-3">
          Keys: <span className="status-badge" style={{ backgroundColor: "rgba(99, 102, 241, 0.2)", color: "#818cf8", border: "1px solid rgba(99, 102, 241, 0.4)" }}>
            {apiKeys.length}
          </span>
        </span>
        <span className="runtime-label border-l pl-3">
          Chrome đang mở: <span className={`status-badge ${activeSessionCount > 0 ? "glow-active" : ""}`} style={{ 
            backgroundColor: activeSessionCount > 0 ? "rgba(16, 185, 129, 0.2)" : "rgba(107, 114, 128, 0.2)", 
            color: activeSessionCount > 0 ? "#10b981" : "#9ca3af",
            border: `1px solid ${activeSessionCount > 0 ? "rgba(16, 185, 129, 0.4)" : "rgba(107, 114, 128, 0.3)"}` 
          }}>
            {activeSessionCount}
          </span>
        </span>
        <span className="runtime-label border-l pl-3 truncate max-w-xs">Lưu: {storyStoragePath.trim() || "Mặc định"}</span>
      </div>

      <section className={`story-runtime-selectors ${!useStoryReviewer ? "reviewer-disabled" : ""}`}>
        <div className="story-runtime-field">
          <span className="field-label">Thông thái (AI Review)</span>
          <div className="flex items-center gap-3">
            <button 
              type="button" 
              className={`toggle-switch-large ${useStoryReviewer ? "active" : ""}`}
              onClick={() => onToggleReviewer(!useStoryReviewer)}
              title={useStoryReviewer ? "Đang bật Review & Sửa chương" : "Đã tắt Review (Tăng tốc độ tối đa)"}
            >
              <div className="toggle-knob" />
            </button>
            <span className={`status-text ${useStoryReviewer ? "text-active" : "text-inactive"}`}>
              {useStoryReviewer ? "BẬT: Check logic & văn phong" : "TẮT: Viết bản thảo thô"}
            </span>
          </div>
        </div>

        <div className="runtime-group-divider" />

        <label className={`story-runtime-field ${!useStoryReviewer ? "opacity-40 pointer-events-none" : ""}`}>
          <span className="field-label">Hãng AI Reviewer</span>
          <CustomSelect
            value={reviewerVendor}
            options={vendorOptions}
            onChange={onSelectReviewerVendor}
            placeholder="Chọn hãng"
            disabled={!useStoryReviewer}
            className="settings-custom-select story-runtime-select"
          />
        </label>
        
        <label className={`story-runtime-field ${!useStoryReviewer ? "opacity-40 pointer-events-none" : ""}`}>
          <span className="field-label">Model Reviewer</span>
          <CustomSelect
            value={reviewerModel}
            options={reviewerModelOptions}
            onChange={onSelectReviewerModel}
            placeholder={reviewerVendor ? "Chọn model" : "Chọn hãng trước"}
            disabled={!useStoryReviewer || !reviewerVendor}
            className="settings-custom-select story-runtime-select"
          />
        </label>
      </section>

      <label className="blueprint-notes">
        JSON đầu vào (mỗi lần thêm là 1 bộ truyện)
        <textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} className="story-input-area story-json-input" />
      </label>

      <div className="story-hints">
        <span>{jobs.length} bộ truyện trong hàng đợi</span>
        <span>{selectedJobIds.length} bộ truyện đã chọn</span>
        <span className={previewDnaIds.length > 0 ? "text-brand-400 font-bold glow-hint" : ""}>
          Khớp: {previewDnaIds.length > 0 ? previewDnaIds.map(id => sourceById.get(id)?.title || id).join(", ") : "Chưa khớp DNA nào"}
        </span>
        <span>{sourcePool.length} DNA sẵn sàng để ghép</span>
        <span>{factors.length} yếu tố trong thư viện</span>
        <span>Yếu tố bật mặc định sẽ tự áp dụng, không cần thêm key boolean trong JSON</span>
      </div>

      {message ? <p className="story-message">{message}</p> : null}

      <section className="story-layout story-builder-layout">
        <section className="story-table-card">
          <div className="story-table-toolbar story-builder-toolbar">
            <button type="button" className="ghost-btn compact" onClick={() => setOpenRuntimeConfig(true)}>
              <Settings2 size={14} />
              Cài đặt tạo truyện
            </button>
            <button type="button" className="ghost-btn compact" onClick={addJobFromJson}>
               <Plus size={14} />
               Thêm JSON truyện
             </button>
            <button type="button" className="ghost-btn compact danger-ghost-btn" onClick={async () => { if(window.confirm("Đóng sạch cửa sổ Chrome writer đang mở?")) { try { await closeBrowserAllSessions(); setMessage("Đã dọn sạch các cửa sổ trình duyệt."); } catch(e){ setMessage("Lỗi dọn dẹp."); } } }}>
               <XCircle size={14} />
               Dọn trình duyệt
             </button>
            <button type="button" className="ghost-btn compact" onClick={cleanupSelectedJobs} disabled={isGenerating || !selectedJobIds.length}>
              Dọn đã chọn
            </button>
            <button type="button" className="ghost-btn compact" onClick={cleanupAllJobs} disabled={isGenerating || !jobs.length}>
              Dọn tất cả
            </button>
            <button type="button" className={`primary-btn compact ${isGenerating ? "is-disabled" : ""}`} onClick={runGenerate} disabled={isGenerating}>
              {isGenerating ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
              {isGenerating ? "Đang tạo truyện..." : "Tạo truyện đã chọn"}
            </button>
          </div>

          <div className="story-table-wrap">
            <table className="story-table story-job-table">
              <thead>
                <tr>
                  <th className="center">
                    <input type="checkbox" checked={allSelected} onChange={(event) => toggleAllJobs(event.target.checked)} />
                  </th>
                  <th>STT</th>
                  <th>Bộ truyện</th>
                  <th>Thể loại</th>
                  <th>DNA khớp</th>
                  <th>Yếu tố bật</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state">
                        <Database size={22} />
                        <p>Chưa có JSON truyện. Dán JSON và bấm Thêm JSON truyện.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  jobs.map((job, index) => (
                    <tr key={job.id} className={activeJobId === job.id ? "active" : ""} onClick={() => setActiveJobId(job.id)}>
                      <td className="center" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedJobIds.includes(job.id)} onChange={(event) => toggleOneJob(job.id, event.target.checked)} />
                      </td>
                      <td>{index + 1}</td>
                      <td>
                        <div className="story-title-cell">
                          <strong>{jobTitle(job)}</strong>
                          <small>
                            {job.request.total_words.toLocaleString("vi-VN")} ký tự mục tiêu | {calcChapterCount(job.request)} chương
                          </small>
                        </div>
                      </td>
                      <td>{job.request.genre}</td>
                      <td>
                        <div className="dna-match-cell">
                          {job.matched_dna_ids.map(id => sourceById.get(id)?.title || id).join(", ") || "Auto-Match"}
                        </div>
                      </td>
                      <td>{job.active_factor_keys.length}</td>
                      <td>
                        <div className="story-status-cell">
                          <span className={`story-status ${job.status}`}>{statusLabelMap[job.status]}</span>
                          <small>{job.statusDetail || statusDefaultDetail(job.status)}</small>
                        </div>
                      </td>
                      <td>{new Date(job.updated_at).toLocaleString("vi-VN")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="story-detail-panel">
          <header className="detail-panel-head">
            <h2>Kết quả tạo truyện</h2>
            <button type="button" className="ghost-btn compact" onClick={copyActiveOutput} disabled={!activeJob?.output_json.trim()}>
              <Copy size={14} />
              Sao chép
            </button>
          </header>

          {activeJob ? (
            <>
              <div className="detail-card">
                <p className="story-meta-line">Tiêu đề: {jobTitle(activeJob)}</p>
                <p className="story-meta-line">Trạng thái: {statusLabelMap[activeJob.status]}</p>
                
                <div className="matched-dna-details-list">
                  <p className="story-meta-label">DNA Cấu trúc & Văn phong:</p>
                  {activeJob.matched_dna_ids.map(id => {
                    const entry = sourceById.get(id);
                    if (!entry) return null;
                    return (
                      <div key={id} className="matched-dna-item-box">
                        <div className="dna-item-header">
                          <BrainCircuit size={12} className="text-brand-400" />
                          <span className="dna-item-title">{entry.title}</span>
                        </div>
                        <div className="dna-item-tags">
                          <span className="dna-mini-tag genre">{entry.category}</span>
                          {entry.styles.slice(0, 2).map(s => <span key={s} className="dna-mini-tag style">{s}</span>)}
                          {entry.tags.slice(0, 2).map(t => <span key={t} className="dna-mini-tag">{t}</span>)}
                        </div>
                      </div>
                    );
                  })}
                  {!activeJob.matched_dna_ids.length && <p className="text-ui-500 text-xs italic">Tự động chọn DNA tối ưu khi chạy...</p>}
                </div>

                <div className="flex items-center gap-2 mb-2 mt-3">
                  <span className="story-meta-line mb-0">Tùy chỉnh:</span>
                  {(activeJob.status === "dang_cho" || activeJob.status === "loi") && (
                    <button
                      type="button"
                      className="ghost-btn compact text-brand-400 hover:text-brand-300 px-2 py-0 border border-brand-800/50"
                      onClick={() => {
                        setDnaSelectorJobId(activeJob.id);
                        setDnaSelectorIds(activeJob.matched_dna_ids);
                      }}
                    >
                      Sửa DNA
                    </button>
                  )}
                </div>
                <p className="story-meta-line">Yếu tố bật: {activeJob.active_factor_keys.join(", ") || "-"}</p>
                <p className="story-meta-line">Reviewer: {reviewerLabel(activeJob.reviewer_result)}</p>
                <p className="story-meta-line">Tiến trình: {activeJob.statusDetail || statusDefaultDetail(activeJob.status)}</p>
                <p className="story-meta-line">Chương truyện: {activeOutputSummary.chapterCount}</p>
                <p className="story-meta-line">Ký tự truyện: {activeOutputSummary.totalChars.toLocaleString("vi-VN")}</p>
                {activeJob.message ? <p className="story-message">{activeJob.message}</p> : null}
              </div>

              {activeOutputSummary.hasStory ? (
                <div className="story-content-scroll">
                  <p className="preview-text">{activeOutputSummary.previewText}</p>
                </div>
              ) : (
                <p className="preview-text">Chưa có bản truyện hoàn chỉnh. Hãy bấm Tạo truyện đã chọn.</p>
              )}

              {activeJob.output_json ? (
                <details className="story-json-details">
                  <summary>Dữ liệu JSON kỹ thuật</summary>
                  <div className="blueprint-output-scroll">
                    <pre className="dna-json-pre">{activeJob.output_json}</pre>
                  </div>
                </details>
              ) : null}

              <button type="button" className="ghost-btn full" onClick={viewActiveStory} disabled={!activeJob.output_json.trim()}>
                <FileText size={14} />
                Xem toàn bộ truyện
              </button>
              <button type="button" className="ghost-btn full" onClick={openActiveOutputFolder} disabled={!activeJob.output_directory}>
                <FolderOpen size={14} />
                Mở thư mục truyện
              </button>
            </>
          ) : (
            <p className="preview-text">Chọn một bộ truyện để xem chi tiết.</p>
          )}
        </aside>
      </section>

      {/* Selector modal cho DNA */}
      {dnaSelectorJobId && (
        <div className="runtime-settings-overlay">
          <div className="runtime-settings-modal md:w-[800px] w-[95%] max-h-[90vh] flex flex-col p-0 bg-ui-800 shadow-2xl border border-ui-700">
            <header className="p-4 border-b border-ui-700 font-semibold flex items-center justify-between pointer-events-none">
              <span className="text-white text-lg pointer-events-auto">Đọc & Chọn cấu trúc DNA nguồn</span>
              <button className="text-ui-300 hover:text-white pointer-events-auto" onClick={() => setDnaSelectorJobId(null)}>
                <X size={20} />
              </button>
            </header>
            <div className="p-4 flex-1 overflow-auto bg-ui-900 custom-scrollbar">
              {(() => {
                const job = jobs.find((j) => j.id === dnaSelectorJobId);
                if (!job) return null;
                const ranked = sourcePool
                  .map((entry) => ({ entry, ...rankDnaMatch(entry, job.request) }))
                  .sort((a, b) => b.relatedScore - a.relatedScore)
                  .slice(0, 15);

                return (
                  <div className="flex flex-col gap-4">
                    {ranked.map(({ entry, relatedScore }) => {
                      const isSelected = dnaSelectorIds.includes(entry.dna_id);
                      const rawEntry = entry as any;
                      const payload = rawEntry.full_payload || (rawEntry.core ? { core: rawEntry.core, summary: rawEntry.summary } : readFullDnaPayload("", entry));
                      return (
                        <div
                          key={entry.dna_id}
                          className={`p-4 rounded-md border flex flex-col gap-3 transition-colors ${
                            isSelected ? "border-brand-500 bg-brand-900/10" : "border-ui-700 bg-ui-800 hover:bg-ui-800/80"
                          }`}
                        >
                          <label className="flex items-start gap-4 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) setDnaSelectorIds((prev) => [...prev, entry.dna_id]);
                                else setDnaSelectorIds((prev) => prev.filter((id) => id !== entry.dna_id));
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-white mb-1 truncate">{entry.title}</h4>
                              <p className="text-ui-400 text-sm truncate">
                                {entry.category} &rsaquo; {entry.sub_category} — Điểm phù hợp: {relatedScore.toFixed(0)}
                              </p>
                            </div>
                          </label>
                          {payload && (
                            <div className="bg-ui-950 p-3 rounded text-sm text-ui-300 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner border border-ui-800 custom-scrollbar">
                              {JSON.stringify(payload, null, 2)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <footer className="p-4 border-t border-ui-700 flex justify-end gap-3 bg-ui-800 items-center">
              <span className="text-sm text-ui-400 mr-auto ml-1">Đã chọn: <strong className="text-white">{dnaSelectorIds.length}</strong> DNA.</span>
              <button type="button" className="ghost-btn" onClick={() => setDnaSelectorJobId(null)}>
                Hủy bỏ
              </button>
              <button
                type="button"
                className="primary-btn shrink-0"
                onClick={() => {
                  setJobs((prev) => prev.map((j) => (j.id === dnaSelectorJobId ? { ...j, matched_dna_ids: dnaSelectorIds } : j)));
                  setDnaSelectorJobId(null);
                }}
              >
                Áp dụng DNA
              </button>
            </footer>
          </div>
        </div>
      )}

      {openStoryViewer ? (
        <div className="modal-backdrop" onClick={() => setOpenStoryViewer(false)}>
          <div className="modal-card dna-viewer-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>Toàn bộ truyện</h3>
              <button type="button" className="icon-square" onClick={() => setOpenStoryViewer(false)} aria-label="Đóng xem toàn bộ truyện">
                <X size={14} />
              </button>
            </header>
            {storyViewerError ? <div className="story-error-box">{storyViewerError}</div> : null}
            {!storyViewerError ? (
              <div className="dna-viewer-scroll">
                <pre className="dna-json-pre">{storyViewerContent}</pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {openRuntimeConfig ? (
        <div className="modal-backdrop" onClick={() => setOpenRuntimeConfig(false)}>
          <div className="modal-card story-runtime-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>Cài đặt tạo truyện</h3>
              <button type="button" className="icon-square" onClick={() => setOpenRuntimeConfig(false)} aria-label="Đóng cài đặt tạo truyện">
                <X size={16} />
              </button>
            </header>

            <div className="runtime-model-grid runtime-model-pair-grid">
              <div className="runtime-model-card">
                <h4>Hệ thống viết truyện</h4>
                <div className="runtime-status-info">
                  <p>Hệ thống hiện đang sử dụng <strong>Chromium Writer</strong> (ChatGPT) để viết nội dung chính. Không cần cấu hình Model API cho tác vụ này.</p>
                </div>
              </div>

              <div className="runtime-model-card">
                <h4>Model reviewer</h4>
                <div className="runtime-model-inline">
                  <label>
                    Hãng AI
                    <CustomSelect
                      value={reviewerVendor}
                      options={vendorOptions}
                      onChange={onSelectReviewerVendor}
                      placeholder="Chọn hãng"
                      className="settings-custom-select"
                    />
                  </label>
                  <label>
                    Model
                    <CustomSelect
                      value={reviewerModel}
                      options={reviewerModelOptions}
                      onChange={onSelectReviewerModel}
                      placeholder={reviewerVendor ? "Chọn model" : "Chọn hãng trước"}
                      disabled={!reviewerVendor}
                      className="settings-custom-select"
                    />
                  </label>
                </div>
              </div>
            </div>

            <footer>
              <button type="button" className="primary-btn" onClick={() => setOpenRuntimeConfig(false)}>
                Lưu và đóng
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
