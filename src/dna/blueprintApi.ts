import { STORY_BLUEPRINT_SYSTEM_PROMPT } from "./prompts";
import { recordMetric } from "../utils/metrics";
import { sendBrowserWriterPrompt } from "../utils/electronBridge";

const DEFAULT_BEE_API_URL = "https://platform.beeknoee.com/api/v1/chat/completions";
const DEFAULT_BEE_MODEL = "openai/gpt-oss-120b";

type JsonRecord = Record<string, unknown>;

export type BlueprintDnaSource = {
  dna_id: string;
  title: string;
  category: string;
  sub_category: string;
  styles: string[];
  tags: string[];
  score: number;
  full_payload?: Record<string, unknown>;
};

export type BlueprintRequirements = {
  chapter_count: number;
  genre: string;
  setting: string;
  character_name_language: string;
  additional_notes: string;
};

export type StoryBlueprintResult = {
  logline: string;
  theme_and_core_message: string;
  world_building: {
    ambiance_and_tone: string;
    key_locations: string[];
    rules_of_the_world: string[];
  };
  character_roster: Array<{
    name: string;
    role: string;
    external_goal: string;
    internal_flaw: string;
    dark_secret: string;
    arc_trajectory: string;
  }>;
  story_arcs: Array<{
    arc_name: string;
    focus: string;
    emotional_shift: string;
  }>;
  chapter_outline: Array<{
    chapter_number: number;
    chapter_title: string;
    pov_character: string;
    setting: string;
    plot_beats: string[];
    tension_level: number;
    hook_at_ending: string;
  }>;
  dna_inheritance_report: Record<string, unknown>;
};

// duplicate removed

export type GenerateBlueprintOptions = {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  requirements: BlueprintRequirements;
  sources: BlueprintDnaSource[];
  activeFactors: StoryFactorDefinition[];
};

export type GenerateBlueprintBrowserOptions = {
  writerSessionId: string;
  requirements: BlueprintRequirements;
  sources: BlueprintDnaSource[];
  onProgress?: (message: string) => void;
  activeFactors: StoryFactorDefinition[];
  reviewerApiKey: string;
  reviewerApiUrl?: string;
  reviewerModel?: string;
};

// Removed bad insertion

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
      // ignore
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

function buildUserPrompt(requirements: BlueprintRequirements, sources: BlueprintDnaSource[]): string {
  return [
    "Hãy tạo Story Blueprint mới dựa trên DNA nguồn, tuyệt đối không sao chép truyện gốc.",
    "Trả về đúng 1 JSON object theo SYSTEM PROMPT.",
    "",
    "Yêu cầu người dùng:",
    JSON.stringify(
      {
        chapter_count: Math.max(1, Math.round(requirements.chapter_count)),
        genre: requirements.genre.trim(),
        setting: requirements.setting.trim(),
        additional_notes: requirements.additional_notes.trim(),
      },
      null,
      2,
    ),
    "",
    "DNA nguồn (đã rút gọn):",
    JSON.stringify(sources, null, 2),
  ].join("\n");
}

import type { StoryFactorDefinition } from "./storyFactors";

