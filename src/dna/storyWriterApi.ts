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

type ChapterContextPacket = {
  chapter_number: number;
  chapter_title: string;
  opening_excerpt: string;
  ending_excerpt: string;
  summary: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function compactText(value: string, maxChars: number): string {
  const normalized = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 14)).trimEnd()}\n...(rút gọn)`;
}

function sanitizeApiErrorText(text: string): string {
  const plain = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 260);
}

function extractBalancedJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
  const codeBlockMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) ?? trimmed.match(/```\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // continue
    }
  }
  const jsonObject = extractBalancedJsonObject(trimmed);
  if (!jsonObject) return null;
  try {
    return JSON.parse(jsonObject);
  } catch {
    return null;
  }
}

function appendCandidate(result: string[], value: unknown): void {
  if (typeof value === "string" && value.trim()) {
    result.push(value);
    return;
  }
  if (value && typeof value === "object") {
    try {
      result.push(JSON.stringify(value));
    } catch {
      // ignore
    }
  }
}

function getDirectJsonCandidate(payload: unknown): unknown | null {
  const root = asRecord(payload);
  const choices = Array.isArray(root.choices) ? (root.choices as JsonRecord[]) : [];
  const firstChoice = choices[0] ?? null;
  if (!firstChoice) return null;
  const message = asRecord(firstChoice.message);
  if (message.parsed && typeof message.parsed === "object") return message.parsed;
  if (message.json && typeof message.json === "object") return message.json;
  return null;
}

function getChoiceContent(payload: unknown): string {
  const root = asRecord(payload);
  const candidates: string[] = [];
  const choices = Array.isArray(root.choices) ? (root.choices as JsonRecord[]) : [];
  choices.forEach((choice) => {
    appendCandidate(candidates, choice.text);
    const message = asRecord(choice.message);
    appendCandidate(candidates, message.content);
    const contentArray = Array.isArray(message.content) ? (message.content as JsonRecord[]) : [];
    contentArray.forEach((item) => {
      appendCandidate(candidates, item.text);
      appendCandidate(candidates, item.content);
    });
  });
  appendCandidate(candidates, root.output_text);
  appendCandidate(candidates, root.content);
  appendCandidate(candidates, root.response);
  appendCandidate(candidates, root.result);
  appendCandidate(candidates, root.message);
  return candidates.find((item) => item.trim()) ?? "";
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 524;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callChatCompletions(apiKey: string, apiUrl: string, body: Record<string, unknown>): Promise<unknown> {
  let requestBody = { ...body };
  for (let attempt = 0; attempt < MAX_CHAT_RETRIES; attempt += 1) {
    recordMetric("api_calls", 1);
    recordMetric("api_calls_story", 1);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) return response.json() as Promise<unknown>;

    const errorText = await response.text();
    const status = response.status;
    if (status === 400 && "response_format" in requestBody) {
      const fallbackBody = { ...requestBody };
      delete (fallbackBody as { response_format?: { type: string } }).response_format;
      requestBody = fallbackBody;
      continue;
    }
    if (isTransientStatus(status) && attempt < MAX_CHAT_RETRIES - 1) {
      await waitMs(1500 * (attempt + 1));
      continue;
    }

    const cleaned = sanitizeApiErrorText(errorText);
    if (status === 524) {
      throw new Error(`API lỗi 524 (timeout/gateway). Hệ thống đã retry nhưng vẫn timeout. Hãy giảm tải context hoặc thử lại sau. Chi tiết: ${cleaned}`);
    }
    throw new Error(`API lỗi ${status}: ${cleaned}`);
  }
  throw new Error("API timeout sau nhiều lần thử.");
}

function computeChapterCount(totalWords: number, avgWordsPerChapter: number): number {
  const safeTotal = clamp(Math.round(totalWords), 3000, 50000);
  const safeAvg = clamp(Math.round(avgWordsPerChapter), 1000, 5000);
  return clamp(Math.ceil(safeTotal / safeAvg), 1, 30);
}

