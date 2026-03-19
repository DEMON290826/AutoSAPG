import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Activity, BarChart3, BookText, DatabaseZap, HardDrive, RefreshCw } from "lucide-react";
import { getStoryProjectStorageStats } from "../dna/storyStorage";
import { readJsonStorage } from "../utils/localState";
import { readMetrics, type MetricsStore } from "../utils/metrics";

type MetricsBucket = {
  api_calls: number;
  api_calls_dna: number;
  api_calls_story: number;
  dna_created: number;
  story_created: number;
};

type ChartPoint = {
  key: string;
  label: string;
  bucket: MetricsBucket;
};

type RangeKey = "7d" | "30d" | "1y";

type StoryStorageStats = {
  available: boolean;
  baseDir: string;
  storyCount: number;
  storageBytes: number;
};

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; title: string }> = [
  { key: "7d", label: "7 ngày", title: "Biểu đồ cột API 7 ngày gần nhất" },
  { key: "30d", label: "30 ngày", title: "Biểu đồ cột API 30 ngày gần nhất" },
  { key: "1y", label: "1 năm", title: "Biểu đồ cột API 1 năm gần nhất" },
];

const STORY_STORAGE_CAP_BYTES = 10 * 1024 * 1024 * 1024;

function useAnimatedNumber(target: number, durationMs = 520): number {
  const [value, setValue] = useState(target);

  useEffect(() => {
    const from = value;
    const to = target;
    if (from === to) return;

    const start = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (to - from) * eased);
      if (progress < 1) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return value;
}

function fmtInt(value: number): string {
  return Math.round(Math.max(0, value)).toLocaleString("vi-VN");
}

function fmtBytes(bytes: number): string {
  const safe = Math.max(0, bytes);
  if (safe >= 1024 * 1024 * 1024) return `${(safe / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (safe >= 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(2)} MB`;
  if (safe >= 1024) return `${(safe / 1024).toFixed(2)} KB`;
  return `${safe} B`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function zeroBucket(): MetricsBucket {
  return {
    api_calls: 0,
    api_calls_dna: 0,
    api_calls_story: 0,
    dna_created: 0,
    story_created: 0,
  };
}

function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDayKey(dayKey: string): Date | null {
  const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeBucket(raw: unknown): MetricsBucket {
  if (!raw || typeof raw !== "object") return zeroBucket();
  const row = raw as Record<string, unknown>;
  return {
    api_calls: Number.isFinite(Number(row.api_calls)) ? Math.max(0, Number(row.api_calls)) : 0,
    api_calls_dna: Number.isFinite(Number(row.api_calls_dna)) ? Math.max(0, Number(row.api_calls_dna)) : 0,
    api_calls_story: Number.isFinite(Number(row.api_calls_story)) ? Math.max(0, Number(row.api_calls_story)) : 0,
    dna_created: Number.isFinite(Number(row.dna_created)) ? Math.max(0, Number(row.dna_created)) : 0,
    story_created: Number.isFinite(Number(row.story_created)) ? Math.max(0, Number(row.story_created)) : 0,
  };
}

function addBucket(target: MetricsBucket, source: MetricsBucket): MetricsBucket {
  return {
    api_calls: target.api_calls + source.api_calls,
    api_calls_dna: target.api_calls_dna + source.api_calls_dna,
    api_calls_story: target.api_calls_story + source.api_calls_story,
    dna_created: target.dna_created + source.dna_created,
    story_created: target.story_created + source.story_created,
  };
}

function buildDailySeries(metrics: MetricsStore, days: number): ChartPoint[] {
  const safeDays = Math.max(1, Math.min(30, Math.round(days)));
  const now = new Date();
  const rows: ChartPoint[] = [];
  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    const dayKey = toDayKey(date);
    const bucket = normalizeBucket(metrics.by_day[dayKey]);
    rows.push({
      key: dayKey,
      label: `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`,
      bucket,
    });
  }
  return rows;
}

function buildMonthlySeries(metrics: MetricsStore): ChartPoint[] {
  const now = new Date();
  const monthBuckets = new Map<string, MetricsBucket>();

  Object.entries(metrics.by_day).forEach(([dayKey, rawBucket]) => {
    const date = parseDayKey(dayKey);
    if (!date) return;
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const previous = monthBuckets.get(monthKey) ?? zeroBucket();
    monthBuckets.set(monthKey, addBucket(previous, normalizeBucket(rawBucket)));
  });

  const rows: ChartPoint[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    rows.push({
      key: monthKey,
      label: `${String(monthDate.getMonth() + 1).padStart(2, "0")}/${String(monthDate.getFullYear()).slice(-2)}`,
      bucket: monthBuckets.get(monthKey) ?? zeroBucket(),
    });
  }
  return rows;
}

function buildRangeSeries(metrics: MetricsStore, range: RangeKey): ChartPoint[] {
  if (range === "7d") return buildDailySeries(metrics, 7);
  if (range === "30d") return buildDailySeries(metrics, 30);
  return buildMonthlySeries(metrics);
}

function barHeight(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) return 0;
  return Math.max(6, (value / maxValue) * 100);
}

function getStoryStoragePathFromSettings(): string {
  const settings = readJsonStorage<Record<string, unknown>>("app.settings", {});
  return String(settings.storyStoragePath ?? "").trim();
}

function readStoryStorageStatsSafe(): StoryStorageStats {
  try {
    return getStoryProjectStorageStats(getStoryStoragePathFromSettings());
  } catch {
    return {
      available: false,
      baseDir: "",
      storyCount: 0,
      storageBytes: 0,
    };
  }
}

export function AnalysisView() {
  const [metrics, setMetrics] = useState<MetricsStore>(() => readMetrics());
  const [storyStorage, setStoryStorage] = useState<StoryStorageStats>(() => readStoryStorageStatsSafe());
  const [lastUpdated, setLastUpdated] = useState(new Date().toISOString());
  const [range, setRange] = useState<RangeKey>("7d");

  const refresh = () => {
    setMetrics(readMetrics());
    setStoryStorage(readStoryStorageStatsSafe());
    setLastUpdated(new Date().toISOString());
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh();
    }, 2800);
    return () => window.clearInterval(timer);
  }, []);

  const todayBucket = useMemo(() => {
    const todayKey = toDayKey(new Date());
    return normalizeBucket(metrics.by_day[todayKey]);
  }, [metrics.updated_at, lastUpdated]);

  const series = useMemo(() => buildRangeSeries(metrics, range), [metrics.updated_at, lastUpdated, range]);

  const maxDaily = useMemo(
    () => Math.max(1, ...series.map((row) => row.bucket.api_calls_story), ...series.map((row) => row.bucket.api_calls_dna)),
    [series],
  );

  const apiTotalAnimated = useAnimatedNumber(metrics.totals.api_calls);
  const dnaTotalAnimated = useAnimatedNumber(metrics.totals.dna_created);
  const storyTotalAnimated = useAnimatedNumber(metrics.totals.story_created);
  const todayApiAnimated = useAnimatedNumber(todayBucket.api_calls);

  const rangeTitle = RANGE_OPTIONS.find((item) => item.key === range)?.title ?? "Biểu đồ cột API";
  const chartMinWidth = Math.max(720, series.length * 56);
  const yTicks = [1, 0.75, 0.5, 0.25, 0];

  const storyStoragePercent = clamp((storyStorage.storageBytes / STORY_STORAGE_CAP_BYTES) * 100, 0, 100);
  const requestTotal = Math.max(0, metrics.totals.api_calls);
  const requestStory = Math.max(0, metrics.totals.api_calls_story);
  const requestDna = Math.max(0, metrics.totals.api_calls_dna);
  const requestKnown = requestStory + requestDna;
  const requestOther = Math.max(0, requestTotal - requestKnown);
  const requestStoryPercent = requestTotal > 0 ? (requestStory / requestTotal) * 100 : 0;
  const requestDnaPercent = requestTotal > 0 ? (requestDna / requestTotal) * 100 : 0;

  const storageRingStyle = {
    background: `conic-gradient(#63d8aa 0 ${storyStoragePercent}%, rgba(255,255,255,0.08) ${storyStoragePercent}% 100%)`,
  } as CSSProperties;

  const requestRingStyle = {
    background: `conic-gradient(#8ed0ff 0 ${requestStoryPercent}%, #ffb36d ${requestStoryPercent}% ${requestStoryPercent + requestDnaPercent}%, rgba(255,255,255,0.08) ${
      requestStoryPercent + requestDnaPercent
    }% 100%)`,
  } as CSSProperties;

  return (
    <section className="analysis-view">
      <header className="section-head analysis-head">
        <div>
          <p className="breadcrumb">HỆ THỐNG &gt; PHÂN TÍCH</p>
          <h1>Tổng hợp vận hành</h1>
        </div>
        <button type="button" className="ghost-btn compact" onClick={refresh}>
          <RefreshCw size={14} />
          Làm mới
        </button>
      </header>

      <div className="analysis-kpi-grid">
        <article className="kpi-card analysis-kpi-card">
          <p>Tổng API đã gọi</p>
          <h3>{fmtInt(apiTotalAnimated)}</h3>
          <small>Hôm nay: {fmtInt(todayApiAnimated)}</small>
        </article>
        <article className="kpi-card analysis-kpi-card">
          <p>Tổng DNA đã tạo</p>
          <h3>{fmtInt(dnaTotalAnimated)}</h3>
          <small>Hôm nay: {fmtInt(todayBucket.dna_created)}</small>
        </article>
        <article className="kpi-card analysis-kpi-card">
          <p>Tổng truyện đã tạo</p>
          <h3>{fmtInt(storyTotalAnimated)}</h3>
          <small>Hôm nay: {fmtInt(todayBucket.story_created)}</small>
        </article>
      </div>

      <section className="table-card analysis-chart-card">
        <header className="table-head">
          <h2>{rangeTitle}</h2>
          <div className="analysis-head-controls">
            <div className="analysis-range-switch">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`analysis-range-btn ${range === option.key ? "active" : ""}`}
                  onClick={() => setRange(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="analysis-legend">
              <span className="legend-chip story">
                <BookText size={12} />
                API tạo truyện
              </span>
              <span className="legend-chip dna">
                <DatabaseZap size={12} />
                API DNA
              </span>
            </div>
          </div>
        </header>

        <div className="analysis-columns-scroll">
          <div className="analysis-columns" style={{ minWidth: chartMinWidth }}>
            <div className="analysis-y-axis">
              {yTicks.map((tick) => (
                <span key={tick}>{Math.round(maxDaily * tick)}</span>
              ))}
            </div>
            <div className="analysis-columns-plot">
              {yTicks.map((tick) => (
                <div key={tick} className="analysis-grid-line" style={{ top: `${(1 - tick) * 100}%` } as CSSProperties} />
              ))}
              <div className="analysis-columns-grid">
                {series.map((row) => (
                  <div key={row.key} className="analysis-group">
                    <div className="analysis-group-bars analysis-group-bars-2">
                      <div className="analysis-column story" style={{ height: `${barHeight(row.bucket.api_calls_story, maxDaily)}%` }}>
                        {row.bucket.api_calls_story > 0 ? <span>{row.bucket.api_calls_story}</span> : null}
                      </div>
                      <div className="analysis-column dna" style={{ height: `${barHeight(row.bucket.api_calls_dna, maxDaily)}%` }}>
                        {row.bucket.api_calls_dna > 0 ? <span>{row.bucket.api_calls_dna}</span> : null}
                      </div>
                    </div>
                    <div className="analysis-group-label">{row.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="analysis-donut-grid">
          <article className="analysis-donut-card">
            <header>
              <HardDrive size={15} />
              <h3>Truyện chiếm bộ nhớ</h3>
            </header>
            <div className="analysis-donut-row">
              <div className="analysis-donut-ring" style={storageRingStyle}>
                <span>{Math.round(storyStoragePercent)}%</span>
              </div>
              <div className="analysis-donut-copy">
                <p>{storyStorage.available ? `${fmtInt(storyStorage.storyCount)} truyện` : "Chưa đọc được local storage"}</p>
                <small>
                  {fmtBytes(storyStorage.storageBytes)} / {fmtBytes(STORY_STORAGE_CAP_BYTES)}
                </small>
              </div>
            </div>
          </article>

          <article className="analysis-donut-card">
            <header>
              <Activity size={15} />
              <h3>Tổng request</h3>
            </header>
            <div className="analysis-donut-row">
              <div className="analysis-donut-ring" style={requestRingStyle}>
                <span>{fmtInt(requestTotal)}</span>
              </div>
              <div className="analysis-donut-copy">
                <p>Story API: {fmtInt(requestStory)}</p>
                <small>DNA API: {fmtInt(requestDna)}</small>
                {requestOther > 0 ? <small>Khác: {fmtInt(requestOther)}</small> : null}
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="table-card analysis-insight-card">
        <header className="table-head">
          <h2>Đánh giá nhanh</h2>
        </header>
        <div className="analysis-insight-grid">
          <div className="insight-item">
            <BarChart3 size={16} />
            <p>
              API hôm nay: <strong>{fmtInt(todayBucket.api_calls)}</strong> lượt.
            </p>
          </div>
          <div className="insight-item">
            <DatabaseZap size={16} />
            <p>
              DNA tạo mới hôm nay: <strong>{fmtInt(todayBucket.dna_created)}</strong>.
            </p>
          </div>
          <div className="insight-item">
            <BookText size={16} />
            <p>
              Truyện tạo mới hôm nay: <strong>{fmtInt(todayBucket.story_created)}</strong>.
            </p>
          </div>
        </div>
      </section>
    </section>
  );
}
