import type { StoryBlueprintResult } from "./blueprintApi";
import type { StoryFactorDefinition } from "./storyFactors";
import { normalizeFactorKey } from "./storyFactors";
import { STORY_REVIEWER_SYSTEM_PROMPT, STORY_WRITER_SYSTEM_PROMPT, STORY_SELF_REVIEWER_SYSTEM_PROMPT } from "./prompts";
import type { DnaEntry } from "./types";
import { recordMetric } from "../utils/metrics";
import { sendBrowserWriterPrompt, startBrowserWriterSession, closeBrowserWriterSession } from "../utils/electronBridge";

const DEFAULT_BEE_API_URL = "https://platform.beeknoee.com/api/v1/chat/completions";
const DEFAULT_BEE_MODEL = "openai/gpt-oss-120b";

const RESERVED_REQUEST_KEYS = new Set([
  "story_title",
  "genre",
  "styles",
  "length_mode",
  "total_words",
  "avg_words_per_chapter",
  "story_language",
  "character_name_language",
  "target_intensity",
  "ending_type",
  "extra_prompt",
  "enabled_factors",
  "disabled_factors",
]);

const MAX_CHAT_RETRIES = 3;
const MAX_DNA_CONTEXT = 4;
const MAX_FACTOR_CONTEXT = 8;
const MAX_FULL_RECENT_CHAPTERS = 2;
const MAX_RECENT_CHAPTER_CHARS = 2400;
const MAX_OLDER_CHAPTER_SUMMARY = 220;

type JsonRecord = Record<string, unknown>;

export type StoryCreationRequest = {
  story_title: string;
  genre: string;
  styles: string[];
  length_mode: "total_words";
  total_words: number;
  avg_words_per_chapter: number;
  story_language: string;
  character_name_language: string;
  target_intensity: string;
  ending_type: string;
  extra_prompt: string;
  factor_flags: Record<string, boolean>;
};

export type StoryDraftChapter = {
  chapter_number: number;
  chapter_title: string;
  target_words: number;
  content: string;
};

export type StoryDraftResult = {
  story_title: string;
  chapter_count: number;
  chapters: StoryDraftChapter[];
  quality_gate: {
    continuity_check: string;
    must_fix_next: string[];
    chapter_reviews?: Array<{
      chapter_number: number;
      quality_score: number;
      is_pass: boolean;
      summary: string;
      must_fix: string[];
      next_chapter_guidance: string;
    }>;
  };
};

export type StoryReviewResult = {
  is_pass: boolean;
  quality_score: number;
  summary: string;
  must_fix: string[];
  strengths: string[];
};

export type StoryDnaSource = {
  dna_id: string;
  title: string;
  category: string;
  sub_category: string;
  styles: string[];
  tags: string[];
  score: number;
  summary_hint: string;
  /** Full writing_styles payload from dna_core.json, available when "Lấy Văn Phong" is active */
  writing_styles_payload?: Record<string, unknown>;
  /** Full core/structure payload from dna_core.json, available when "Lấy Cốt Truyện" is active */
  core_payload?: Record<string, unknown>;
};

export type GenerateStoryDraftOptions = {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  reviewerModel?: string;
  request: StoryCreationRequest;
  blueprint: StoryBlueprintResult;
  sources: StoryDnaSource[];
  factors: StoryFactorDefinition[];
  onProgress?: (message: string) => void;
  customStoryPrompt?: string;
};

export type GenerateStoryDraftBrowserOptions = Omit<GenerateStoryDraftOptions, "apiKey" | "apiUrl" | "model"> & {
  writerSessionId: string;
  reviewerApiKey: string;
  reviewerApiUrl?: string;
  cookieFilePath: string;
  chatUrl?: string;
  windowIndex?: number;
  skipReview?: boolean;
};

export type ReviewStoryDraftOptions = {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  request: StoryCreationRequest;
  blueprint: StoryBlueprintResult;
  draft: StoryDraftResult;
  sources: StoryDnaSource[];
  factors: StoryFactorDefinition[];
  customStoryPrompt?: string;
};

type ChapterReviewResult = {
  chapter_number: number;
  is_pass: boolean;
  quality_score: number;
  summary: string;
  must_fix: string[];
  next_chapter_guidance: string;
  rewrite_current_chapter: boolean;
  continuity_bridge: string;
  unresolved_threads: string[];
  no_repeat_rules: string[];
  timeline_marker: string;
};

function asRecord(val: unknown): JsonRecord {
  return val && typeof val === "object" ? (val as JsonRecord) : {};
}

function toNumber(val: unknown, fallback: number): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const num = Number(val);
    return Number.isNaN(num) ? fallback : num;
  }
  return fallback;
}

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((item) => String(item));
  return [];
}

function firstString(val: unknown, fallback: string): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val) && val.length > 0) return String(val[0]);
  return fallback;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function compactText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}