function buildDnaBlueprintPrompt(requirements: BlueprintRequirements, sources: BlueprintDnaSource[], activeFactors: StoryFactorDefinition[]): string {
  const hasLayToanBo = activeFactors.some(f => f.key === "lay_toan_bo_dna");
  const hasLayVanPhong = activeFactors.some(f => f.key === "lay_van_phong");
  const hasLayCotTruyen = activeFactors.some(f => f.key === "lay_cot_truyen");
  const hasLayCaiThien = activeFactors.some(f => f.key === "lay_dna_cai_thien");

  const filteredSources = sources.map(source => {
    if (hasLayToanBo) return source;
    const newSource = { ...source };
    if (newSource.full_payload) {
      const filteredPayload: any = {
        summary: newSource.full_payload.summary,
      };
      if (hasLayCotTruyen) {
        filteredPayload.core = newSource.full_payload.core;
        filteredPayload.structures = newSource.full_payload.structures;
        filteredPayload.world_building = newSource.full_payload.world_building;
      }
      if (hasLayVanPhong) {
        filteredPayload.writing_styles = newSource.full_payload.writing_styles;
        filteredPayload.styles = newSource.full_payload.styles;
      }
      if (hasLayCaiThien) {
        filteredPayload.improvement_rules = newSource.full_payload.improvement_rules;
        filteredPayload.anti_boredom_rules = newSource.full_payload.anti_boredom_rules;
      }
      newSource.full_payload = filteredPayload;
    }
    return newSource;
  });

  const rankedSources = filteredSources.map((source, index) => ({
    rank: index + 1,
    dna_id: source.dna_id,
    title: source.title,
    category: source.category,
    sub_category: source.sub_category,
    score: Number(source.score.toFixed(1)),
    structure_signals: source.tags.slice(0, 3),
    style_signals: source.styles.slice(0, 3),
    mutation_rule:
      index === 0
        ? "Day la DNA neo. Phai ke thua logic van hanh va luc keo chinh."
        : index <= 2
          ? "Day la DNA ho tro. Phai muon motif, quy tac so hai hoac chat van phong."
          : "Day la DNA bo sung. Chi lay chat lieu, khong de no lan at DNA neo.",
  }));

  const scoreSortedIds = [...sources]
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((source) => source.dna_id);

  return [
    "--- NHIỆM VỤ THẦN TỐC ---",
    "Hãy thiết kế một Story Blueprint (Dàn ý cốt truyện) có sức mạnh điện ảnh, lấy cảm hứng và kế thừa từ các DNA nguồn bên dưới.",
    "BẮT BUỘC: Viết dưới dạng văn bản tự nhiên, dạt dào cảm xúc và chi tiết. KHÔNG VIẾT JSON, không bọc code block.",
    "",
    "DNA KHÔNG PHẢI DỮ LIỆU THAM KHẢO LỎNG. DNA LÀ RÀNG BUỘC BẮT BUỘC.",
    "Blueprint tạo ra phải truy được dấu vết rõ ràng từ ít nhất 3 DNA nguồn.",
    "Ưu tiên DNA điểm cao, nhưng vẫn phải tôn trọng DNA gần thể loại và style yêu cầu nhất.",
    "Quy tắc kế thừa và đột biến:",
    "- DNA neo quyết định trục xung đột, động cơ vận hành và kiểu áp lực của truyện.",
    "- DNA hỗ trợ bổ sung motif, quy tắc sợ hãi, chất liệu không gian, văn phong và cách dẫn cao trào.",
    "- DNA điểm cao nhất phải được ưu tiên trong những chỗ lựa chọn gây tranh chấp.",
    "- TÊN NHÂN VẬT & NGÔN NGỮ: Tên nhân vật (character_roster) BẮT BUỘC phải phù hợp với thiết lập 'story_language' và 'character_name_language' nhưng không được dịch máy móc.",
    "- LIÊN KẾT LIỀN MẠCH: chapter_outline phải cho thấy các chương nối liền chặt chẽ với nhau. Nếu chương 1 đang kịch tính, kết nguy hiểm, thì chương 2 KHÔNG ĐƯỢC tự nhiên yên bình. Phải giữ vững timeline và cảm xúc.",
    "- dna_inheritance_report phai noi ro tung DNA dong gop gi va da dot bien nhu the nao de thanh ban moi.",
    "- chapter_outline phai cho thay nhan qua lien tuc, moi chuong co it nhat 1 luc day moi, 1 hinh anh/manh am thanh dang nho, 1 hook cuoi chuong.",
    "",
    "--- Yếu tố bổ trợ (Factor Prompts) ---",
    "Nếu các yếu tố sau được kích hoạt, hãy lồng ghép chúng vào thiết kế blueprint:",
    activeFactors.map(f => `- [${f.title}]: ${f.prompt}`).join("\n"),
    "",
    "Yeu cau nguoi dung:",
    JSON.stringify(
      {
        chapter_count: Math.max(1, Math.round(requirements.chapter_count)),
        genre: requirements.genre.trim(),
        setting: requirements.setting.trim(),
        character_name_language: requirements.character_name_language.trim(),
        additional_notes: requirements.additional_notes.trim(),
      },
      null,
      2,
    ),
    "",
    "DNA nguon da xep uu tien:",
    JSON.stringify(rankedSources, null, 2),
    "",
    "DNA diem cao can uu tien manh tay:",
    JSON.stringify(scoreSortedIds, null, 2),
    "",
    "DNA nguon day du:",
    JSON.stringify(filteredSources, null, 2),
  ].join("\n");
}

