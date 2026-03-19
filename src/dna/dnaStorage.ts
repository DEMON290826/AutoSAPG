import type { StoryAnalysisResult, StoryCreateMode, StoryFileType } from "./analysisTypes";
import type { CategoryAddress, CategoryFile, DnaEntry } from "./types";

declare global {
  interface Window {
    require?: (name: string) => unknown;
  }
}

type NodeRuntime = {
  fs: {
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, data: string, encoding: string) => void;
  };
  path: {
    join: (...parts: string[]) => string;
    relative: (from: string, to: string) => string;
    dirname: (path: string) => string;
    isAbsolute: (path: string) => boolean;
  };
  os: {
    homedir: () => string;
  };
};

type PersistedAddresses = {
  version: string;
  last_updated: string;
  categories: Record<string, CategoryAddress>;
  search_aliases: Record<string, string>;
};

type PersistedTagsIndex = {
  version: string;
  last_updated: string;
  tag_map: Record<string, Array<{ category: string; dna_id: string; title: string }>>;
};

export type SaveStoryDnaInput = {
  title: string;
  storyContent: string;
  createMode: StoryCreateMode;
  fileType: StoryFileType;
  authorName?: string;
  sourcePath?: string;
  storageDir?: string;
  analysis: StoryAnalysisResult;
};

export type SaveStoryDnaResult = {
  entry: DnaEntry;
  baseDir: string;
  dnaDirectory: string;
  files: {
    core: string;
    critique: string;
    summary: string;
    improvedOutline: string;
  };
};

const viCollator = new Intl.Collator("vi", {
  sensitivity: "base",
  numeric: true,
});

function getNodeRuntime(): NodeRuntime | null {
  if (typeof window === "undefined" || typeof window.require !== "function") {
    return null;
  }

  const fs = window.require("fs");
  const path = window.require("path");
  const os = window.require("os");
  if (!fs || !path || !os) return null;

  return { fs: fs as NodeRuntime["fs"], path: path as NodeRuntime["path"], os: os as NodeRuntime["os"] };
}

export function isLocalDnaPersistenceAvailable(): boolean {
  return getNodeRuntime() !== null;
}

