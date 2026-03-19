import type { ScoreReport, StoryAnalysisResult, StoryCreateMode } from "./analysisTypes";
import { DNA_ANALYST_SYSTEM_PROMPT } from "./prompts";
import { recordMetric } from "../utils/metrics";

const DEFAULT_BEE_API_URL = "https://platform.beeknoee.com/api/v1/chat/completions";
const DEFAULT_BEE_MODEL = "openai/gpt-oss-120b";

const DNA_SYSTEM_PROMPT = DNA_ANALYST_SYSTEM_PROMPT;

const scoreKeys = [
  "hook_strength",
  "atmosphere",
  "pacing",
  "fear_factor",
  "originality",
  "character_depth",
  "cinematic_quality",
  "twist_power",
  "memorability",
  "reusability_as_dna",
  "language_quality",
  "language_identity",
  "cinematic_identity",
  "structural_integrity",
  "emotional_impact",
  "overall_score",
] as const;

type JsonRecord = Record<string, unknown>;
const VI_DIACRITIC_CHAR = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;
const NO_ACCENT_VI_KEYWORDS = /\b(khong|nhung|mot|voi|trong|nguoi|nhan vat|truyen|cam giac|su that|boi canh|noi so|ket thuc|mo dau|dien bien|bi an|xung dot|nhan qua|cao trao|lua chon|tinh tiet)\b/gi;

export type AnalyzeStoryInput = {
  title: string;
  content: string;
  createMode: StoryCreateMode;
};

export type AnalyzeStoryOptions = {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  input: AnalyzeStoryInput;
};

function createEmptyScoreReport(): ScoreReport {
  return {
    hook_strength: { score: 0, reason: "" },
    atmosphere: { score: 0, reason: "" },
    pacing: { score: 0, reason: "" },
    fear_factor: { score: 0, reason: "" },
    originality: { score: 0, reason: "" },
    character_depth: { score: 0, reason: "" },
    cinematic_quality: { score: 0, reason: "" },
    twist_power: { score: 0, reason: "" },
    memorability: { score: 0, reason: "" },
    reusability_as_dna: { score: 0, reason: "" },
    language_quality: { score: 0, reason: "" },
    language_identity: { score: 0, reason: "" },
    cinematic_identity: { score: 0, reason: "" },
    structural_integrity: { score: 0, reason: "" },
    emotional_impact: { score: 0, reason: "" },
    overall_score: { score: 0, reason: "" },
  };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function toFlatStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => toFlatStringArray(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value as JsonRecord).flatMap((item) => toFlatStringArray(item));
  }
  return [];
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clampScore(value: number): number {
  if (value < 0) return 0;
  if (value > 10) return 10;
  return Number(value.toFixed(2));
}

function pickScoreCandidate(scoresRoot: JsonRecord, key: string): unknown {
  const aliases: Record<string, string[]> = {
    cinematic_quality: ["cinematic_score"],
    reusability_as_dna: ["reusability", "dna_reusability"],
    language_quality: ["writing_quality"],
    structural_integrity: ["structure_score"],
  };

  if (key in scoresRoot) return scoresRoot[key];
  const options = aliases[key] ?? [];
  for (const alias of options) {
    if (alias in scoresRoot) return scoresRoot[alias];
  }
  return undefined;
}