export function parseStoryCreationRequest(json: string): StoryCreationRequest {
  const raw = JSON.parse(json);
  const story_title = String(raw.story_title || "").trim();
  const genre = String(raw.genre || "").trim();
  const styles = toStringArray(raw.styles);
  const total_words = toNumber(raw.total_words, 35000);
  const avg_words_per_chapter = toNumber(raw.avg_words_per_chapter, 5000);
  const story_language = String(raw.story_language || "tieng_viet").trim();
  const character_name_language = String(raw.character_name_language || "tieng_anh").trim();
  const target_intensity = String(raw.target_intensity || "trung_binh").trim();
  const ending_type = String(raw.ending_type || "bat_ngo").trim();
  const extra_prompt = String(raw.extra_prompt || "").trim();

  const factor_flags: Record<string, boolean> = {};
  Object.keys(raw).forEach((key) => {
    if (RESERVED_REQUEST_KEYS.has(key)) return;
    if (typeof raw[key] === "boolean") {
      factor_flags[key] = raw[key];
    }
  });

  return {
    story_title,
    genre,
    styles,
    length_mode: "total_words",
    total_words,
    avg_words_per_chapter,
    story_language,
    character_name_language,
    target_intensity,
    ending_type,
    extra_prompt,
    factor_flags,
  };
}

export function pickActiveFactors(request: StoryCreationRequest, factors: StoryFactorDefinition[]): StoryFactorDefinition[] {
  return factors.filter((factor) => {
    const normalized = normalizeFactorKey(factor.key);
    if (request.factor_flags[normalized] === true) return true;
    if (request.factor_flags[normalized] === false) return false;
    return factor.enabled_by_default === true;
  });
}

function computeChapterCount(total: number, avg: number): number {
  const t = Math.max(1000, total);
  const a = Math.max(1000, avg);
  return Math.ceil(t / a);
}

function buildSourceDigest(sources: StoryDnaSource[], activeFactors: StoryFactorDefinition[]): Record<string, unknown>[] {
  const hasLayToanBo = activeFactors.some((f) => f.key === "lay_toan_bo_dna");
  const hasLayVanPhong = activeFactors.some((f) => f.key === "lay_van_phong");
  const hasLayCotTruyen = activeFactors.some((f) => f.key === "lay_cot_truyen");

  return sources.slice(0, MAX_DNA_CONTEXT).map((source) => {
    const digest: Record<string, unknown> = {
      dna_id: source.dna_id,
      title: source.title,
      category: source.category,
      sub_category: source.sub_category,
      styles: source.styles,
      tags: source.tags,
      score: source.score,
    };

    if (hasLayToanBo) {
      digest.writing_styles_payload = source.writing_styles_payload;
      digest.core_payload = source.core_payload;
    } else {
      if (hasLayVanPhong) digest.writing_styles_payload = source.writing_styles_payload;
      if (hasLayCotTruyen) digest.core_payload = source.core_payload;
    }

    return digest;
  });
}

function buildSourceExecutionPlan(sources: StoryDnaSource[], activeFactors: StoryFactorDefinition[]): string[] {
  return sources.slice(0, MAX_DNA_CONTEXT).map((s, idx) => {
    if (idx === 0) return `DNA NEO [${s.title}]: Day la van phong vung, logic goc.`;
    if (idx === 1) return `DNA BIEN THE [${s.title}]: Lay motif hoac cach dung tu cua DNA nay de mutation vao DNA neo.`;
    return `DNA GIA VI [${s.title}]: Lay cac hinh anh dac trung cua DNA nay.`;
  });
}

function buildFactorDigest(factors: StoryFactorDefinition[]): Record<string, unknown>[] {
  return factors.slice(0, MAX_FACTOR_CONTEXT).map((f) => ({
    key: f.key,
    label: f.title,
    description: f.description,
    instruction: f.prompt,
  }));
}

function buildMemoryPack(chapters: StoryDraftChapter[]): Record<string, unknown> {
  const packets = chapters.slice(-3).map((c) => ({
    chapter_number: c.chapter_number,
    chapter_title: c.chapter_title,
    ending_excerpt: compactText(c.content.split("\n").slice(-3).join("\n"), 600),
    summary: "...",
  }));

  const recent = chapters.slice(-MAX_FULL_RECENT_CHAPTERS).map((c) => ({
    chapter_number: c.chapter_number,
    content: compactText(c.content, MAX_RECENT_CHAPTER_CHARS),
  }));

  const older = chapters
    .slice(0, -MAX_FULL_RECENT_CHAPTERS)
    .slice(-10)
    .map((c) => ({
      chapter_number: c.chapter_number,
      chapter_title: c.chapter_title,
      summary: "...",
    }));

  const latest = packets[packets.length - 1];

  return {
    recent_full_chapters: recent,
    older_chapter_summaries: older,
    latest_ending_bridge: latest?.ending_excerpt || "Khong co canh ket chuong truoc.",
  };
}