export function parseStoryCreationRequest(
  rawJson: string,
  defaults?: {
    totalWords?: number;
    avgWordsPerChapter?: number;
  },
): StoryCreationRequest {
  const parsed = parseJsonFromText(rawJson);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON truyện không hợp lệ.");
  }
  const raw = parsed as JsonRecord;

  const storyTitle = firstString(raw.story_title);
  if (!storyTitle) throw new Error("Thiếu `story_title` trong JSON.");
  const genre = firstString(raw.genre);
  if (!genre) throw new Error("Thiếu `genre` trong JSON.");

  const styles = toStringArray(raw.styles);
  const fallbackTotal = clamp(Math.round(toNumber(defaults?.totalWords, 35000)), 3000, 50000);
  const fallbackAvg = clamp(Math.round(toNumber(defaults?.avgWordsPerChapter, 5000)), 1000, 5000);
  const hasTotalWords = raw.total_words !== undefined && raw.total_words !== null;
  const hasAvgWords = raw.avg_words_per_chapter !== undefined && raw.avg_words_per_chapter !== null;
  const totalWords = clamp(Math.round(toNumber(raw.total_words, fallbackTotal)), 3000, 50000);
  const avgWords = clamp(Math.round(toNumber(raw.avg_words_per_chapter, fallbackAvg)), 1000, 5000);

  const factorFlags: Record<string, boolean> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (RESERVED_REQUEST_KEYS.has(key)) return;
    if (typeof value === "boolean") factorFlags[normalizeFactorKey(key)] = value;
  });

  toStringArray(raw.enabled_factors)
    .map((key) => normalizeFactorKey(key))
    .forEach((key) => {
      if (key) factorFlags[key] = true;
    });

  toStringArray(raw.disabled_factors)
    .map((key) => normalizeFactorKey(key))
    .forEach((key) => {
      if (key) factorFlags[key] = false;
    });

  return {
    story_title: storyTitle,
    genre,
    styles,
    length_mode: "total_words",
    total_words: hasTotalWords ? totalWords : fallbackTotal,
    avg_words_per_chapter: hasAvgWords ? avgWords : fallbackAvg,
    story_language: firstString(raw.story_language, "tieng_viet"),
    character_name_language: firstString(raw.character_name_language, "tieng_viet"),
    target_intensity: firstString(raw.target_intensity, "cao"),
    ending_type: firstString(raw.ending_type, "du_am_bat_an"),
    extra_prompt: firstString(raw.extra_prompt),
    factor_flags: factorFlags,
  };
}

export function pickActiveFactors(request: StoryCreationRequest, factors: StoryFactorDefinition[]): StoryFactorDefinition[] {
  const activeKeys = new Set(factors.filter((factor) => factor.enabled_by_default).map((factor) => factor.key));
  factors.forEach((factor) => {
    const flag = request.factor_flags[factor.key];
    if (flag === true) activeKeys.add(factor.key);
    if (flag === false) activeKeys.delete(factor.key);
  });
  return factors.filter((factor) => activeKeys.has(factor.key));
}

function buildSourceDigest(sources: StoryDnaSource[], activeFactors: StoryFactorDefinition[]): Array<Record<string, unknown>> {
  const hasLayToanBo = activeFactors.some((f) => f.key === "lay_toan_bo_dna");
  const hasLayVanPhong = activeFactors.some((f) => f.key === "lay_van_phong");
  const hasLayCotTruyen = activeFactors.some((f) => f.key === "lay_cot_truyen");

  return sources.slice(0, MAX_DNA_CONTEXT).map((source) => {
    const digested: Record<string, unknown> = {
      dna_id: source.dna_id,
      title: source.title,
      category: source.category,
      sub_category: source.sub_category,
      score: source.score,
      summary_hint: compactText(source.summary_hint, 180),
    };

    if (hasLayToanBo || hasLayVanPhong) {
      digested.styles = source.styles.slice(0, 4);
      if (source.writing_styles_payload) {
        digested.writing_styles = source.writing_styles_payload;
      }
    }
    if (hasLayToanBo || hasLayCotTruyen) {
      digested.tags = source.tags.slice(0, 6);
      if (source.core_payload) {
        digested.core = source.core_payload;
      }
    }
    return digested;
  });
}