function normalizeForAlias(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\u0111\u0110]/g, "d")
    .replace(/[^a-z0-9\s_:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyVietnamese(value: string): string {
  const slug = normalizeForAlias(value)
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "chua_phan_loai";
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function titleCaseFromKey(key: string): string {
  return key
    .split("_")
    .map((part) => (part.length ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function readJsonFile<T>(runtime: NodeRuntime, filePath: string, fallback: T): T {
  if (!runtime.fs.existsSync(filePath)) return fallback;
  try {
    const raw = runtime.fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(runtime: NodeRuntime, filePath: string, value: unknown): void {
  runtime.fs.mkdirSync(runtime.path.dirname(filePath), { recursive: true });
  runtime.fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getOverallScore(analysis: StoryAnalysisResult): number {
  const value = analysis.score_report.overall_score.score;
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(10, value)).toFixed(2));
}

function generateNextDnaId(entries: DnaEntry[]): string {
  const max = entries.reduce((highest, entry) => {
    const match = entry.dna_id.match(/^dna_(\d+)$/);
    if (!match) return highest;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, 0);

  return `dna_${String(max + 1).padStart(6, "0")}`;
}

function mapFileTypeToSourceType(fileType: StoryFileType): DnaEntry["source_type"] {
  if (fileType === "word") return "TEXT/PDF";
  return "TEXT/PDF";
}

function ensureUniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => viCollator.compare(a, b));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toFlatStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const clean = value.trim();
    return clean ? [clean] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => toFlatStringArray(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) => toFlatStringArray(item));
  }
  return [];
}

function uniqueKeepOrder(values: string[]): string[] {
  const result: string[] = [];
  values.forEach((value) => {
    const clean = String(value ?? "").trim();
    if (!clean) return;
    if (!result.includes(clean)) result.push(clean);
  });
  return result;
}

function ensureMinItems(values: string[], min: number, fallback: string[]): string[] {
  const merged = uniqueKeepOrder([...values, ...fallback]);
  if (merged.length <= min) return merged;
  return merged.slice(0, merged.length);
}

function toCategoryDisplayNameFromKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) return "Truyện ma";
  const map: Record<string, string> = {
    truyen_ma: "Truyện ma",
    nosleep: "NoSleep",
    creepypasta: "Creepypasta",
  };
  if (map[normalized]) return map[normalized];
  return titleCaseFromKey(normalized);
}

function resolveAiCategoryKey(analysis: StoryAnalysisResult): string {
  const dna = asRecord(analysis.dna_json);
  const candidate = String(dna.category ?? analysis.main_genre ?? "").trim();
  if (!candidate) return "truyen_ma";
  return slugifyVietnamese(candidate);
}

function resolveDnaLibraryBaseDir(runtime: NodeRuntime, customPath: string | undefined): string {
  const raw = String(customPath ?? "").trim();
  if (!raw) return runtime.path.join(runtime.os.homedir(), "Documents", "DNA_Library");
  if (runtime.path.isAbsolute(raw)) return raw;
  return runtime.path.join(runtime.os.homedir(), raw);
}

export function saveStoryDnaToLibrary(input: SaveStoryDnaInput): SaveStoryDnaResult {
  const runtime = getNodeRuntime();
  if (!runtime) {
    throw new Error("Không có quyền truy cập filesystem cục bộ. Hãy chạy app bằng Electron.");
  }

  const createdAt = new Date().toISOString();
  const normalizedAuthorName = (input.authorName ?? "").trim();
  const isAuthorMode = input.createMode === "tac_gia" && normalizedAuthorName.length > 0;
  const aiCategoryKey = resolveAiCategoryKey(input.analysis);

  const categoryKey = isAuthorMode
    ? `tac_gia_${slugifyVietnamese(normalizedAuthorName)}`
    : aiCategoryKey;
  const subCategoryKey = isAuthorMode
    ? slugifyVietnamese(input.analysis.main_genre || input.analysis.main_style || "tong_quan")
    : slugifyVietnamese(input.analysis.related_genres[0] || input.analysis.main_style || "tong_quan");
  const categoryDisplayName = isAuthorMode
    ? `Tác giả - ${normalizedAuthorName}`
    : toCategoryDisplayNameFromKey(categoryKey);

  const baseDir = resolveDnaLibraryBaseDir(runtime, input.storageDir);
  const indexDir = runtime.path.join(baseDir, "dna_index");
  const objectsDir = runtime.path.join(baseDir, "objects");
  runtime.fs.mkdirSync(indexDir, { recursive: true });
  runtime.fs.mkdirSync(objectsDir, { recursive: true });

  const addressesPath = runtime.path.join(indexDir, "addresses.json");
  const tagsIndexPath = runtime.path.join(indexDir, "all_tags_index.json");
  const categoryPath = runtime.path.join(indexDir, `${categoryKey}.json`);

  const defaultAddresses: PersistedAddresses = {
    version: "1.2.0",
    last_updated: createdAt,
    categories: {},
    search_aliases: {},
  };

  const addresses = readJsonFile(runtime, addressesPath, defaultAddresses);
  const categoryFile = readJsonFile<CategoryFile>(runtime, categoryPath, {
    category: categoryKey,
    version: "1.0.0",
    last_updated: createdAt,
    entries: [],
    sub_category_order: [subCategoryKey],
  });

  const dnaId = generateNextDnaId(categoryFile.entries);
  const dnaDirectory = runtime.path.join(objectsDir, categoryKey, subCategoryKey, dnaId);
  runtime.fs.mkdirSync(dnaDirectory, { recursive: true });

  const coreFile = runtime.path.join(dnaDirectory, "dna_core.json");
  const critiqueFile = runtime.path.join(dnaDirectory, "critique_improvement.json");
  const summaryFile = runtime.path.join(dnaDirectory, "story_summary.json");
  const improvedOutlineFile = runtime.path.join(dnaDirectory, "improved_outline_50.json");

  const strictDnaJson = asRecord(input.analysis.dna_json);
  const strictImprovementJson = asRecord(input.analysis.improvement_json);
  const strictScores = asRecord(strictDnaJson.scores);

  const corePayload = {
    version: "1.1.0",
    dna_id: dnaId,
    ...strictDnaJson,
    title: input.title,
    main_genre: input.analysis.main_genre,
    related_genres: input.analysis.related_genres,
    main_style: input.analysis.main_style,
    related_styles: input.analysis.related_styles,
    tags: input.analysis.tags,
    language: "vi",
    context_country: input.analysis.context_country,
    character_name_plan: input.analysis.character_name_plan,
    character_count: input.analysis.character_count || input.analysis.characters.length,
    characters: input.analysis.characters,
    core_outline: input.analysis.core_outline,
    scores: Object.keys(strictScores).length ? strictScores : input.analysis.score_report,
    score_report: input.analysis.score_report,
      metadata: {
        create_mode: input.createMode,
        file_type: input.fileType,
        author_name: normalizedAuthorName || null,
        source_path: input.sourcePath ?? null,
        created_at: createdAt,
      },
  };

  const critiquePayload = {
    improvement_json: strictImprovementJson,
    critique: input.analysis.critique,
    improvement_guidance: input.analysis.improvement_guidance,
    expert_commentary_md: input.analysis.expert_commentary_md,
    evaluation_commentary_md: input.analysis.evaluation_commentary_md,
  };

  const summaryPayload = {
    title: input.title,
    summary_md: input.analysis.summary_md,
    story_summary: input.analysis.story_summary,
    source_excerpt: input.storyContent.slice(0, 2000),
  };

  const improvedOutlineExpanded = ensureMinItems(
    uniqueKeepOrder([
      ...input.analysis.improved_outline_50,
      ...toFlatStringArray(strictImprovementJson.improved_outline_50),
      ...toFlatStringArray(strictImprovementJson.improved_story_outline),
      ...toFlatStringArray(strictImprovementJson.plot_improvements),
      ...toFlatStringArray(strictImprovementJson.tension_improvements),
      ...toFlatStringArray(strictImprovementJson.ending_improvements),
      ...toFlatStringArray(strictImprovementJson.improvement_rules),
    ]),
    12,
    [
      "Viết lại opening thành một cảnh xung đột ngay lập tức, cắt bỏ dạo đầu thông tin.",
      "Mỗi chương chỉ giữ 1 mục tiêu chính và 1 trở lực rõ ràng để tránh loãng nhịp.",
      "Cài mồi nghi vấn từ sớm và tăng độ nguy cấp theo từng chương theo thang rõ ràng.",
      "Mỗi phân đoạn phải tạo thay đổi trạng thái nhân vật (thêm mất mát, thêm áp lực, thêm lựa chọn khó).",
      "Twist chỉ xuất hiện sau khi đã đủ setup nhân quả, tránh lật kèo vô căn cứ.",
      "Kết thúc mỗi chương bằng hook cụ thể để người đọc buộc phải đọc tiếp chương sau.",
      "Giảm kể lể nội tâm kéo dài, thay bằng hành động, phản ứng và hệ quả nhìn thấy được.",
      "Loại bỏ các cảnh trùng chức năng; mỗi cảnh phải có một thông tin mới hoặc xung đột mới.",
      "Đẩy cao cao trào bằng lựa chọn đạo đức khó, không dùng giải pháp thuận tiện.",
      "Kết truyện để lại dư chấn cảm xúc nhất quán với chủ đề, tránh đóng hời hợt.",
      "Bổ sung payoff cho các chi tiết đã gieo ở nửa đầu để tăng cảm giác thỏa mãn.",
      "Giữ một tuyến bí mật trung tâm xuyên suốt và mở khóa từng lớp theo nhịp kiểm soát.",
    ],
  );

  const characterUpgradePlan = ensureMinItems(
    uniqueKeepOrder([
      ...toFlatStringArray(strictImprovementJson.character_upgrade_plan),
      ...toFlatStringArray(strictImprovementJson.character_improvements),
      ...toFlatStringArray(strictImprovementJson.underdeveloped_elements),
    ]),
    8,
    [
      "Nhân vật chính cần mục tiêu ngoài rõ ràng và cái giá phải trả nếu thất bại.",
      "Tăng xung đột nội tâm bằng một sang chấn hoặc niềm tin sai lầm có hệ quả.",
      "Mỗi nhân vật phụ phải có vai trò chức năng riêng, tránh tồn tại để nói hộ tác giả.",
      "Tạo đối trọng thật sự cho nhân vật chính thay vì phản diện mờ nhạt.",
      "Mỗi quyết định quan trọng phải phản ánh tính cách, không hành động tùy tiện.",
      "Cho nhân vật một khoảnh khắc thất bại lớn trước khi đạt bước ngoặt.",
      "Loại bỏ thoại giải thích bản thân; thay bằng hành vi bộc lộ cá tính.",
      "Khóa arc nhân vật bằng một lựa chọn cuối cùng mang tính trả giá.",
    ],
  );

  const styleUpgradePlan = ensureMinItems(
    uniqueKeepOrder([
      ...toFlatStringArray(strictImprovementJson.style_upgrade_plan),
      ...toFlatStringArray(strictImprovementJson.cinematic_improvements),
      ...toFlatStringArray(strictImprovementJson.improvement_rules),
    ]),
    8,
    [
      "Rút gọn câu dài kể lể, ưu tiên câu hành động ngắn ở đoạn căng thẳng.",
      "Kiểm soát điểm nhìn nhất quán theo từng cảnh, tránh nhảy POV đột ngột.",
      "Tăng mật độ chi tiết cảm giác chọn lọc để tạo không khí thay vì liệt kê.",
      "Thoại phải có ẩn ý và xung đột, tránh đối thoại cung cấp thông tin thô.",
      "Dùng nhịp câu biến thiên để điều khiển tốc độ đọc và cảm xúc.",
      "Mỗi chương giữ một hình ảnh neo thị giác để tăng khả năng ghi nhớ.",
      "Giảm trạng từ/phó từ sáo mòn, thay bằng động từ mạnh và cụ thể.",
      "Giữ giọng văn nhất quán, tránh chuyển tông đột ngột giữa các đoạn.",
    ],
  );

  const coherenceRules = ensureMinItems(
    uniqueKeepOrder([
      ...toFlatStringArray(strictImprovementJson.coherence_upgrade_rules),
      ...toFlatStringArray(strictImprovementJson.logic_issues),
      ...toFlatStringArray(strictImprovementJson.improvement_rules),
    ]),
    8,
    [
      "Mỗi biến cố phải có nguyên nhân trước đó và hệ quả sau đó.",
      "Không thêm nhân vật hoặc quy tắc mới sát cao trào nếu chưa setup.",
      "Đảm bảo timeline rõ ràng: thời điểm, khoảng cách, thứ tự sự kiện.",
      "Mỗi chương phải đẩy ít nhất một tuyến xung đột tiến lên.",
      "Loại bỏ chi tiết không phục vụ chủ đề hoặc tiến triển cốt truyện.",
      "Giữ logic thế giới truyện nhất quán, không phá luật đã thiết lập.",
      "Mọi twist cần dấu vết ngầm từ sớm để tránh cảm giác gian lận.",
      "Kiểm tra liên tục mối quan hệ nhân quả giữa hành động và kết quả.",
    ],
  );

  const readerRetentionPlan = ensureMinItems(
    uniqueKeepOrder([
      ...toFlatStringArray(strictImprovementJson.reader_retention_plan),
      ...toFlatStringArray(strictImprovementJson.tension_improvements),
      ...toFlatStringArray(strictImprovementJson.improvement_rules),
    ]),
    8,
    [
      "Mở chương bằng câu hỏi chưa trả lời hoặc hậu quả của cliffhanger trước.",
      "Tăng stakes định kỳ sau mỗi 1-2 chương.",
      "Mỗi chương kết bằng lựa chọn khó hoặc thông tin đảo chiều.",
      "Xen kẽ nhịp nhanh/chậm có chủ đích để tránh mệt mỏi đơn điệu.",
      "Đưa phần thưởng thông tin nhỏ đều đặn để duy trì tò mò.",
      "Giữ mục tiêu chương rõ ràng để người đọc luôn biết đang theo dõi điều gì.",
      "Cài thời hạn áp lực (deadline) cho các quyết định quan trọng.",
      "Giảm đoạn độc thoại kéo dài không tạo thay đổi trạng thái.",
    ],
  );

  const antiBoredomRules = ensureMinItems(
    uniqueKeepOrder([
      ...toFlatStringArray(strictImprovementJson.anti_boredom_rules),
      ...toFlatStringArray(strictImprovementJson.pacing_issues),
      ...toFlatStringArray(strictImprovementJson.improvement_rules),
    ]),
    8,
    [
      "Cắt các đoạn mở rộng bối cảnh không gắn xung đột.",
      "Không để hai cảnh liên tiếp cùng mục tiêu và cùng nhịp.",
      "Mỗi cảnh phải có ít nhất một biến đổi thông tin hoặc quyền lực.",
      "Giảm mô tả lặp lại cảm giác sợ hãi theo cùng công thức.",
      "Xen các tình huống bất ngờ hợp lý thay vì kéo dài dự báo trước được.",
      "Ưu tiên động từ cụ thể, tránh câu mơ hồ thiếu hành động.",
      "Rà soát và loại mọi câu giải thích mà độc giả đã tự suy ra được.",
      "Giữ thời lượng cảnh vừa đủ, kết cảnh ngay sau điểm tác động mạnh.",
    ],
  );

  const antiRepetitionRules = ensureMinItems(
    uniqueKeepOrder([
      ...toFlatStringArray(strictImprovementJson.anti_repetition_rules),
      ...toFlatStringArray(strictImprovementJson.forbidden_patterns),
      ...toFlatStringArray(strictImprovementJson.improvement_rules),
    ]),
    8,
    [
      "Không lặp lại cùng một mô-típ hù dọa quá hai lần.",
      "Mỗi lần xung đột quay lại phải có biến thể mới về bối cảnh hoặc hệ quả.",
      "Tránh vòng lặp sự kiện không tạo tiến triển nhân vật.",
      "Không tái sử dụng cùng mẫu cliffhanger ở nhiều chương liên tiếp.",
      "Biến đổi cách xuất hiện của manh mối để tránh công thức dễ đoán.",
      "Mỗi chương chỉ giữ một trọng tâm xung đột chính để tránh lặp ý.",
      "Giảm lặp từ khóa, lặp hình ảnh và lặp cấu trúc câu giống nhau.",
      "Mọi callback phải mở rộng ý nghĩa, không chỉ nhắc lại chi tiết cũ.",
    ],
  );

  const improvedOutlinePayload = {
    title: input.title,
    improved_outline_50: improvedOutlineExpanded,
    character_upgrade_plan: characterUpgradePlan,
    style_upgrade_plan: styleUpgradePlan,
    coherence_upgrade_rules: coherenceRules,
    reader_retention_plan: readerRetentionPlan,
    anti_boredom_rules: antiBoredomRules,
    anti_repetition_rules: antiRepetitionRules,
    source_improvement_json: strictImprovementJson,
    note: "Dàn ý cải thiện nhằm thay đổi đáng kể cấu trúc gốc để giảm rủi ro trùng lặp.",
  };

  writeJsonFile(runtime, coreFile, corePayload);
  writeJsonFile(runtime, critiqueFile, critiquePayload);
  writeJsonFile(runtime, summaryFile, summaryPayload);
  writeJsonFile(runtime, improvedOutlineFile, improvedOutlinePayload);

  const relativeCoreFromIndex = toPosixPath(runtime.path.relative(indexDir, coreFile));
  const estimatedSizeMb = Number((new Blob([input.storyContent]).size / (1024 * 1024)).toFixed(2));
  const overallScore = getOverallScore(input.analysis);

  const entry: DnaEntry = {
    dna_id: dnaId,
    category: categoryKey,
    title: input.title,
    source_file: relativeCoreFromIndex,
    sub_category: subCategoryKey,
    styles: ensureUniqueSorted([input.analysis.main_style, ...input.analysis.related_styles]),
    tags: ensureUniqueSorted(input.analysis.tags),
    status: "ready",
    source_type: mapFileTypeToSourceType(input.fileType),
    size_mb: estimatedSizeMb || 0.01,
    scores: {
      overall: overallScore,
      fear_factor: Number(input.analysis.score_report.fear_factor.score.toFixed(2)),
      twist_power: Number(input.analysis.score_report.twist_power.score.toFixed(2)),
      cinematic_quality: Number(input.analysis.score_report.cinematic_quality.score.toFixed(2)),
      reusability: Number(input.analysis.score_report.reusability_as_dna.score.toFixed(2)),
    },
    created_at: createdAt,
    match_bonus: {
      genre_match: 40,
      style_match: 25,
    },
  };

  categoryFile.entries = [entry, ...categoryFile.entries];
  categoryFile.sub_category_order = ensureUniqueSorted([...categoryFile.sub_category_order, subCategoryKey]);
  categoryFile.last_updated = createdAt;
  writeJsonFile(runtime, categoryPath, categoryFile);

  const relatedKeys = ensureUniqueSorted(input.analysis.related_genres.map((value) => slugifyVietnamese(value))).filter((value) => value && value !== categoryKey);
  const existingCategory = addresses.categories[categoryKey];
  const nextCategory: CategoryAddress = existingCategory
    ? {
        ...existingCategory,
        display_name: categoryDisplayName,
      }
    : {
        filename: `${categoryKey}.json`,
        display_name: categoryDisplayName,
        sub_categories: [],
        related: [],
        entry_count: 0,
        priority: isAuthorMode ? 5 : 6,
      };

  nextCategory.sub_categories = ensureUniqueSorted([...nextCategory.sub_categories, subCategoryKey]);
  nextCategory.related = ensureUniqueSorted([...nextCategory.related, ...relatedKeys]);
  nextCategory.entry_count = categoryFile.entries.length;

  addresses.categories[categoryKey] = nextCategory;
  addresses.last_updated = createdAt;
  addresses.search_aliases[normalizeForAlias(categoryDisplayName)] = categoryKey;
  addresses.search_aliases[normalizeForAlias(input.analysis.main_genre)] = categoryKey;
  if (normalizedAuthorName) {
    addresses.search_aliases[normalizeForAlias(normalizedAuthorName)] = categoryKey;
  }
  writeJsonFile(runtime, addressesPath, addresses);

  const tagsIndex = readJsonFile<PersistedTagsIndex>(runtime, tagsIndexPath, {
    version: "1.0.0",
    last_updated: createdAt,
    tag_map: {},
  });

  entry.tags.forEach((tag) => {
    const key = normalizeForAlias(tag);
    if (!key) return;
    const existing = tagsIndex.tag_map[key] ?? [];
    if (!existing.some((item) => item.dna_id === entry.dna_id)) {
      existing.push({
        category: entry.category,
        dna_id: entry.dna_id,
        title: entry.title,
      });
    }
    tagsIndex.tag_map[key] = existing;
  });

  tagsIndex.last_updated = createdAt;
  writeJsonFile(runtime, tagsIndexPath, tagsIndex);

  return {
    entry,
    baseDir,
    dnaDirectory,
    files: {
      core: coreFile,
      critique: critiqueFile,
      summary: summaryFile,
      improvedOutline: improvedOutlineFile,
    },
  };
}

export function readFullDnaPayload(storageDir: string, entry: DnaEntry): Record<string, unknown> | null {
  const runtime = getNodeRuntime();
  if (!runtime || !entry.source_file) return null;
  
  const baseDir = resolveDnaLibraryBaseDir(runtime, storageDir);
  const indexDir = runtime.path.join(baseDir, "dna_index");
  // entry.source_file is like "objects/category/sub_category/dna_id/dna_core.json"
  // so we resolve it from indexDir. Wait, actually relativeCoreFromIndex was from indexDir to coreFile.
  const coreFilePath = runtime.path.join(indexDir, entry.source_file);
  const dnaDir = runtime.path.dirname(coreFilePath);

  if (!runtime.fs.existsSync(coreFilePath)) return null;

  try {
    const coreJson = JSON.parse(runtime.fs.readFileSync(coreFilePath, "utf8"));
    
    // Also try to read summary
    const summaryFile = runtime.path.join(dnaDir, "story_summary.json");
    let summaryJson = null;
    if (runtime.fs.existsSync(summaryFile)) {
      summaryJson = JSON.parse(runtime.fs.readFileSync(summaryFile, "utf8"));
    }

    return {
      dna_id: entry.dna_id,
      title: entry.title,
      core: coreJson,
      summary: summaryJson
    };
  } catch {
    return null;
  }
}