function buildBlueprintDigest(blueprint: StoryBlueprintResult, chapterNumber: number): Record<string, unknown> {
  const chapterOutline = Array.isArray(blueprint.chapter_outline) ? blueprint.chapter_outline : [];
  const current = chapterOutline.find((item) => item.chapter_number === chapterNumber) ?? chapterOutline[Math.max(0, chapterNumber - 1)] ?? null;
  return {
    logline: compactText(blueprint.logline, 280),
    theme_and_core_message: compactText(blueprint.theme_and_core_message, 280),
    world_building: {
      ambiance_and_tone: compactText(blueprint.world_building?.ambiance_and_tone ?? "", 260),
      key_locations: (blueprint.world_building?.key_locations ?? []).slice(0, 4),
      rules_of_the_world: (blueprint.world_building?.rules_of_the_world ?? []).slice(0, 5),
    },
    character_roster: (blueprint.character_roster ?? []).slice(0, 6).map((character) => ({
      name: character.name,
      role: character.role,
      external_goal: compactText(character.external_goal, 140),
      internal_flaw: compactText(character.internal_flaw, 140),
      dark_secret: compactText(character.dark_secret, 140),
      arc_trajectory: compactText(character.arc_trajectory, 140),
    })),
    current_chapter_outline: current
      ? {
          chapter_number: current.chapter_number,
          chapter_title: current.chapter_title,
          pov_character: current.pov_character,
          setting: current.setting,
          plot_beats: current.plot_beats?.slice(0, 6) ?? [],
          tension_level: current.tension_level,
          hook_at_ending: current.hook_at_ending,
        }
      : null,
  };
}

function buildCarryGuidanceFromReview(review: ChapterReviewResult): string {
  const lines = [
    `Bridge bắt buộc: ${review.continuity_bridge}`,
    `Timeline marker: ${review.timeline_marker}`,
    `Unresolved threads: ${review.unresolved_threads.join("; ") || "không có"}`,
    `No-repeat rules: ${review.no_repeat_rules.join("; ") || "không có"}`,
  ];
  return lines.join("\n");
}

function buildChapterWriterPromptV2(
  options: Pick<GenerateStoryDraftOptions, "request" | "sources" | "blueprint">,
  chapterCount: number,
  activeFactors: StoryFactorDefinition[],
  previousChapters: StoryDraftChapter[],
  chapterNumber: number,
  targetWords: number,
  carryGuidance: string,
  customStoryPrompt?: string,
): string {
  const memoryPack = buildMemoryPack(previousChapters);
  const sourceDigest = buildSourceDigest(options.sources, activeFactors);
  const sourceExecutionPlan = buildSourceExecutionPlan(options.sources, activeFactors);
  const factorDigest = buildFactorDigest(activeFactors);
  const blueprintDigest = buildBlueprintDigest(options.blueprint, chapterNumber);

  const systemPromptToUse = customStoryPrompt?.trim()
    ? `[HƯỚNG DẪN HỆ THỐNG ƯU TIÊN: ${customStoryPrompt.trim()}]\n\n${STORY_WRITER_SYSTEM_PROMPT}`
    : STORY_WRITER_SYSTEM_PROMPT;

  return [
    systemPromptToUse,
    "",
    `Nhiem vu: Viet CHUONG ${chapterNumber}/${chapterCount}.`,
    "DAU RA BAT BUOC: chi tra ve VAN BAN THUAN cua chuong, khong JSON, khong code block.",
    "",
    "Thong so truyen:",
    JSON.stringify(
      {
        story_title: options.request.story_title,
        genre: options.request.genre,
        styles: options.request.styles,
        target_intensity: options.request.target_intensity,
        ending_type: options.request.ending_type,
        story_language: options.request.story_language,
        character_name_language: options.request.character_name_language,
        extra_prompt: compactText(options.request.extra_prompt, 260),
      },
      null,
      2,
    ),
    "",
    "DNA digest:",
    JSON.stringify(sourceDigest, null, 2),
    "",
    "DNA execution plan:",
    JSON.stringify(sourceExecutionPlan, null, 2),
    "",
    "",
    "Yeu to bat:",
    options.sources.length > 0 ? JSON.stringify(factorDigest, null, 2) : "KHONG CO DNA THAM KHAO.",
    activeFactors.length > 0 ? activeFactors.map(f => `- [${f.title}]: ${f.prompt}`).join("\n") : "",
    "",
    "Blueprint digest:",
    JSON.stringify(blueprintDigest, null, 2),
    "",
    "Memory pack tu chuong truoc:",
    JSON.stringify(memoryPack, null, 2),
    "",
    `Huong dan bo sung cho chuong ${chapterNumber}:`,
    carryGuidance || "Khong co.",
    "",
    "Quy tac cung:",
    "- TÊN NHÂN VẬT: Tuân thủ tuyệt đối tên nhân vật trong JSON Blueprint (character_roster). Không tự ý dịch tên tiếng Anh sang tiếng Việt hay ngược lại. Giữ nguyên danh tính và ngôn ngữ của tên gọi y hệt như đã quy định trong dàn ý.",
    "- LIÊN KẾT CHẶT CHẼ & LIỀN MẠCH: Hành động, tông màu, ánh sáng, và cảm xúc của phân cảnh mở đầu chương này BẮT BUỘC phải KHỚP HOÀN TOÀN với cảnh kết thúc hoặc dư âm của chương trước. Nếu chương trước kết thúc kịch tính, tối tăm, thì chương này phải tiếp nối ngay khoảnh khắc đó. TUYỆT ĐỐI KHÔNG ngắt quãng thời gian vô lý hay tự nhiên trời sáng trưng mất đi không khí.",
    chapterNumber > 1
      ? "- 3 doan dau cua chuong nay phai noi truc tiep he qua tu cuoi chuong truoc, khong duoc reset boi canh."
      : "- Chuong 1 phai dat xung dot trung tam va moc keo chuong 2.",
    options.sources.length > 0 ? "- Phai tuan thu DNA execution plan. Neu chuong viet ra co the tach DNA ma van dung thi xem nhu sai." : "",
    options.sources.length > 0 ? "- Moi chuong phai su dung it nhat 1 chat lieu structural hoac motif tu DNA neo va 1 chi tiet tu DNA ho tro." : "",
    options.sources.length > 0 ? "- Neu DNA diem cao nhat va DNA neo mau thuan, uu tien DNA neo cho logic, uu tien DNA diem cao cho do sac cua van phong va hook." : "",
    "- Cam lap nguyen van doan mo ta dai tu chuong truoc.",
    "- Moi chuong phai co tien trien khong the dao nguoc: thong tin moi, he qua moi, quyet dinh moi, hoac gia tang ap luc moi.",
    "- Khong ke le lan man. Uu tien hanh dong, phan ung, he qua, va bien thien canh.",
    "- Cam nhay canh vo co. Cam doi nhiet do cam xuc vo ly. Cam ket chuong an toan.",
    "- Neu mot motif da xuat hien, lan sau phai nang cap he qua hoac doi goc nhin; khong duoc lap lai chi de nhac nho.",
    "- Moi chuong phai co it nhat 1 hinh anh hoac am thanh neo tri nho de noi qua chuong sau.",
    `- ĐỘ DÀI: BẮT BUỘC viết TRONG KHOẢNG ${targetWords} KÝ TỰ (Characters, không phải là 'từ/words'). BẠN BỊ CẤM VIẾT DÀI DÒNG, BÔI CHỮ, KỂ LỂ QUÁ ĐÀ. Chỉ mô tả vừa đủ nét, cắt bỏ các đoạn suy nghĩ rườm rà không tạo ra hành động. Viết súc tích, nhịp điệu nhanh và dừng đúng lúc đạt mục tiêu cảnh.`
  ].filter(Boolean).join("\n");
}