function normalizeScoreReport(raw: unknown): ScoreReport {
  const result = createEmptyScoreReport();
  const record = asRecord(raw);
  const scoresRoot = asRecord(record.scores ?? record);

  scoreKeys.forEach((key) => {
    const value = pickScoreCandidate(scoresRoot, key);

    if (typeof value === "number" || typeof value === "string") {
      result[key] = {
        score: clampScore(toNumber(value, 0)),
        reason: "",
      };
      return;
    }

    const item = asRecord(value);
    result[key] = {
      score: clampScore(toNumber(item.score, 0)),
      reason: String(item.reason ?? item.explanation ?? "").trim(),
    };
  });

  const backfillMap: Record<(typeof scoreKeys)[number], Array<(typeof scoreKeys)[number]>> = {
    hook_strength: ["atmosphere", "memorability"],
    atmosphere: ["fear_factor", "cinematic_quality"],
    pacing: ["structural_integrity", "hook_strength"],
    fear_factor: ["atmosphere", "emotional_impact"],
    originality: ["memorability", "twist_power"],
    character_depth: ["emotional_impact", "structural_integrity"],
    cinematic_quality: ["cinematic_identity", "atmosphere"],
    twist_power: ["originality", "memorability"],
    memorability: ["atmosphere", "twist_power"],
    reusability_as_dna: ["structural_integrity", "originality"],
    language_quality: ["language_identity", "atmosphere"],
    language_identity: ["language_quality", "originality"],
    cinematic_identity: ["cinematic_quality", "atmosphere"],
    structural_integrity: ["pacing", "character_depth"],
    emotional_impact: ["fear_factor", "character_depth"],
    overall_score: scoreKeys.filter((item) => item !== "overall_score"),
  };

  scoreKeys.forEach((key) => {
    if (result[key].score > 0) return;
    const sourceKeys = backfillMap[key] ?? [];
    const sourceScores = sourceKeys.map((sourceKey) => result[sourceKey].score).filter((value) => value > 0);
    if (!sourceScores.length) return;

    const inferred = clampScore(sourceScores.reduce((sum, value) => sum + value, 0) / sourceScores.length);
    result[key].score = inferred;
    if (!result[key].reason) {
      result[key].reason = `Suy luận từ các hạng mục liên quan do phản hồi thiếu trường ${key}.`;
    }
  });

  scoreKeys.forEach((key) => {
    if (!result[key].reason) {
      const scoreText = Number.isFinite(result[key].score) ? result[key].score.toFixed(1) : "0.0";
      result[key].reason = `Hệ thống tự điền lý do mặc định vì phản hồi API thiếu diễn giải cho ${key} (score=${scoreText}).`;
    }
  });

  const calibrationKeys: Array<(typeof scoreKeys)[number]> = [
    "hook_strength",
    "atmosphere",
    "pacing",
    "fear_factor",
    "originality",
    "character_depth",
    "cinematic_quality",
    "twist_power",
    "memorability",
    "reusability_as_dna",
    "language_quality",
    "language_identity",
    "cinematic_identity",
    "structural_integrity",
    "emotional_impact",
  ];
  const calibrationWeights: Record<(typeof scoreKeys)[number], number> = {
    hook_strength: 1.0,
    atmosphere: 1.15,
    pacing: 1.1,
    fear_factor: 1.1,
    originality: 1.0,
    character_depth: 0.95,
    cinematic_quality: 1.05,
    twist_power: 1.0,
    memorability: 1.0,
    reusability_as_dna: 1.15,
    language_quality: 0.95,
    language_identity: 0.9,
    cinematic_identity: 0.95,
    structural_integrity: 1.15,
    emotional_impact: 1.0,
    overall_score: 1,
  };

  const weightedTotal = calibrationKeys.reduce((sum, key) => sum + result[key].score * calibrationWeights[key], 0);
  const weightTotal = calibrationKeys.reduce((sum, key) => sum + calibrationWeights[key], 0);
  const recomputedOverall = clampScore(weightTotal > 0 ? weightedTotal / weightTotal : result.overall_score.score);
  const apiOverall = result.overall_score.score;
  const drift = Math.abs(apiOverall - recomputedOverall);

  if (apiOverall <= 0 || drift >= 1.1) {
    result.overall_score.score = recomputedOverall;
    result.overall_score.reason = [
      `Điểm tổng được hiệu chỉnh để khớp các hạng mục con (API=${apiOverall.toFixed(1)}, calibrated=${recomputedOverall.toFixed(1)}).`,
      result.overall_score.reason,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return result;
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
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") return parseJsonFromText(parsed);
    return parsed;
  } catch {
    // fallback below
  }

  const codeBlockMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) ?? trimmed.match(/```\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // fallback below
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

function shouldIgnoreAccentCheck(path: string): boolean {
  const ignore = [
    "category",
    "sub_category",
    "sub_tags",
    "tags",
    "dna_id",
    "source_file",
    "source_path",
    "filename",
    "path",
    "url",
    "model",
  ];
  return ignore.some((key) => path.endsWith(key));
}

function countNoAccentVietnameseKeywordHits(text: string): number {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return 0;
  const matches = normalized.match(NO_ACCENT_VI_KEYWORDS) ?? [];
  return new Set(matches).size;
}

function collectNaturalTextCandidates(value: unknown, path = "root", bucket: string[] = []): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if ((wordCount >= 3 || text.length >= 24) && /[a-zA-Z]/.test(text) && text.includes(" ") && !shouldIgnoreAccentCheck(path)) {
      bucket.push(text);
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNaturalTextCandidates(item, `${path}[${index}]`, bucket));
    return bucket;
  }

  if (value && typeof value === "object") {
    Object.entries(value as JsonRecord).forEach(([key, item]) => collectNaturalTextCandidates(item, `${path}.${key}`, bucket));
    return bucket;
  }

  return bucket;
}

function lacksVietnameseAccents(text: string): boolean {
  if (VI_DIACRITIC_CHAR.test(text)) return false;
  const keywordHits = countNoAccentVietnameseKeywordHits(text);
  if (keywordHits >= 2) return true;
  if (keywordHits >= 1 && text.length >= 40) return true;
  return false;
}

function needsVietnameseAccentRepair(value: unknown): boolean {
  const candidates = collectNaturalTextCandidates(value);
  if (!candidates.length) return false;

  const violating = candidates.filter((text) => lacksVietnameseAccents(text));
  if (!violating.length) return false;

  const violationRatio = violating.length / candidates.length;
  return violationRatio >= 0.2 || violating.some((text) => countNoAccentVietnameseKeywordHits(text) >= 2);
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
      // ignore non-serializable objects
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

  const toolCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as JsonRecord[]) : [];
  const firstTool = toolCalls[0] ?? null;
  if (firstTool) {
    const fn = asRecord(firstTool.function);
    if (typeof fn.arguments === "string") {
      return parseJsonFromText(fn.arguments);
    }
  }

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

function parseLegacyTwoPartFormat(text: string): { scoreReport: unknown; commentary: string } | null {
  const scoreMarker = text.indexOf("[score_report.json]");
  if (scoreMarker < 0) return null;

  const textAfterScore = text.slice(scoreMarker + "[score_report.json]".length);
  const scoreJsonText = extractBalancedJsonObject(textAfterScore);
  if (!scoreJsonText) return null;

  let scoreReport: unknown = null;
  try {
    scoreReport = JSON.parse(scoreJsonText);
  } catch {
    return null;
  }

  const commentaryMarker = text.indexOf("[evaluation_commentary.md]");
  const commentary = commentaryMarker >= 0 ? text.slice(commentaryMarker + "[evaluation_commentary.md]".length).trim() : "";
  return { scoreReport, commentary };
}

function normalizeTraitValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean).join(", ");
  return String(value ?? "").trim();
}

function toCharacterFromRecord(record: JsonRecord, fallbackName = ""): StoryAnalysisResult["characters"][number] {
  return {
    name: firstString(record.name, record.character_name, fallbackName, "nhan_vat_chinh"),
    role: firstString(record.role, record.archetype, record.arc),
    personality: firstString(record.personality, normalizeTraitValue(record.traits), record.temperament, record.internal_flaw),
    mission: firstString(record.mission, record.goal, record.external_goal, record.internal_conflict),
  };
}

function isLikelySingleCharacterProfile(record: JsonRecord): boolean {
  const candidateKeys = [
    "name",
    "character_name",
    "role",
    "personality",
    "mission",
    "external_goal",
    "internal_flaw",
    "dark_secret",
    "arc_trajectory",
    "arc",
    "traits",
    "internal_conflict",
  ];
  return candidateKeys.some((key) => key in record);
}

function normalizeCharacters(raw: unknown): StoryAnalysisResult["characters"] {
  if (Array.isArray(raw)) {
    return raw
      .filter((item) => item && typeof item === "object")
      .map((item) => toCharacterFromRecord(asRecord(item)))
      .filter((character) => character.name || character.role || character.personality || character.mission);
  }

  const record = asRecord(raw);
  if (Array.isArray(record.characters)) {
    return normalizeCharacters(record.characters);
  }

  if (isLikelySingleCharacterProfile(record)) {
    return [toCharacterFromRecord(record)].filter((character) => character.name || character.role || character.personality || character.mission);
  }

  return Object.entries(record)
    .filter(([, value]) => value && typeof value === "object")
    .map(([name, value]) => toCharacterFromRecord(asRecord(value), name))
    .filter((character) => character.name || character.role || character.personality || character.mission);
}

function outlineFromCoreStructure(raw: unknown): string[] {
  const structure = asRecord(raw);
  const orderedKeys = [
    "opening_image",
    "opening_hook",
    "inciting_incident",
    "first_escalation",
    "midpoint_shift",
    "second_escalation",
    "climax",
    "ending_type",
    "final_image",
  ];

  return orderedKeys
    .map((key) => {
      const value = String(structure[key] ?? "").trim();
      return value ? `${key}: ${value}` : "";
    })
    .filter(Boolean);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function ensureMinList(values: string[], min: number, fallbacks: string[]): string[] {
  const merged: string[] = [];
  [...values, ...fallbacks].forEach((item) => {
    const clean = String(item ?? "").trim();
    if (!clean) return;
    if (!merged.includes(clean)) merged.push(clean);
  });
  return merged.slice(0, Math.max(min, merged.length));
}

function normalizeCountryToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferContextCountry(dna: JsonRecord): string {
  const explicit = firstString(dna.context_country, dna.setting_country, dna.setting);
  if (explicit) return explicit;

  const haystack = normalizeCountryToken(
    [
      String(dna.genre_main ?? ""),
      String(dna.category ?? ""),
      String(dna.sub_category ?? ""),
      ...toStringArray(dna.sub_tags),
      ...toStringArray(asRecord(dna.language_profile).signature_word_fields),
    ].join(" "),
  );

  if (/(j-horror|nhat ban|japan|tokyo|kyoto)/.test(haystack)) return "Nhật Bản";
  if (/(han quoc|korea|seoul)/.test(haystack)) return "Hàn Quốc";
  if (/(my|usa|united states|new york|los angeles)/.test(haystack)) return "Mỹ";
  if (/(anh|uk|london|britain)/.test(haystack)) return "Anh";
  if (/(phap|france|paris)/.test(haystack)) return "Pháp";

  return "Viet Nam";
}

function mapStrictPayloadToLegacy(raw: unknown): JsonRecord {
  const record = asRecord(raw);
  if (record.main_genre || record.main_style || record.score_report) {
    return record;
  }

  const dna = asRecord(record.dna_json);
  if (!Object.keys(dna).length) {
    return record;
  }

  const improvement = asRecord(record.improvement_json);
  const characterProfile = asRecord(dna.character_profile);
  const dominantWeights = asRecord(dna.dominant_dna_weights);

  const category = firstString(dna.category);
  const subCategory = firstString(dna.sub_category);
  const genreMain = firstString(category, dna.genre_main, "truyen_ma");
  const mainStyle = firstString(dna.style_main, "trang_trong");

  const relatedGenres = unique([subCategory, ...Object.keys(dominantWeights)]).filter((item) => item !== genreMain);
  const relatedStyles = unique([
    ...toStringArray(asRecord(dna.style_profile).style_rules),
    ...toStringArray(dna.style_rules),
  ]);

  const coreOutline = toStringArray(dna.core_outline);
  const mergedOutline = coreOutline.length ? coreOutline : outlineFromCoreStructure(dna.core_structure);

  const characterArray = normalizeCharacters(characterProfile.characters ?? characterProfile);
  const characterCount = Math.max(0, Math.round(toNumber(characterProfile.character_count, characterArray.length)));
  const characterNamePlan = firstString(
    characterProfile.character_name_plan,
    characterProfile.name_plan,
    `${characterCount || characterArray.length || 0} ten`,
  );

  const critique = unique([
    ...toFlatStringArray(improvement.weaknesses),
    ...toFlatStringArray(improvement.missed_opportunities),
    ...toFlatStringArray(improvement.underdeveloped_elements),
    ...toFlatStringArray(improvement.pacing_issues),
    ...toFlatStringArray(improvement.emotional_issues),
    ...toFlatStringArray(improvement.logic_issues),
    ...toFlatStringArray(improvement.atmosphere_issues),
    ...toFlatStringArray(improvement.twist_issues),
  ]);

  const improvementGuidance = unique([
    ...toFlatStringArray(improvement.improvement_rules),
    ...toFlatStringArray(improvement.cinematic_improvements),
    ...toFlatStringArray(improvement.tension_improvements),
    ...toFlatStringArray(improvement.character_improvements),
    ...toFlatStringArray(improvement.plot_improvements),
    ...toFlatStringArray(improvement.ending_improvements),
    ...toFlatStringArray(improvement.character_upgrade_plan),
    ...toFlatStringArray(improvement.style_upgrade_plan),
    ...toFlatStringArray(improvement.coherence_upgrade_rules),
    ...toFlatStringArray(improvement.reader_retention_plan),
    ...toFlatStringArray(improvement.anti_boredom_rules),
    ...toFlatStringArray(improvement.anti_repetition_rules),
  ]);

  const improvedOutline50 = unique([
    ...toFlatStringArray(improvement.improved_outline_50),
    ...toFlatStringArray(improvement.improved_story_outline),
    ...toFlatStringArray(improvement.plot_improvements),
    ...toFlatStringArray(improvement.tension_improvements),
    ...toFlatStringArray(improvement.ending_improvements),
  ]);

  return {
    main_genre: genreMain,
    related_genres: relatedGenres,
    main_style: mainStyle,
    related_styles: relatedStyles,
    tags: toStringArray(dna.sub_tags),
    context_country: inferContextCountry(dna),
    character_name_plan: characterNamePlan,
    character_count: characterCount,
    characters: characterArray,
    core_outline: mergedOutline,
    story_summary: firstString(record.summary_md, dna.story_summary, dna.core_concept),
    critique,
    improvement_guidance: improvementGuidance,
    improved_outline_50: improvedOutline50,
    score_report: dna.scores,
    evaluation_commentary_md: firstString(record.expert_commentary_md, record.evaluation_commentary_md),
  };
}

async function repairJsonWithModel(
  apiKey: string,
  apiUrl: string,
  model: string,
  rawText: string,
): Promise<unknown | null> {
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Chuyen noi dung ve dung 1 JSON object hop le theo schema DNA. Tra ve JSON duy nhat, khong markdown, khong them giai thich.",
      },
      {
        role: "user",
        content: [
          "Chuan hoa noi dung sau thanh JSON object hop le theo schema DNA.",
          "Yeu cau bat buoc co 4 key top-level: dna_json, improvement_json, summary_md, expert_commentary_md.",
          rawText.slice(0, 20000),
        ].join("\n\n"),
      },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };

  recordMetric("api_calls", 1);
  recordMetric("api_calls_dna", 1);
  let response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok && response.status === 400) {
    const fallbackBody = { ...body };
    delete (fallbackBody as { response_format?: { type: string } }).response_format;
    recordMetric("api_calls", 1);
    recordMetric("api_calls_dna", 1);
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(fallbackBody),
    });
  }

  if (!response.ok) return null;
  const payload = (await response.json()) as unknown;
  const content = getChoiceContent(payload);
  return parseJsonFromText(content);
}

async function repairVietnameseAccentsWithModel(
  apiKey: string,
  apiUrl: string,
  model: string,
  jsonObject: unknown,
): Promise<unknown | null> {
  const body = {
    model,
    messages: [
      {
        role: "system",
        content: [
          "Bạn là bộ chuẩn hóa tiếng Việt có dấu cho JSON Story DNA.",
          "Giữ nguyên cấu trúc, keys, kiểu dữ liệu, thứ tự logic.",
          "Chỉ sửa các chuỗi tiếng Việt tự nhiên đang bị thiếu dấu.",
          "Không thay đổi slug/tag/id/path/url hay mã kỹ thuật.",
          "Trả về đúng 1 JSON object duy nhất.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify(jsonObject).slice(0, 26000),
      },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };

  recordMetric("api_calls", 1);
  recordMetric("api_calls_dna", 1);
  let response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok && response.status === 400) {
    const fallbackBody = { ...body };
    delete (fallbackBody as { response_format?: { type: string } }).response_format;
    recordMetric("api_calls", 1);
    recordMetric("api_calls_dna", 1);
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(fallbackBody),
    });
  }

  if (!response.ok) return null;
  const payload = (await response.json()) as unknown;
  const direct = getDirectJsonCandidate(payload);
  if (direct) return direct;
  const content = getChoiceContent(payload);
  return parseJsonFromText(content);
}

function buildUserPrompt(input: AnalyzeStoryInput): string {
  const modeLabel = input.createMode === "tu_phan_tich" ? "tu_phan_tich" : "tac_gia";
  return [
    "Phan tich truyen duoi day theo dung SYSTEM PROMPT da cho.",
    "Khi cham diem phai nghiem khac, tranh diem ao.",
    "Bat buoc viet tieng Viet co dau cho cac chuoi dien giai tu nhien.",
    "Bat buoc trong dna_json.category: AI tu chot 1 the loai CHUNG NHAT, khong de roi rac.",
    "Uu tien category nhom tong quat de phuc vu tim kiem (vi du: truyen_ma, nosleep, creepypasta).",
    "Neu co nhieu huong, phai chon duy nhat 1 category bao quat nhat.",
    "Tra ve duy nhat JSON object.",
    "",
    `create_mode: ${modeLabel}`,
    `title: ${input.title}`,
    "",
    "story_content:",
    input.content,
  ].join("\n");
}

function normalizeAnalysis(raw: unknown, fallbackTitle: string, fallbackContent: string): StoryAnalysisResult {
  const rawRecord = asRecord(raw);
  const rawDnaJson = asRecord(rawRecord.dna_json);
  const rawImprovementJson = asRecord(rawRecord.improvement_json);
  const mapped = mapStrictPayloadToLegacy(raw);
  const summaryFallback = fallbackContent.slice(0, 420).trim();
  const normalizedScore = normalizeScoreReport(mapped.score_report);

  const mainGenre = String(mapped.main_genre ?? "truyen_ma").trim() || "truyen_ma";
  const relatedGenres = toStringArray(mapped.related_genres);
  const mainStyle = String(mapped.main_style ?? "trang_trong").trim() || "trang_trong";
  const relatedStyles = toStringArray(mapped.related_styles);
  const tags = toStringArray(mapped.tags);
  const contextCountry = String(mapped.context_country ?? "Viet Nam").trim() || "Viet Nam";
  const characterNamePlan = String(mapped.character_name_plan ?? "3 ten - loai ten Viet Nam").trim() || "3 ten - loai ten Viet Nam";
  const characterCount = Math.max(0, Math.round(toNumber(mapped.character_count, 0)));
  const characters = normalizeCharacters(mapped.characters);
  const coreOutline = toStringArray(mapped.core_outline);
  const storySummary = String(mapped.story_summary ?? "").trim() || `${fallbackTitle}: ${summaryFallback}`;
  const critique = toStringArray(mapped.critique);
  const improvementGuidance = toStringArray(mapped.improvement_guidance);
  const improvedOutlineCandidates = unique([
    ...toStringArray(mapped.improved_outline_50),
    ...improvementGuidance,
    ...toStringArray(mapped.core_outline),
  ]);
  const improvedOutline50 = ensureMinList(improvedOutlineCandidates, 10, [
    "Thiết kế lại mở đầu bằng một biến cố gây bất an ngay trong 3 đoạn đầu, tránh dạo đầu dài.",
    "Đặt mục tiêu cụ thể cho nhân vật chính và gắn hậu quả rõ ràng nếu thất bại.",
    "Tăng dần áp lực theo từng cảnh, mỗi cảnh phải làm khó nhân vật hơn cảnh trước.",
    "Cài một bí mật trung tâm từ sớm, chỉ hé lộ từng lớp để giữ tò mò liên tục.",
    "Mỗi chương kết thúc bằng một câu hỏi mở hoặc tình huống buộc người đọc lật trang.",
    "Loại bỏ các đoạn giải thích dài, chuyển thành hành động và quyết định có xung đột.",
    "Tăng chiều sâu nhân vật phụ: mỗi người có mục đích riêng và xung đột lợi ích.",
    "Làm mới twist cuối bằng lựa chọn đạo đức khó thay vì cú lật chỉ để gây sốc.",
    "Rà soát logic nhân quả giữa các chương để không có bước nhảy vô lý.",
    "Kết thúc bằng dư chấn cảm xúc rõ ràng, tránh khép hời hợt hoặc lặp mô típ cũ.",
  ]);
  const evaluationCommentary = String(mapped.evaluation_commentary_md ?? "").trim();
  const summaryMd = String(rawRecord.summary_md ?? storySummary).trim() || storySummary;
  const expertCommentaryMd = String(rawRecord.expert_commentary_md ?? evaluationCommentary).trim() || evaluationCommentary;

  const normalizedDnaJson: JsonRecord = Object.keys(rawDnaJson).length
    ? rawDnaJson
    : {
        category: mainGenre,
        sub_category: relatedGenres[0] ?? "tong_quan",
        genre_main: mainGenre,
        style_main: mainStyle,
        sub_tags: tags,
        context_country: contextCountry,
        core_outline: coreOutline,
        scores: normalizedScore,
      };

  const normalizedImprovementJson: JsonRecord = Object.keys(rawImprovementJson).length
    ? rawImprovementJson
    : {
        weaknesses: critique,
        improvement_rules: improvementGuidance,
        plot_improvements: improvedOutline50,
      };

  return {
    main_genre: mainGenre,
    related_genres: relatedGenres,
    main_style: mainStyle,
    related_styles: relatedStyles,
    tags,
    context_country: contextCountry,
    character_name_plan: characterNamePlan,
    character_count: characterCount,
    characters,
    core_outline: coreOutline,
    story_summary: storySummary,
    critique,
    improvement_guidance: improvementGuidance,
    improved_outline_50: improvedOutline50,
    score_report: normalizedScore,
    evaluation_commentary_md: evaluationCommentary,
    dna_json: normalizedDnaJson,
    improvement_json: normalizedImprovementJson,
    summary_md: summaryMd,
    expert_commentary_md: expertCommentaryMd,
  };
}

export async function analyzeStoryWithBeeApi(options: AnalyzeStoryOptions): Promise<StoryAnalysisResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error("Thieu API key.");
  }

  const content = options.input.content.trim();
  if (!content) {
    throw new Error("Noi dung truyen rong, khong the phan tich.");
  }

  const apiUrl = (options.apiUrl ?? DEFAULT_BEE_API_URL).trim();
  const model = (options.model ?? DEFAULT_BEE_MODEL).trim();

  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: DNA_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildUserPrompt(options.input),
      },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };

  recordMetric("api_calls", 1);
  recordMetric("api_calls_dna", 1);
  let response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok && response.status === 400) {
    const fallbackBody = { ...requestBody };
    delete (fallbackBody as { response_format?: { type: string } }).response_format;
    recordMetric("api_calls", 1);
    recordMetric("api_calls_dna", 1);
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(fallbackBody),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API loi ${response.status}: ${errorText.slice(0, 320)}`);
  }

  const payload = (await response.json()) as unknown;
  let parsed = getDirectJsonCandidate(payload);
  const modelText = getChoiceContent(payload);
  if (!parsed) {
    parsed = parseJsonFromText(modelText);
  }

  if (!parsed) {
    const legacy = parseLegacyTwoPartFormat(modelText);
    if (legacy) {
      parsed = {
        main_genre: "truyen_ma",
        related_genres: [],
        main_style: "trang_trong",
        related_styles: [],
        tags: [],
        context_country: "Viet Nam",
        character_name_plan: "3 ten - loai ten Viet Nam",
        character_count: 0,
        characters: [],
        core_outline: [],
        story_summary: "",
        critique: [],
        improvement_guidance: [],
        improved_outline_50: [],
        score_report: legacy.scoreReport,
        evaluation_commentary_md: legacy.commentary,
      };
    }
  }

  if (!parsed && modelText.trim()) {
    parsed = await repairJsonWithModel(apiKey, apiUrl, model, modelText);
  }

  if (!parsed) {
    const excerpt = modelText.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`Khong doc duoc JSON tu phan hoi API. Mau phan hoi: ${excerpt}`);
  }

  if (needsVietnameseAccentRepair(parsed)) {
    const repairedVi = await repairVietnameseAccentsWithModel(apiKey, apiUrl, model, parsed);
    if (repairedVi) {
      parsed = repairedVi;
    }
  }

  return normalizeAnalysis(parsed, options.input.title, content);
}