async function repairJsonWithBrowserWriter(writerSessionId: string, rawText: string): Promise<unknown | null> {
  const prompt = [
    "Hay chuyen noi dung sau thanh 1 JSON object hop le theo schema Story Blueprint.",
    "Chi tra ve JSON object duy nhat, khong giai thich.",
    "",
    rawText.slice(0, 22000),
  ].join("\n");

  const repairedText = await sendBrowserWriterPrompt({
    sessionId: writerSessionId,
    prompt,
    newConversation: false,
    timeoutMs: 240000,
  });
  return parseJsonFromText(repairedText);
}

function normalizeBlueprint(raw: unknown, chapterCount: number): StoryBlueprintResult {
  const record = asRecord(raw);
  const world = asRecord(record.world_building);

  const chapterOutline = Array.isArray(record.chapter_outline)
    ? (record.chapter_outline as unknown[]).map((item, index) => {
        const row = asRecord(item);
        return {
          chapter_number: Math.max(1, Math.round(toNumber(row.chapter_number, index + 1))),
          chapter_title: String(row.chapter_title ?? "").trim(),
          pov_character: String(row.pov_character ?? "").trim(),
          setting: String(row.setting ?? "").trim(),
          plot_beats: toStringArray(row.plot_beats),
          tension_level: Math.max(1, Math.min(10, Math.round(toNumber(row.tension_level, 5)))),
          hook_at_ending: String(row.hook_at_ending ?? "").trim(),
        };
      })
    : [];

  if (!chapterOutline.length) {
    for (let index = 0; index < Math.max(1, chapterCount); index += 1) {
      chapterOutline.push({
        chapter_number: index + 1,
        chapter_title: `Chương ${index + 1}`,
        pov_character: "",
        setting: "",
        plot_beats: [],
        tension_level: 5,
        hook_at_ending: "",
      });
    }
  }

  return {
    logline: String(record.logline ?? "").trim(),
    theme_and_core_message: String(record.theme_and_core_message ?? "").trim(),
    world_building: {
      ambiance_and_tone: String(world.ambiance_and_tone ?? "").trim(),
      key_locations: toStringArray(world.key_locations),
      rules_of_the_world: toStringArray(world.rules_of_the_world),
    },
    character_roster: Array.isArray(record.character_roster)
      ? (record.character_roster as unknown[]).map((item) => {
          const row = asRecord(item);
          return {
            name: String(row.name ?? "").trim(),
            role: String(row.role ?? "").trim(),
            external_goal: String(row.external_goal ?? "").trim(),
            internal_flaw: String(row.internal_flaw ?? "").trim(),
            dark_secret: String(row.dark_secret ?? "").trim(),
            arc_trajectory: String(row.arc_trajectory ?? "").trim(),
          };
        })
      : [],
    story_arcs: Array.isArray(record.story_arcs)
      ? (record.story_arcs as unknown[]).map((item) => {
          const row = asRecord(item);
          return {
            arc_name: String(row.arc_name ?? "").trim(),
            focus: String(row.focus ?? "").trim(),
            emotional_shift: String(row.emotional_shift ?? "").trim(),
          };
        })
      : [],
    chapter_outline: chapterOutline,
    dna_inheritance_report: asRecord(record.dna_inheritance_report),
  };
}

