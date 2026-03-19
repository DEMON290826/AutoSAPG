export type StoryFactorDefinition = {
  id: string;
  key: string;
  title: string;
  description: string;
  prompt: string;
  enabled_by_default: boolean;
  builtin: boolean;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeFactorKey(raw: string): string {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized;
}

export function normalizeFactorKey(raw: string): string {
  const normalized = sanitizeFactorKey(raw);
  return normalized || "yeu_to_moi";
}

export function normalizeFactorKeyDraft(raw: string): string {
  return sanitizeFactorKey(raw);
}

function normalizePrompt(raw: Record<string, unknown>): string {
  const prompt = String(raw.prompt ?? "").trim();
  if (prompt) return prompt;
  
  const rules = raw.apply_rules;
  if (Array.isArray(rules)) {
    return rules.map((r) => String(r ?? "").trim()).filter(Boolean).join("\n");
  }
  return "";
}

export const DEFAULT_STORY_FACTORS: StoryFactorDefinition[] = [
  {
    id: "builtin_lay_toan_bo_dna",
    key: "lay_toan_bo_dna",
    title: "Lấy Toàn Bộ DNA",
    description: "Kế thừa và sử dụng toàn bộ tất cả dữ liệu có trong DNA nguồn.",
    prompt: "Sử dụng toàn bộ dữ liệu, thông số, và chi tiết đặc tả từ DNA được cung cấp để triển khai nội dung.",
    enabled_by_default: false,
    builtin: true,
    created_at: "2026-03-18T00:00:00.000Z",
    updated_at: "2026-03-18T00:00:00.000Z",
  },
  {
    id: "builtin_lay_van_phong",
    key: "lay_van_phong",
    title: "Lấy Văn Phong",
    description: "Chỉ tập trung học theo cách hành văn, nhiệt độ ngôn ngữ, và mô thức câu từ của DNA.",
    prompt: "Bắt chước chính xác văn phong của bản gốc. Giữ nguyên cảm giác ngôn từ, cách lặp từ, nhiệt độ ngôn ngữ và kết cấu câu đặc trưng của DNA nguồn.",
    enabled_by_default: true,
    builtin: true,
    created_at: "2026-03-18T00:00:00.000Z",
    updated_at: "2026-03-18T00:00:00.000Z",
  },
  {
    id: "builtin_lay_cot_truyen",
    key: "lay_cot_truyen",
    title: "Lấy Cốt truyện",
    description: "Kế thừa sườn sự kiện, nhân quả, cao trào và thiết lập thế giới của DNA.",
    prompt: "Bám theo khung logic cốt truyện và các beat tiến triển chính của DNA. Sử dụng thiết lập thế giới và các luật lệ (rules) được xây dựng trong nguồn tham khảo.",
    enabled_by_default: false,
    builtin: true,
    created_at: "2026-03-18T00:00:00.000Z",
    updated_at: "2026-03-18T00:00:00.000Z",
  },
  {
    id: "builtin_lay_dna_cai_thien",
    key: "lay_dna_cai_thien",
    title: "Lấy DNA cải thiện",
    description: "Học hỏi và áp dụng các đề xuất cải thiện để truyện mới tốt hơn truyện gốc.",
    prompt: "Sửa đổi các điểm yếu hoặc lặp lại nhàm chán được nhắc đến trong DNA. Tăng cường độ kịch tính và hiệu quả kể chuyện dựa trên các đề xuất cải thiện đi kèm.",
    enabled_by_default: true,
    builtin: true,
    created_at: "2026-03-18T00:00:00.000Z",
    updated_at: "2026-03-18T00:00:00.000Z",
  },
];

export function normalizeStoryFactors(raw: unknown): StoryFactorDefinition[] {
  const source = Array.isArray(raw) ? raw : [];
  const byKey = new Map<string, StoryFactorDefinition>();
  const currentTime = nowIso();

  source.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const key = normalizeFactorKey(String(row.key ?? ""));
    if (!key) return;

    const createdAt = String(row.created_at ?? currentTime).trim() || currentTime;
    const updatedAt = String(row.updated_at ?? createdAt).trim() || createdAt;

    byKey.set(key, {
      id: String(row.id ?? `factor_${index}_${key}`),
      key,
      title: String(row.title ?? key).trim() || key,
      description: String(row.description ?? "").trim(),
      prompt: normalizePrompt(row),
      enabled_by_default: Boolean(row.enabled_by_default),
      builtin: Boolean(row.builtin),
      created_at: createdAt,
      updated_at: updatedAt,
    });
  });

  DEFAULT_STORY_FACTORS.forEach((factor) => {
    const existing = byKey.get(factor.key);
    if (!existing) {
      byKey.set(factor.key, { ...factor });
      return;
    }

    byKey.set(factor.key, {
      ...existing,
      title: existing.title || factor.title,
      description: existing.description || factor.description,
      prompt: existing.prompt || factor.prompt,
      builtin: existing.builtin || factor.builtin,
      enabled_by_default: existing.enabled_by_default ?? factor.enabled_by_default,
    });
  });

  return Array.from(byKey.values()).sort((left, right) => {
    if (left.builtin !== right.builtin) return left.builtin ? -1 : 1;
    return left.title.localeCompare(right.title, "vi");
  });
}

export function createStoryFactor(input: {
  key: string;
  title: string;
  description: string;
  prompt: string;
  enabledByDefault: boolean;
}): StoryFactorDefinition {
  const createdAt = nowIso();
  const key = normalizeFactorKey(input.key || input.title);
  return {
    id: `factor_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    key,
    title: String(input.title ?? "").trim() || key,
    description: String(input.description ?? "").trim(),
    prompt: String(input.prompt ?? "").trim(),
    enabled_by_default: Boolean(input.enabledByDefault),
    builtin: false,
    created_at: createdAt,
    updated_at: createdAt,
  };
}
