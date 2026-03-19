import { recordMetric } from "../utils/metrics";

export type ModelApiTestInput = {
  apiKey: string;
  apiUrl: string;
  model: string;
};

export type ModelApiTestResult = {
  ok: boolean;
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function testBeeModelConnection(input: ModelApiTestInput): Promise<ModelApiTestResult> {
  const apiKey = input.apiKey.trim();
  const apiUrl = input.apiUrl.trim();
  const model = input.model.trim();

  if (!apiKey) return { ok: false, message: "Thiếu API key." };
  if (!apiUrl) return { ok: false, message: "Thiếu địa chỉ API." };
  if (!model) return { ok: false, message: "Thiếu model." };

  recordMetric("api_calls", 1);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 20,
      messages: [{ role: "user", content: "Ping API status" }],
    }),
  });

  const rawText = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    // ignore parse error
  }

  if (!response.ok) {
    const parsed = asRecord(payload);
    const err = asRecord(parsed.error);
    const message = String(err.message ?? parsed.message ?? rawText ?? `HTTP ${response.status}`).trim();
    return { ok: false, message: message || `HTTP ${response.status}` };
  }

  const parsed = asRecord(payload);
  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  if (!choices.length) {
    return { ok: false, message: "API trả về rỗng hoặc không đúng định dạng choices." };
  }

  return { ok: true, message: "API đang hoạt động tốt." };
}