async function repairJsonWithModel(apiKey: string, apiUrl: string, model: string, rawText: string): Promise<unknown | null> {
  const body = {
    model,
    messages: [
      {
        role: "system",
        content: "Chuyển nội dung thành 1 JSON object hợp lệ theo schema Story Blueprint. Chỉ trả JSON.",
      },
      {
        role: "user",
        content: rawText.slice(0, 20000),
      },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };

  recordMetric("api_calls", 1);
  recordMetric("api_calls_story", 1);
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
    recordMetric("api_calls_story", 1);
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

export async function generateStoryBlueprintWithBeeApi(options: GenerateBlueprintOptions): Promise<StoryBlueprintResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Thiếu API key.");
  if (!options.sources.length) throw new Error("Chưa có DNA nguồn để tạo blueprint.");

  const apiUrl = (options.apiUrl ?? DEFAULT_BEE_API_URL).trim();
  const model = (options.model ?? DEFAULT_BEE_MODEL).trim();
  const chapterCount = Math.max(1, Math.round(options.requirements.chapter_count));

  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: STORY_BLUEPRINT_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildDnaBlueprintPrompt(options.requirements, options.sources, options.activeFactors),
      },
    ],
    temperature: 0.35,
    response_format: { type: "json_object" },
  };

  recordMetric("api_calls", 1);
  recordMetric("api_calls_story", 1);
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
    recordMetric("api_calls_story", 1);
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
    throw new Error(`API lỗi ${response.status}: ${errorText.slice(0, 320)}`);
  }

  const payload = (await response.json()) as unknown;
  let parsed = getDirectJsonCandidate(payload);
  const modelText = getChoiceContent(payload);
  if (!parsed) parsed = parseJsonFromText(modelText);
  if (!parsed && modelText.trim()) parsed = await repairJsonWithModel(apiKey, apiUrl, model, modelText);

  if (!parsed) {
    const excerpt = modelText.replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`Không đọc được JSON blueprint từ phản hồi API. Mẫu phản hồi: ${excerpt}`);
  }

  return normalizeBlueprint(parsed, chapterCount);
}