function buildChapterReviewPrompt(
  options: ReviewStoryDraftOptions,
  activeFactors: StoryFactorDefinition[],
  previousChapters: StoryDraftChapter[],
  currentChapter: StoryDraftChapter,
): string {
  const sourceDigest = buildSourceDigest(options.sources, activeFactors);
  const factorDigest = buildFactorDigest(activeFactors);
  const blueprintDigest = buildBlueprintDigest(options.blueprint, currentChapter.chapter_number);
  const memoryPack = buildMemoryPack(previousChapters);

  const systemPromptToUse = options.customStoryPrompt?.trim()
    ? `[HƯỚNG DẪN HỆ THỐNG ƯU TIÊN: ${options.customStoryPrompt.trim()}]\n\n${STORY_REVIEWER_SYSTEM_PROMPT}`
    : STORY_REVIEWER_SYSTEM_PROMPT;

  return [
    systemPromptToUse,
    "",
    `Đánh giá CHƯƠNG ${currentChapter.chapter_number} và trả về đúng 1 JSON object hợp lệ.`,
    "",
    "Schema bắt buộc:",
    JSON.stringify(
      {
        chapter_number: currentChapter.chapter_number,
        is_pass: true,
        quality_score: 8.0,
        summary: "Nhận xét tổng quan chương.",
        must_fix: ["Lỗi cần sửa nếu có"],
        next_chapter_guidance: "Yêu cầu viết chương kế.",
        rewrite_current_chapter: false,
        continuity_bridge: "Hệ quả cuối chương này phải mở sang chương sau.",
        unresolved_threads: ["thread A"],
        no_repeat_rules: ["Cấm lặp mô tả X"],
        timeline_marker: "Mốc thời gian kết chương",
      },
      null,
      2,
    ),
    "",
    "Thông số truyện:",
    JSON.stringify(
      {
        story_title: options.request.story_title,
        genre: options.request.genre,
        styles: options.request.styles,
        target_intensity: options.request.target_intensity,
        ending_type: options.request.ending_type,
      },
      null,
      2,
    ),
    "",
    "DNA digest:",
    JSON.stringify(sourceDigest, null, 2),
    "",
    "Yếu tố bật:",
    JSON.stringify(factorDigest, null, 2),
    "",
    "Blueprint digest:",
    JSON.stringify(blueprintDigest, null, 2),
    "",
    "Memory pack chương trước:",
    JSON.stringify(memoryPack, null, 2),
    "",
    "Chương cần review:",
    JSON.stringify(
      {
        chapter_number: currentChapter.chapter_number,
        chapter_title: currentChapter.chapter_title,
        content: compactText(currentChapter.content, 5000),
      },
      null,
      2,
    ),
    "",
    "Quy tắc đánh giá:",
    "- Nếu mở đầu không nối logic với cuối chương trước => rewrite_current_chapter=true.",
    "- Nếu có lặp vòng/nhai lại xung đột cũ không thêm hệ quả => rewrite_current_chapter=true.",
    "- next_chapter_guidance phải chỉ ra rõ: cần gì và tránh gì.",
    "- no_repeat_rules phải là các điều cấm cụ thể cho chương sau.",
  ].join("\n");
}

