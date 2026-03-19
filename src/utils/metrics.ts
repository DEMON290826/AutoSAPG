import { readJsonStorage, writeJsonStorage } from "./localState";

export type MetricKey = "api_calls" | "api_calls_dna" | "api_calls_story" | "dna_created" | "story_created";

export type MetricsDayBucket = {
  api_calls: number;
  api_calls_dna: number;
  api_calls_story: number;
  dna_created: number;
  story_created: number;
};

export type MetricsStore = {
  version: string;
  updated_at: string;
  totals: MetricsDayBucket;
  by_day: Record<string, MetricsDayBucket>;
};

const METRICS_KEY = "app.metrics";

const EMPTY_BUCKET: MetricsDayBucket = {
  api_calls: 0,
  api_calls_dna: 0,
  api_calls_story: 0,
  dna_created: 0,
  story_created: 0,
};

function nowIso(): string {
  return new Date().toISOString();
}

function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeBucket(raw: unknown): MetricsDayBucket {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const apiCalls = Number.isFinite(Number(row.api_calls)) ? Math.max(0, Number(row.api_calls)) : 0;
  const dnaCreated = Number.isFinite(Number(row.dna_created)) ? Math.max(0, Number(row.dna_created)) : 0;
  const storyCreated = Number.isFinite(Number(row.story_created)) ? Math.max(0, Number(row.story_created)) : 0;
  const apiCallsDnaRaw = Number.isFinite(Number(row.api_calls_dna)) ? Math.max(0, Number(row.api_calls_dna)) : 0;
  const apiCallsStoryRaw = Number.isFinite(Number(row.api_calls_story)) ? Math.max(0, Number(row.api_calls_story)) : 0;

  let apiCallsDna = apiCallsDnaRaw;
  let apiCallsStory = apiCallsStoryRaw;

  // Backward-compat: old metric rows only had api_calls total.
  if (apiCalls > 0 && apiCallsDnaRaw <= 0 && apiCallsStoryRaw <= 0) {
    const dnaWeight = dnaCreated > 0 ? dnaCreated : 1;
    const storyWeight = storyCreated > 0 ? storyCreated : 1;
    const totalWeight = dnaWeight + storyWeight;
    apiCallsDna = Math.round((apiCalls * dnaWeight) / totalWeight);
    apiCallsStory = Math.max(0, apiCalls - apiCallsDna);
  }

  return {
    api_calls: apiCalls,
    api_calls_dna: apiCallsDna,
    api_calls_story: apiCallsStory,
    dna_created: dnaCreated,
    story_created: storyCreated,
  };
}

export function normalizeMetrics(raw: unknown): MetricsStore {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const byDayRaw = row.by_day && typeof row.by_day === "object" ? (row.by_day as Record<string, unknown>) : {};

  const byDay: Record<string, MetricsDayBucket> = {};
  Object.entries(byDayRaw).forEach(([dayKey, value]) => {
    byDay[dayKey] = normalizeBucket(value);
  });

  return {
    version: String(row.version ?? "1.1.0"),
    updated_at: String(row.updated_at ?? nowIso()),
    totals: normalizeBucket(row.totals ?? EMPTY_BUCKET),
    by_day: byDay,
  };
}

export function readMetrics(): MetricsStore {
  return normalizeMetrics(readJsonStorage<MetricsStore | null>(METRICS_KEY, null));
}

export function recordMetric(metric: MetricKey, value = 1, at = new Date()): MetricsStore {
  if (!Number.isFinite(value) || value === 0) return readMetrics();

  const current = readMetrics();
  const dayKey = formatDayKey(at);
  const nextDay = normalizeBucket(current.by_day[dayKey] ?? EMPTY_BUCKET);
  const delta = Math.max(0, Math.round(value));

  nextDay[metric] += delta;

  const next: MetricsStore = {
    ...current,
    updated_at: nowIso(),
    totals: {
      ...current.totals,
      [metric]: current.totals[metric] + delta,
    },
    by_day: {
      ...current.by_day,
      [dayKey]: nextDay,
    },
  };

  writeJsonStorage(METRICS_KEY, next);
  return next;
}

export function buildMetricSeries(days: number): Array<{ dayKey: string; label: string; bucket: MetricsDayBucket }> {
  const safeDays = Math.max(1, Math.min(60, Math.round(days)));
  const metrics = readMetrics();
  const now = new Date();
  const result: Array<{ dayKey: string; label: string; bucket: MetricsDayBucket }> = [];

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    const dayKey = formatDayKey(date);
    const bucket = normalizeBucket(metrics.by_day[dayKey] ?? EMPTY_BUCKET);
    const label = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
    result.push({ dayKey, label, bucket });
  }

  return result;
}

export function getTodayBucket(): MetricsDayBucket {
  const dayKey = formatDayKey(new Date());
  const metrics = readMetrics();
  return normalizeBucket(metrics.by_day[dayKey] ?? EMPTY_BUCKET);
}