export async function generateStoryBlueprintWithBrowser(options: GenerateBlueprintBrowserOptions): Promise<StoryBlueprintResult> {
  if (!options.writerSessionId.trim()) throw new Error("Thieu writerSessionId cho browser writer.");
  if (!options.sources.length) throw new Error("Chua co DNA nguon de tao blueprint.");
  if (!options.reviewerApiKey?.trim()) throw new Error("Thiếu API key cho Reviewer đánh giá Blueprint.");

  const chapterCount = Math.max(1, Math.round(options.requirements.chapter_count));
  const reviewerApiUrl = (options.reviewerApiUrl ?? DEFAULT_BEE_API_URL).trim();
  const reviewerModel = (options.reviewerModel ?? DEFAULT_BEE_MODEL).trim() || DEFAULT_BEE_MODEL;

  let attempt = 0;
  let finalJson: StoryBlueprintResult | null = null;
  let carryGuidance = "";

  while (attempt < 3) {
    const attemptLabel = attempt > 0 ? ` (lần sửa ${attempt})` : "";
    options.onProgress?.(`Đang tạo Sườn truyện (văn bản) bằng ChatGPT${attemptLabel}...`);

    let promptArr = [STORY_BLUEPRINT_SYSTEM_PROMPT, "", buildDnaBlueprintPrompt(options.requirements, options.sources, options.activeFactors)];
    if (carryGuidance) {
      promptArr.push("", "NHẬN XÉT CỦA REVIEWER Ở LẦN VIẾT TRƯỚC, BẠN PHẢI SỬA CÁC ĐIỂM SAU:", carryGuidance);
    }

    const rawText = await sendBrowserWriterPrompt({
      sessionId: options.writerSessionId,
      prompt: promptArr.join("\n"),
      newConversation: attempt === 0, // only new conversation on first attempt
      timeoutMs: 15 * 60 * 1000,
    });

    options.onProgress?.(`Đang gửi sườn truyện cho Giám khảo (Reviewer API) đánh giá khả năng bám sát DNA...`);

    const reviewPrompt = `Đánh giá Sườn truyện (Blueprint) dạng văn bản sau đây so với YÊU CẦU và DNA gốc.
YÊU CẦU: Thể loại (${options.requirements.genre}), Bối cảnh (${options.requirements.setting}), ${options.requirements.chapter_count} chương.
DNA: ${options.sources.map(s => s.title).join(", ")}.

Nếu Sườn truyện TỐT, cuốn hút và đáp ứng DNA:
  is_pass: true,
  must_fix: [],
  extracted_blueprint: { (Trích xuất lại toàn bộ outline đó dưới dạng JSON Story Blueprint chuẩn) }

Nếu Sườn truyện CHƯA TỐT, nhàm chán hoặc lạc đề:
  is_pass: false,
  must_fix: ["Lý do 1", "Lý do 2..."],
  extracted_blueprint: null

Sườn truyện cần đánh giá:
${rawText.slice(0, 20000)}

TRẢ VỀ DUY NHẤT 1 JSON OBJECT CÓ SCHEMA:
{
  "is_pass": boolean,
  "must_fix": [ "sting" ],
  "extracted_blueprint": {
    "logline": "...",
    "theme_and_core_message": "...",
    "world_building": { "ambiance_and_tone": "", "key_locations": [], "rules_of_the_world": [] },
    "character_roster": [ { "name": "", "role": "", "external_goal": "", "internal_flaw": "", "dark_secret": "", "arc_trajectory": "" } ],
    "story_arcs": [ { "arc_name": "", "focus": "", "emotional_shift": "" } ],
    "chapter_outline": [ { "chapter_number": 1, "chapter_title": "", "pov_character": "", "setting": "", "plot_beats": [], "tension_level": 5, "hook_at_ending": "" } ],
    "dna_inheritance_report": {}
  }
}
CHỈ TRẢ VỀ JSON KHÔNG EXPLAIN.`;

    const reviewPayload = await fetch(reviewerApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.reviewerApiKey.trim()}`,
      },
      body: JSON.stringify({
        model: reviewerModel,
        messages: [{ role: "user", content: reviewPrompt }],
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
    });

    if (!reviewPayload.ok) {
      const errTxt = await reviewPayload.text();
      throw new Error(`Lỗi gọi Reviewer API: ${errTxt.slice(0, 300)}`);
    }

    const payloadJson = await reviewPayload.json() as any;
    const content = payloadJson.choices?.[0]?.message?.content || payloadJson.choices?.[0]?.text;
    let parsedReview = parseJsonFromText(content) as any;

    if (!parsedReview || typeof parsedReview.is_pass !== "boolean") {
       throw new Error("Không thể đọc phản hồi JSON của hệ thống Reviewer đánh giá blueprint.");
    }

    if (parsedReview.is_pass === false && attempt < 2) {
       carryGuidance = Array.isArray(parsedReview.must_fix) ? parsedReview.must_fix.join("\n- ") : "Sườn truyện chưa đạt yêu cầu DNA, xin viết lại.";
       attempt += 1;
       continue;
    }

    // PASSED or hit max attempts
    const bp = parsedReview.extracted_blueprint;
    if (!bp || typeof bp !== "object") {
       throw new Error("Reviewer đã duyệt nhưng không trích xuất được file JSON Blueprint.");
    }

    finalJson = normalizeBlueprint(bp, chapterCount);
    break;
  }

  if (!finalJson) throw new Error("Không thể hoàn thành Sườn Truyện sau 3 lần sửa.");
  return finalJson;
}