function buildSourceExecutionPlan(sources: StoryDnaSource[], activeFactors: StoryFactorDefinition[]): Record<string, unknown> {
  const hasLayToanBo = activeFactors.some((f) => f.key === "lay_toan_bo_dna");
  const hasLayVanPhong = activeFactors.some((f) => f.key === "lay_van_phong");
  const hasLayCotTruyen = activeFactors.some((f) => f.key === "lay_cot_truyen");

  const limited = sources.slice(0, MAX_DNA_CONTEXT);
  const anchor = limited[0] ?? null;
  const highestScore = [...limited].sort((left, right) => right.score - left.score)[0] ?? null;

  return {
    anchor_dna: anchor
      ? {
          dna_id: anchor.dna_id,
          title: anchor.title,
          category: anchor.category,
          sub_category: anchor.sub_category,
          score: anchor.score,
        }
      : null,
    highest_score_dna: highestScore
      ? {
          dna_id: highestScore.dna_id,
          title: highestScore.title,
          score: highestScore.score,
        }
      : null,
    inheritance_rules: [
      hasLayToanBo || hasLayCotTruyen ? "DNA neo quyet dinh luc day xung dot, chat kinh di va logic van hanh cua bo truyen." : "Chuyen dong cam xuc phai on dinh.",
      hasLayToanBo || hasLayVanPhong ? "DNA diem cao nhat duoc uu tien khi chon motif, hook, payoff va chat van phong." : "Moi chuong phai giu nhip deu.",
      hasLayToanBo || hasLayCotTruyen ? "Moi chuong phai co dau vet cua it nhat 1 motif/tag tu DNA nguon." : "Giữ kết cấu nhất quán.",
      "Khong duoc viet chuong chung chung den muc co the tach DNA ra ma van dung.",
      "Chi duoc dot bien DNA de tao ban moi, khong duoc bo qua DNA.",
    ],
    source_roles: limited.map((source, index) => {
      const must_keep: string[] = [];
      if (hasLayToanBo || hasLayVanPhong) {
        must_keep.push(...source.styles.slice(0, 2).map((item) => `van_phong:${item}`));
      }
      if (hasLayToanBo || hasLayCotTruyen) {
        must_keep.push(...source.tags.slice(0, 3).map((item) => `motif:${item}`));
      }
      return {
        dna_id: source.dna_id,
        title: source.title,
        score: source.score,
        role: index === 0 ? "anchor" : index <= 2 ? "support" : "spice",
        must_keep,
      };
    }),
  };
}

function buildFactorDigest(activeFactors: StoryFactorDefinition[]): Array<Record<string, unknown>> {
  return activeFactors.slice(0, MAX_FACTOR_CONTEXT).map((factor) => ({
    key: factor.key,
    title: factor.title,
    description: compactText(factor.description, 180),
    prompt: factor.prompt,
  }));
}

function buildChapterContextPackets(previousChapters: StoryDraftChapter[]): ChapterContextPacket[] {
  return previousChapters.map((chapter) => {
    const text = chapter.content.trim();
    const opening = compactText(text.slice(0, MAX_OLDER_CHAPTER_SUMMARY), MAX_OLDER_CHAPTER_SUMMARY);
    const ending = compactText(text.slice(-MAX_OLDER_CHAPTER_SUMMARY), MAX_OLDER_CHAPTER_SUMMARY);
    return {
      chapter_number: chapter.chapter_number,
      chapter_title: chapter.chapter_title,
      opening_excerpt: opening,
      ending_excerpt: ending,
      summary: compactText(`${opening} ... ${ending}`.trim(), 360),
    };
  });
}