function normalizeStoryReview(raw: unknown, sources: StoryDnaSource[]): StoryReviewResult {
  const record = asRecord(raw);
  const rawQualityScore = clamp(Number(toNumber(record.quality_score, 0).toFixed(1)), 0, 10);
  const mustFix = toStringArray(record.must_fix);
  const strengths = toStringArray(record.strengths);
  const sourceScores = sources.map((item) => clamp(Number(toNumber(item.score, 0).toFixed(1)), 0, 10)).filter((score) => score > 0);

  let qualityScore = rawQualityScore;
  if (sourceScores.length > 0) {
    const sourceAvg = sourceScores.reduce((sum, score) => sum + score, 0) / sourceScores.length;
    const sourceMax = Math.max(...sourceScores);
    const scoreCeiling = Math.min(9, Math.max(sourceAvg + 0.8, sourceMax + 0.6));
    const penalty = Math.min(1.4, mustFix.length * 0.22) + (Boolean(record.is_pass) ? 0 : 0.4);
    qualityScore = clamp(Number((Math.min(rawQualityScore, scoreCeiling) - penalty).toFixed(1)), 0, 10);
  }

  const summaryBase = firstString(record.summary, "Chưa có nhận xét reviewer.");
  const summary =
    Math.abs(qualityScore - rawQualityScore) >= 0.2
      ? `${summaryBase}\n[Hiệu chỉnh điểm theo DNA nguồn: ${rawQualityScore.toFixed(1)} -> ${qualityScore.toFixed(1)}]`
      : summaryBase;
  const normalizedPass = qualityScore >= 7 && mustFix.length <= 2;

  return {
    is_pass: normalizedPass,
    quality_score: qualityScore,
    summary,
    must_fix: mustFix,
    strengths,
  };
}

function buildFinalReviewPrompt(options: ReviewStoryDraftOptions): string {
  const sourceDigest = buildSourceDigest(options.sources, options.factors);
  const factorDigest = buildFactorDigest(options.factors);
  const chapterDigests = options.draft.chapters.map((chapter) => ({
    chapter_number: chapter.chapter_number,
    chapter_title: chapter.chapter_title,
    excerpt_opening: compactText(chapter.content.slice(0, 220), 220),
    excerpt_ending: compactText(chapter.content.slice(-220), 220),
    content_length: chapter.content.length,
  }));

  const systemPromptToUse = options.customStoryPrompt?.trim()
    ? `[HƯỚNG DẪN HỆ THỐNG ƯU TIÊN: ${options.customStoryPrompt.trim()}]\n\n${STORY_REVIEWER_SYSTEM_PROMPT}`
    : STORY_REVIEWER_SYSTEM_PROMPT;

  return [
    systemPromptToUse,
    "",
    "Bạn là reviewer tổng kết toàn bộ truyện. Trả về đúng 1 JSON object hợp lệ.",
    "Schema bắt buộc:",
    JSON.stringify(
      {
        is_pass: true,
        quality_score: 8.2,
        summary: "Đánh giá tổng thể.",
        strengths: ["Điểm mạnh"],
        must_fix: ["Điểm cần sửa"],
      },
      null,
      2,
    ),
    "",
    "Thông số truyện:",
    JSON.stringify(
      {
        story_title: options.request.story_title,
        genre: options.request.genre,
        styles: options.request.styles,
        target_intensity: options.request.target_intensity,
        ending_type: options.request.ending_type,
      },
      null,
      2,
    ),
    "",
    "DNA digest:",
    JSON.stringify(sourceDigest, null, 2),
    "",
    "Yếu tố bật:",
    JSON.stringify(factorDigest, null, 2),
    "",
    "Blueprint digest:",
    JSON.stringify(buildBlueprintDigest(options.blueprint, 1), null, 2),
    "",
    "Tóm tắt toàn bộ chương:",
    JSON.stringify(chapterDigests, null, 2),
    "",
    "Quality gate nội bộ:",
    JSON.stringify(options.draft.quality_gate, null, 2),
    "",
    "Đánh giá nghiêm khắc tính mạch lạc toàn truyện, độ cuốn, chống lặp, mức tuân thủ DNA/yếu tố.",
  ].join("\n");
}

export function toStoryDnaSources(entries: DnaEntry[]): StoryDnaSource[] {
  return entries.map((entry) => {
    const raw = entry as any;
    const fullPayload = raw.full_payload || {};
    return {
      dna_id: entry.dna_id,
      title: entry.title,
      category: entry.category,
      sub_category: entry.sub_category,
      styles: entry.styles.slice(0, 4),
      tags: entry.tags.slice(0, 8),
      score: Number(entry.scores.overall.toFixed(2)),
      summary_hint: `${entry.title} | ${entry.sub_category} | ${entry.styles.slice(0, 2).join(", ")}`,
      writing_styles_payload: fullPayload.writing_styles || fullPayload.styles,
      core_payload: fullPayload.core || fullPayload.structures,
    };
  });
}