function buildMemoryPack(previousChapters: StoryDraftChapter[]): Record<string, unknown> {
  if (!previousChapters.length) {
    return {
      recent_full_chapters: [],
      older_chapter_summaries: [],
      latest_ending_bridge: "Chuong 1 mo dau bang bien co kich hoat xung dot trung tam.",
    };
  }

  const packets = buildChapterContextPackets(previousChapters);
  const recent = previousChapters.slice(-MAX_FULL_RECENT_CHAPTERS).map((chapter) => ({
    chapter_number: chapter.chapter_number,
    chapter_title: chapter.chapter_title,
    content: compactText(chapter.content, MAX_RECENT_CHAPTER_CHARS),
  }));
  const older = packets
    .filter((packet) => packet.chapter_number < previousChapters.length - (MAX_FULL_RECENT_CHAPTERS - 1))
    .map((packet) => ({
      chapter_number: packet.chapter_number,
      chapter_title: packet.chapter_title,
      summary: packet.summary,
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
    `Guidance chương kế: ${review.next_chapter_guidance}`,
  ];
  return lines.join("\n");
}

function extractChapterTitleFromText(content: string, chapterNumber: number): string {
  const headingMatch =
    content.match(/^#{1,3}\s*ch(?:ươ|uo)ng\s*\d+\s*[:\-–]\s*(.+)$/im) ??
    content.match(/^ch(?:ươ|uo)ng\s*\d+\s*[:\-–]\s*(.+)$/im);
  if (headingMatch?.[1]) return compactText(headingMatch[1], 120).replace(/\n/g, " ").trim();
  return `Chương ${chapterNumber}`;
}

function normalizeWriterText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeChapterGeneration(
  rawPayload: unknown,
  rawText: string,
  chapterNumber: number,
  targetWords: number,
  fallbackTitle: string,
): StoryDraftChapter {
  const parsed = rawPayload ? asRecord(rawPayload) : {};
  const parsedContent = firstString(parsed.content, parsed.chapter_content, parsed.text);
  const textContent = normalizeWriterText(parsedContent || rawText);
  const title = firstString(parsed.chapter_title, extractChapterTitleFromText(textContent, chapterNumber), fallbackTitle, `Chương ${chapterNumber}`);

  if (!textContent) {
    throw new Error(`Writer không trả nội dung chương ${chapterNumber}.`);
  }
  if (textContent.length < 900) {
    throw new Error(`Nội dung chương ${chapterNumber} quá ngắn, không đạt chuẩn.`);
  }

  return {
    chapter_number: chapterNumber,
    chapter_title: title,
    target_words: clamp(Math.round(toNumber(parsed.target_words, targetWords)), 500, 8000),
    content: textContent,
  };
}

function normalizeChapterReview(raw: unknown, chapterNumber: number): ChapterReviewResult {
  const row = asRecord(raw);
  const mustFix = toStringArray(row.must_fix);
  const rawScore = clamp(Number(toNumber(row.quality_score, 0).toFixed(1)), 0, 10);
  const summary = firstString(row.summary, `Chương ${chapterNumber} chưa có nhận xét.`);
  const guidance = firstString(row.next_chapter_guidance, mustFix.join("; "));
  const rewriteFlag = Boolean(row.rewrite_current_chapter);
  const isPass = Boolean(row.is_pass) && rawScore >= 6.5 && !rewriteFlag;
  const continuityBridge = firstString(row.continuity_bridge, "Chương sau phải mở đầu bằng hệ quả trực tiếp của cảnh cuối chương này.");
  const unresolvedThreads = toStringArray(row.unresolved_threads);
  const noRepeatRules = toStringArray(row.no_repeat_rules);
  const timelineMarker = firstString(row.timeline_marker, "Không rõ mốc thời gian.");

  return {
    chapter_number: clamp(Math.round(toNumber(row.chapter_number, chapterNumber)), 1, 999),
    is_pass: isPass,
    quality_score: rawScore,
    summary,
    must_fix: mustFix,
    next_chapter_guidance: guidance || "Giữ logic nhân quả, nâng dần xung đột, kết chương bằng cliffhanger hợp lý.",
    rewrite_current_chapter: rewriteFlag,
    continuity_bridge: continuityBridge,
    unresolved_threads: unresolvedThreads,
    no_repeat_rules: noRepeatRules,
    timeline_marker: timelineMarker,
  };
}

function buildChapterWriterPrompt(
  options: Pick<GenerateStoryDraftOptions, "request" | "sources" | "blueprint">,
  chapterCount: number,
  activeFactors: StoryFactorDefinition[],
  previousChapters: StoryDraftChapter[],
  chapterNumber: number,
  targetWords: number,
  carryGuidance: string,
): string {
  const memoryPack = buildMemoryPack(previousChapters);
  const sourceDigest = buildSourceDigest(options.sources, activeFactors);
  const factorDigest = buildFactorDigest(activeFactors);
  const blueprintDigest = buildBlueprintDigest(options.blueprint, chapterNumber);

  return [
    STORY_WRITER_SYSTEM_PROMPT,
    "",
    `Nhiệm vụ: Viết CHƯƠNG ${chapterNumber}/${chapterCount}.`,
    "ĐẦU RA BẮT BUỘC: chỉ trả về VĂN BẢN THUẦN của chương, không JSON, không code block.",
    "",
    "Thông số truyện:",
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
    "Yếu tố bật:",
    JSON.stringify(factorDigest, null, 2),
    "",
    "Blueprint digest (rút gọn):",
    JSON.stringify(blueprintDigest, null, 2),
    "",
    "Memory pack từ chương trước:",
    JSON.stringify(memoryPack, null, 2),
    "",
    `Hướng dẫn bổ sung cho chương ${chapterNumber}:`,
    carryGuidance || "Không có.",
    "",
    "Quy tắc cứng:",
    chapterNumber > 1
      ? "- Mở đầu chương này phải nối trực tiếp hệ quả từ cuối chương trước, không được reset bối cảnh."
      : "- Chương 1 phải đặt xung đột trung tâm và móc kéo chương 2.",
    "- Cấm lặp nguyên văn đoạn mô tả dài từ chương trước.",
    "- Mỗi chương phải có tiến triển không thể đảo ngược (thông tin mới/hệ quả mới/quyết định mới).",
    "- Không kể lể lan man, ưu tiên hành động + phản ứng + hệ quả.",
    "- Kết chương bắt buộc có lực kéo đọc tiếp.",
    `- Độ dài mục tiêu: khoảng ${targetWords} từ (sai số tối đa 20%).`,
  ].join("\n");
}

function buildChapterWriterPromptV2(
  options: Pick<GenerateStoryDraftOptions, "request" | "sources" | "blueprint">,
  chapterCount: number,
  activeFactors: StoryFactorDefinition[],
  previousChapters: StoryDraftChapter[],
  chapterNumber: number,
  targetWords: number,
  carryGuidance: string,
): string {
  const memoryPack = buildMemoryPack(previousChapters);
  const sourceDigest = buildSourceDigest(options.sources, activeFactors);
  const sourceExecutionPlan = buildSourceExecutionPlan(options.sources, activeFactors);
  const factorDigest = buildFactorDigest(activeFactors);
  const blueprintDigest = buildBlueprintDigest(options.blueprint, chapterNumber);

  return [
    STORY_WRITER_SYSTEM_PROMPT,
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
    "Yeu to bat:",
    JSON.stringify(factorDigest, null, 2),
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
    "- Phai tuan thu DNA execution plan. Neu chuong viet ra co the tach DNA ma van dung thi xem nhu sai.",
    "- Moi chuong phai su dung it nhat 1 chat lieu structural hoac motif tu DNA neo va 1 chi tiet tu DNA ho tro.",
    "- Neu DNA diem cao nhat va DNA neo mau thuan, uu tien DNA neo cho logic, uu tien DNA diem cao cho do sac cua van phong va hook.",
    "- Cam lap nguyen van doan mo ta dai tu chuong truoc.",
    "- Moi chuong phai co tien trien khong the dao nguoc: thong tin moi, he qua moi, quyet dinh moi, hoac gia tang ap luc moi.",
    "- Khong ke le lan man. Uu tien hanh dong, phan ung, he qua, va bien thien canh.",
    "- Cam nhay canh vo co. Cam doi nhiet do cam xuc vo ly. Cam ket chuong an toan.",
    "- Neu mot motif da xuat hien, lan sau phai nang cap he qua hoac doi goc nhin; khong duoc lap lai chi de nhac nho.",
    "- Moi chuong phai co it nhat 1 hinh anh hoac am thanh neo tri nho de noi qua chuong sau.",
    `- ĐỘ DÀI: BẮT BUỘC viết TRONG KHOẢNG ${targetWords} KÝ TỰ (Characters, không phải là 'từ/words'). BẠN BỊ CẤM VIẾT DÀI DÒNG, BÔI CHỮ, KỂ LỂ QUÁ ĐÀ. Chỉ mô tả vừa đủ nét, cắt bỏ các đoạn suy nghĩ rườm rà không tạo ra hành động. Viết súc tích, nhịp điệu nhanh và dừng đúng lúc đạt mục tiêu cảnh.`
  ].join("\n");
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

  return [
    STORY_REVIEWER_SYSTEM_PROMPT,
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

  return [
    STORY_REVIEWER_SYSTEM_PROMPT,
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
  const chapterReviews: Array<{
    chapter_number: number;
    quality_score: number;
    is_pass: boolean;
    summary: string;
    must_fix: string[];
    next_chapter_guidance: string;
  }> = [];

  let carryGuidance = "";
  for (let chapterNumber = 1; chapterNumber <= chapterCount; chapterNumber += 1) {
    let attempt = 0;
    let finalChapter: StoryDraftChapter | null = null;
    let finalReview: ChapterReviewResult | null = null;

    while (attempt < 3) {
      const attemptLabel = attempt > 0 ? ` (viết lại lần ${attempt})` : "";
      options.onProgress?.(`Đang tạo chương ${chapterNumber}/${chapterCount}${attemptLabel}...`);

      const chapterPayload = await callChatCompletions(apiKey, apiUrl, {
        model,
        messages: [
          { role: "system", content: STORY_WRITER_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildChapterWriterPromptV2(options, chapterCount, activeFactors, chapters, chapterNumber, targetWords, carryGuidance),
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
          { role: "system", content: STORY_REVIEWER_SYSTEM_PROMPT },
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
      const reviewText = getChoiceContent(reviewPayload);
      if (!reviewParsed) reviewParsed = parseJsonFromText(reviewText);
      if (!reviewParsed) {
        const excerpt = compactText(reviewText.replace(/\s+/g, " "), 220);
        throw new Error(`Không đọc được JSON review chương ${chapterNumber}. Mẫu phản hồi: ${excerpt}`);
      }

      const chapterReview = normalizeChapterReview(reviewParsed, chapterNumber);
      finalChapter = chapter;
      finalReview = chapterReview;

      if ((chapterReview.rewrite_current_chapter || !chapterReview.is_pass) && attempt < 2) {
        carryGuidance = [chapterReview.summary, ...chapterReview.must_fix, buildCarryGuidanceFromReview(chapterReview)].filter(Boolean).join("\n");
        attempt += 1;
        continue;
      }

      carryGuidance = buildCarryGuidanceFromReview(chapterReview);
      break;
    }

    if (!finalChapter) throw new Error(`Không tạo được chương ${chapterNumber}.`);

    chapters.push({
      chapter_number: chapterNumber,
      chapter_title: finalChapter.chapter_title || `Chương ${chapterNumber}`,
      target_words: finalChapter.target_words,
      content: finalChapter.content,
    });

    if (finalReview) {
      chapterReviews.push({
        chapter_number: chapterNumber,
        quality_score: finalReview.quality_score,
        is_pass: finalReview.is_pass,
        summary: finalReview.summary,
        must_fix: finalReview.must_fix,
        next_chapter_guidance: finalReview.next_chapter_guidance,
      });
    }
  }

  const mustFixNext = chapterReviews.flatMap((item) => item.must_fix).slice(0, 14);
  const continuityCheck =
    chapterReviews.length > 0 ? chapterReviews.slice(-3).map((item) => `Chương ${item.chapter_number}: ${item.summary}`).join(" | ") : "Chưa có đánh giá continuity.";

  const meaningful = chapters.filter((item) => item.content.trim().length >= 900);
  if (!meaningful.length) throw new Error("Writer chưa tạo được nội dung chương hợp lệ.");

  return {
    story_title: options.request.story_title,
    chapter_count: chapters.length,
    chapters,
    quality_gate: {
      continuity_check: continuityCheck,
      must_fix_next: mustFixNext,
      chapter_reviews: chapterReviews,
    },
  };
}

class AsyncSemaphore {
  private count: number;
  private queue: Array<() => void> = [];
  constructor(max: number) { this.count = max; }
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
    const chapterReviews: Array<{
      chapter_number: number;
      quality_score: number;
      is_pass: boolean;
      summary: string;
      must_fix: string[];
      next_chapter_guidance: string;
    }> = [];

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
      let finalReview: ChapterReviewResult | null = null;

      while (attempt < 3) {
        const attemptLabel = attempt > 0 ? ` (viet lai lan ${attempt})` : "";
        options.onProgress?.(`Dang tao chuong ${chapterNumber}/${chapterCount}${attemptLabel} bang ChatGPT Chromium...`);

        const writerPrompt = buildChapterWriterPromptV2(options, chapterCount, activeFactors, chapters, chapterNumber, targetWords, carryGuidance);
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
          finalReview = null;
          carryGuidance = "";
          break;
        }

        options.onProgress?.(`Dang cho Reviewer xử lý chương ${chapterNumber}/${chapterCount} (Max 5 luồng)...`);
        await globalReviewerSemaphore.acquire();
        let reviewPayload;
        try {
          reviewPayload = await callChatCompletions(reviewerApiKey, reviewerApiUrl, {
            model: chapterReviewerModel,
            messages: [
              { role: "system", content: STORY_REVIEWER_SYSTEM_PROMPT },
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
        const reviewText = getChoiceContent(reviewPayload);
        if (!reviewParsed) reviewParsed = parseJsonFromText(reviewText);
        if (!reviewParsed) {
          const excerpt = compactText(reviewText.replace(/\s+/g, " "), 220);
          throw new Error(`Khong doc duoc JSON review chuong ${chapterNumber}. Mau phan hoi: ${excerpt}`);
        }

        const chapterReview = normalizeChapterReview(reviewParsed, chapterNumber);
        finalChapter = chapter;
        finalReview = chapterReview;

        if ((chapterReview.rewrite_current_chapter || !chapterReview.is_pass) && attempt < 2) {
          carryGuidance = [chapterReview.summary, ...chapterReview.must_fix, buildCarryGuidanceFromReview(chapterReview)].filter(Boolean).join("\n");
          attempt += 1;
          continue;
        }

        carryGuidance = buildCarryGuidanceFromReview(chapterReview);
        break;
      }

      if (!finalChapter) throw new Error(`Khong tao duoc chuong ${chapterNumber}.`);

      chapters.push({
        chapter_number: chapterNumber,
        chapter_title: finalChapter.chapter_title || `Chuong ${chapterNumber}`,
        target_words: finalChapter.target_words,
        content: finalChapter.content,
      });

      if (finalReview) {
        chapterReviews.push({
          chapter_number: chapterNumber,
          quality_score: finalReview.quality_score,
          is_pass: finalReview.is_pass,
          summary: finalReview.summary,
          must_fix: finalReview.must_fix,
          next_chapter_guidance: finalReview.next_chapter_guidance,
        });
      }

      consecutiveChapters += 1;
    }

    const mustFixNext = chapterReviews.flatMap((item) => item.must_fix).slice(0, 14);
    const continuityCheck =
      chapterReviews.length > 0 ? chapterReviews.slice(-3).map((item) => `Chuong ${item.chapter_number}: ${item.summary}`).join(" | ") : "Chua co danh gia continuity.";

    const meaningful = chapters.filter((item) => item.content.trim().length >= 900);
    if (!meaningful.length) throw new Error("Writer tren trinh duyet chua tao duoc noi dung chuong hop le.");

    return {
      story_title: options.request.story_title,
      chapter_count: chapters.length,
      chapters,
      quality_gate: {
        continuity_check: continuityCheck,
        must_fix_next: mustFixNext,
        chapter_reviews: chapterReviews,
      },
    };
  } finally {
    if (currentSessionId !== options.writerSessionId) {
      // Ensure we clean up any newly opened sessions during the loop!
      try {
        await closeBrowserWriterSession(currentSessionId);
      } catch (e) {}
    }
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

  const payload = await callChatCompletions(apiKey, apiUrl, {
    model,
    messages: [
      { role: "system", content: STORY_REVIEWER_SYSTEM_PROMPT },
      { role: "user", content: buildFinalReviewPrompt(options) },
    ],
    temperature: 0.15,
    response_format: { type: "json_object" },
  });

  let parsed = getDirectJsonCandidate(payload);
  const modelText = getChoiceContent(payload);
  if (!parsed) parsed = parseJsonFromText(modelText);
  if (!parsed) {
    const excerpt = compactText(modelText.replace(/\s+/g, " "), 220);
    throw new Error(`Không đọc được JSON reviewer từ API. Mẫu phản hồi: ${excerpt}`);
  }

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
  if (!parsed) {
    const excerpt = compactText(responseText, 220);
    throw new Error(`Browser không trả kết quả tự chấm điểm hợp lệ (JSON). Nội dung nhận được: ${excerpt}`);
  }

  return {
    is_pass: Boolean(asRecord(parsed).is_pass),
    quality_score: clamp(Number(toNumber(asRecord(parsed).quality_score, 0).toFixed(1)), 0, 10),
    summary: String(asRecord(parsed).summary || "Chưa có nhận xét tự đánh giá."),
    must_fix: toStringArray(asRecord(parsed).must_fix),
    strengths: toStringArray(asRecord(parsed).strengths),
  };
}