function normalizeChapterGeneration(candidate: any, raw: string, num: number, target: number, title: string): StoryDraftChapter {
  const record = asRecord(candidate);
  return {
    chapter_number: num,
    chapter_title: String(record.chapter_title || title || `Chuong ${num}`).trim(),
    target_words: target,
    content: (record.content ? String(record.content) : raw).trim(),
  };
}

function normalizeChapterReview(raw: any, num: number): ChapterReviewResult {
  const record = asRecord(raw);
  return {
    chapter_number: num,
    is_pass: Boolean(record.is_pass),
    quality_score: clamp(toNumber(record.quality_score, 0), 0, 10),
    summary: String(record.summary || "").trim(),
    must_fix: toStringArray(record.must_fix),
    next_chapter_guidance: String(record.next_chapter_guidance || "").trim(),
    rewrite_current_chapter: Boolean(record.rewrite_current_chapter),
    continuity_bridge: String(record.continuity_bridge || "").trim(),
    unresolved_threads: toStringArray(record.unresolved_threads),
    no_repeat_rules: toStringArray(record.no_repeat_rules),
    timeline_marker: String(record.timeline_marker || "").trim(),
  };
}

async function callChatCompletions(apiKey: string, apiUrl: string, body: any): Promise<any> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API Error: ${res.status} - ${text}`);
  }
  return res.json();
}

function getDirectJsonCandidate(payload: any): any {
  const content = getChoiceContent(payload);
  return parseJsonFromText(content);
}

function getChoiceContent(payload: any): string {
  if (payload.choices && payload.choices[0] && payload.choices[0].message) {
    return payload.choices[0].message.content || "";
  }
  return "";
}

function parseJsonFromText(text: string): any {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function generateStoryDraftChapterByChapter(input: {
  options: GenerateStoryDraftOptions;
  apiKey: string;
  apiUrl: string;
  model: string;
  chapterCount: number;
  targetWords: number;
  activeFactors: StoryFactorDefinition[];
}): Promise<StoryDraftResult> {
  const { options, apiKey, apiUrl, model, chapterCount, targetWords, activeFactors } = input;
  const chapterReviewerModel = (options.reviewerModel ?? model).trim() || model;
  const chapters: StoryDraftChapter[] = [];

  let carryGuidance = "";
  for (let chapterNumber = 1; chapterNumber <= chapterCount; chapterNumber += 1) {
    let attempt = 0;
    let finalChapter: StoryDraftChapter | null = null;

    while (attempt < 3) {
      options.onProgress?.(`Đang tạo chương ${chapterNumber}/${chapterCount}${attempt > 0 ? " (lại)" : ""}...`);

      const chapterPayload = await callChatCompletions(apiKey, apiUrl, {
        model,
        messages: [
          { role: "system", content: options.customStoryPrompt?.trim() ? `[HƯỚNG DẪN HỆ THỐNG ƯU TIÊN: ${options.customStoryPrompt.trim()}]\n\n${STORY_WRITER_SYSTEM_PROMPT}` : STORY_WRITER_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildChapterWriterPromptV2(options, chapterCount, activeFactors, chapters, chapterNumber, targetWords, carryGuidance, options.customStoryPrompt),
          },
        ],
        temperature: 0.62,
      });

      const chapterJsonCandidate = getDirectJsonCandidate(chapterPayload) ?? parseJsonFromText(getChoiceContent(chapterPayload));
      const chapterText = getChoiceContent(chapterPayload);
      const blueprintChapter = options.blueprint.chapter_outline.find((item) => item.chapter_number === chapterNumber);
      const chapter = normalizeChapterGeneration(chapterJsonCandidate, chapterText, chapterNumber, targetWords, blueprintChapter?.chapter_title ?? "");

      options.onProgress?.(`Đang review chương ${chapterNumber}/${chapterCount}...`);
      const reviewPayload = await callChatCompletions(apiKey, apiUrl, {
        model: chapterReviewerModel,
        messages: [
          { role: "system", content: options.customStoryPrompt?.trim() ? `[HƯỚNG DẪN HỆ THỐNG ƯU TIÊN: ${options.customStoryPrompt.trim()}]\n\n${STORY_REVIEWER_SYSTEM_PROMPT}` : STORY_REVIEWER_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildChapterReviewPrompt(
              {
                ...options,
                factors: activeFactors,
                draft: {
                  story_title: options.request.story_title,
                  chapter_count: chapters.length + 1,
                  chapters: [...chapters, chapter],
                  quality_gate: { continuity_check: "", must_fix_next: [] },
                },
              },
              activeFactors,
              chapters,
              chapter,
            ),
          },
        ],
        temperature: 0.12,
        response_format: { type: "json_object" },
      });

      let reviewParsed = getDirectJsonCandidate(reviewPayload);
      if (!reviewParsed) reviewParsed = parseJsonFromText(getChoiceContent(reviewPayload));
      if (!reviewParsed) throw new Error(`Không đọc được JSON review chương ${chapterNumber}.`);

      const chapterReview = normalizeChapterReview(reviewParsed, chapterNumber);
      finalChapter = chapter;

      if ((chapterReview.rewrite_current_chapter || !chapterReview.is_pass) && attempt < 2) {
        carryGuidance = [chapterReview.summary, ...chapterReview.must_fix, buildCarryGuidanceFromReview(chapterReview)].filter(Boolean).join("\n");
        attempt += 1;
        continue;
      }

      carryGuidance = buildCarryGuidanceFromReview(chapterReview);
      break;
    }

    if (!finalChapter) throw new Error(`Không tạo được chương ${chapterNumber}.`);
    chapters.push(finalChapter);
  }

  return {
    story_title: options.request.story_title,
    chapter_count: chapters.length,
    chapters,
    quality_gate: {
      continuity_check: "OK",
      must_fix_next: [],
    },
  };
}

class AsyncSemaphore {
  private queue: Array<() => void> = [];
  constructor(private count: number) {}
  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.count += 1;
    }
  }
}
const globalReviewerSemaphore = new AsyncSemaphore(5);

async function generateStoryDraftChapterByChapterWithBrowser(input: {
  options: GenerateStoryDraftBrowserOptions;
  chapterCount: number;
  targetWords: number;
  activeFactors: StoryFactorDefinition[];
}): Promise<StoryDraftResult> {
  const { options, chapterCount, targetWords, activeFactors } = input;
  const reviewerApiKey = (options.reviewerApiKey || "").trim();
  if (!reviewerApiKey && !options.skipReview) throw new Error("Thiếu API key reviewer.");
  const reviewerApiUrl = (options.reviewerApiUrl ?? DEFAULT_BEE_API_URL).trim();
  const chapterReviewerModel = (options.reviewerModel ?? DEFAULT_BEE_MODEL).trim() || DEFAULT_BEE_MODEL;

  let currentSessionId = options.writerSessionId;

  try {
    const chapters: StoryDraftChapter[] = [];

    let carryGuidance = "";
    let consecutiveChapters = 0;

    for (let chapterNumber = 1; chapterNumber <= chapterCount; chapterNumber += 1) {
      if (consecutiveChapters >= 3) {
        options.onProgress?.(`Đang khởi động lại Chromium sau 3 chương để làm sạch RAM. Đợi 10s...`);
        try {
          await closeBrowserWriterSession(currentSessionId);
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 10000));
        const nextSession = await startBrowserWriterSession({
          cookieFilePath: options.cookieFilePath,
          chatUrl: options.chatUrl,
          windowIndex: options.windowIndex,
        });
        currentSessionId = nextSession.sessionId;
        consecutiveChapters = 0;
      }

      let attempt = 0;
      let finalChapter: StoryDraftChapter | null = null;

      while (attempt < 3) {
        options.onProgress?.(`Đang tạo chương ${chapterNumber}/${chapterCount}${attempt > 0 ? " (lại)" : ""}...`);

        const writerPrompt = buildChapterWriterPromptV2(options, chapterCount, activeFactors, chapters, chapterNumber, targetWords, carryGuidance, options.customStoryPrompt);
        const chapterText = await sendBrowserWriterPrompt({
          sessionId: currentSessionId,
          prompt: writerPrompt,
          newConversation: false,
          timeoutMs: 15 * 60 * 1000,
        });

        const blueprintChapter = options.blueprint.chapter_outline.find((item) => item.chapter_number === chapterNumber);
        const chapter = normalizeChapterGeneration(null, chapterText, chapterNumber, targetWords, blueprintChapter?.chapter_title ?? "");
        
        if (options.skipReview) {
          finalChapter = chapter;
          carryGuidance = "";
          break;
        }

        await globalReviewerSemaphore.acquire();
        let reviewPayload;
        try {
          reviewPayload = await callChatCompletions(reviewerApiKey, reviewerApiUrl, {
            model: chapterReviewerModel,
            messages: [
              { role: "system", content: options.customStoryPrompt?.trim() ? `[HƯỚNG DẪN HỆ THỐNG ƯU TIÊN: ${options.customStoryPrompt.trim()}]\n\n${STORY_REVIEWER_SYSTEM_PROMPT}` : STORY_REVIEWER_SYSTEM_PROMPT },
              {
                role: "user",
                content: buildChapterReviewPrompt(
                  {
                    ...options,
                    apiKey: reviewerApiKey,
                    apiUrl: reviewerApiUrl,
                    model: chapterReviewerModel,
                    factors: activeFactors,
                    draft: {
                      story_title: options.request.story_title,
                      chapter_count: chapters.length + 1,
                      chapters: [...chapters, chapter],
                      quality_gate: { continuity_check: "", must_fix_next: [] },
                    },
                  },
                  activeFactors,
                  chapters,
                  chapter,
                ),
              },
            ],
            temperature: 0.12,
            response_format: { type: "json_object" },
          });
        } finally {
          globalReviewerSemaphore.release();
        }

        let reviewParsed = getDirectJsonCandidate(reviewPayload);
        if (!reviewParsed) reviewParsed = parseJsonFromText(getChoiceContent(reviewPayload));
        if (!reviewParsed) throw new Error("Không đọc được JSON review chương.");

        const chapterReview = normalizeChapterReview(reviewParsed, chapterNumber);
        finalChapter = chapter;

        if ((chapterReview.rewrite_current_chapter || !chapterReview.is_pass) && attempt < 2) {
          carryGuidance = [chapterReview.summary, ...chapterReview.must_fix, buildCarryGuidanceFromReview(chapterReview)].filter(Boolean).join("\n");
          attempt += 1;
          continue;
        }

        carryGuidance = buildCarryGuidanceFromReview(chapterReview);
        break;
      }

      if (!finalChapter) throw new Error(`Không tạo được chương ${chapterNumber}.`);
      chapters.push(finalChapter);
      consecutiveChapters += 1;
    }

    return {
      story_title: options.request.story_title,
      chapter_count: chapters.length,
      chapters,
      quality_gate: { continuity_check: "OK", must_fix_next: [] },
    };
  } catch (error) {
    throw error;
  }
}

export async function generateStoryDraftWithBeeApi(options: GenerateStoryDraftOptions): Promise<StoryDraftResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Thiếu API key.");

  const apiUrl = (options.apiUrl ?? DEFAULT_BEE_API_URL).trim();
  const model = (options.model ?? DEFAULT_BEE_MODEL).trim();
  const chapterCount = computeChapterCount(options.request.total_words, options.request.avg_words_per_chapter);
  const targetWords = clamp(Math.round(options.request.avg_words_per_chapter), 1000, 5000);
  const activeFactors = pickActiveFactors(options.request, options.factors);

  return generateStoryDraftChapterByChapter({
    options,
    apiKey,
    apiUrl,
    model,
    chapterCount,
    targetWords,
    activeFactors,
  });
}

export async function generateStoryDraftWithBrowserWriter(options: GenerateStoryDraftBrowserOptions): Promise<StoryDraftResult> {
  const chapterCount = computeChapterCount(options.request.total_words, options.request.avg_words_per_chapter);
  const targetWords = clamp(Math.round(options.request.avg_words_per_chapter), 1000, 5000);
  const activeFactors = pickActiveFactors(options.request, options.factors);

  return generateStoryDraftChapterByChapterWithBrowser({
    options,
    chapterCount,
    targetWords,
    activeFactors,
  });
}

export async function reviewStoryDraftWithBeeApi(options: ReviewStoryDraftOptions): Promise<StoryReviewResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Thiếu API key.");

  const apiUrl = (options.apiUrl ?? DEFAULT_BEE_API_URL).trim();
  const model = (options.model ?? DEFAULT_BEE_MODEL).trim();

  const systemPromptToUse = options.customStoryPrompt?.trim()
    ? `[HƯỚNG DẪN HỆ THỐNG ƯU TIÊN: ${options.customStoryPrompt.trim()}]\n\n${STORY_REVIEWER_SYSTEM_PROMPT}`
    : STORY_REVIEWER_SYSTEM_PROMPT;
  const prompt = buildFinalReviewPrompt(options);

  const payload = await callChatCompletions(apiKey, apiUrl, {
    model,
    messages: [
      { role: "system", content: systemPromptToUse },
      { role: "user", content: prompt },
    ],
    temperature: 0.15,
    response_format: { type: "json_object" },
  });

  let parsed = getDirectJsonCandidate(payload);
  if (!parsed) parsed = parseJsonFromText(getChoiceContent(payload));
  if (!parsed) throw new Error(`Không đọc được JSON reviewer từ API.`);

  return normalizeStoryReview(parsed, options.sources);
}

export async function reviewStoryDraftWithBrowserWriter(
  sessionId: string,
  options: GenerateStoryDraftBrowserOptions,
  draft: StoryDraftResult,
): Promise<StoryReviewResult> {
  const userPrompt = [
    "DỰA TRÊN TOÀN BỘ CÁC CHƯƠNG BẠN VỪA VIẾT, HÃY TỰ ĐÁNH GIÁ CHÍNH MÌNH (SELF-REVIEW).",
    "Đây là lúc chỉ trích cực kỳ gắt gao. Hãy tự mổ xẻ các hạt sạn, logic lỗi, và những đoạn viết chưa tới.",
    "BẮT BUỘC TRẢ VỀ JSON DUY NHẤT (Không bọc code block, không giải thích).",
    "",
    STORY_SELF_REVIEWER_SYSTEM_PROMPT,
  ].join("\n");

  const responseText = await sendBrowserWriterPrompt({
    sessionId,
    prompt: userPrompt,
    newConversation: false,
    timeoutMs: 300000,
  });

  const parsed = parseJsonFromText(responseText);
  if (!parsed) throw new Error(`Browser không trả kết quả tự chấm điểm hợp lệ (JSON).`);

  return {
    is_pass: Boolean(asRecord(parsed).is_pass),
    quality_score: clamp(toNumber(asRecord(parsed).quality_score, 0), 0, 10),
    summary: String(asRecord(parsed).summary || "Chưa có nhận xét tự đánh giá."),
    must_fix: toStringArray(asRecord(parsed).must_fix),
    strengths: toStringArray(asRecord(parsed).strengths),
  };
}
