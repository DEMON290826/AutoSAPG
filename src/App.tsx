import { useEffect, useMemo, useState } from "react";
import { canUseElectronBridge, closeBrowserAllSessions, listenUpdateStatus, triggerUpdateCheck, getBrowserWriterSessionCount, startBrowserWriterSession, closeBrowserWriterSession } from "./utils/electronBridge";
import { AudioLines, Bell, BookOpenText, Bot, BrainCircuit, LayoutDashboard, LoaderCircle, ServerCog, SlidersHorizontal, Sparkles, WandSparkles, RefreshCw } from "lucide-react";
import { testBeeModelConnection } from "./dna/modelApi";
import { DEFAULT_STORY_FACTORS, normalizeStoryFactors } from "./dna/storyFactors";
import type { StoryFactorDefinition } from "./dna/storyFactors";
import type { DnaEntry } from "./dna/types";
import type { ApiRuntimeHealth, AppSettingsState, AppTheme, ModelRegistryItem } from "./types/appSettings";
import { readJsonStorage, writeJsonStorage } from "./utils/localState";
import appLogo from "./assets/app-icon.png";
import { AnalysisView } from "./views/AnalysisView";
import { DnaManagementView } from "./views/DnaManagementView";
import { ModelRegistryView } from "./views/ModelRegistryView";
import { SettingsView } from "./views/SettingsView";
import { StoryFactorView } from "./views/StoryFactorView";
import { StoryBlueprintView } from "./views/StoryBlueprintView";
import { StoryCreateView } from "./views/StoryCreateView";
import { StoryLibraryView } from "./views/StoryLibraryView";

type ProductTab = "autoStories" | "autoGrok" | "autoPrompt" | "autoAudio";
type StoriesSubTab = "taoTruyen" | "taoYeuTo" | "taoDna" | "quanLyDna";
type SideSection = "dashboard" | "library" | "analysis" | "models" | "settings";

const DEFAULT_API_URL = "https://platform.beeknoee.com/api/v1/chat/completions";

const STORAGE_KEYS = [
  "app.activeProduct",
  "app.activeStoriesTab",
  "app.sideSection",
  "app.manualEntries",
  "app.theme",
  "app.settings",
  "app.models",
  "app.storyFactors",
  "app.metrics",
  "creator.state",
  "manager.state",
  "blueprint.state",
  "story.create.state",
] as const;

const productTabs: Array<{ key: ProductTab; label: string; icon: typeof Sparkles; soon?: boolean }> = [
  { key: "autoStories", label: "Auto Stories", icon: Sparkles },
  { key: "autoGrok", label: "Auto Grok", icon: Bot, soon: true },
  { key: "autoPrompt", label: "Auto Prompt", icon: WandSparkles, soon: true },
  { key: "autoAudio", label: "Auto Audio", icon: AudioLines, soon: true },
];

const storiesTabs: Array<{ key: StoriesSubTab; label: string }> = [
  { key: "taoTruyen", label: "Tạo Truyện" },
  { key: "taoDna", label: "Tạo DNA" },
  { key: "quanLyDna", label: "Quản Lý DNA" },
];

const storiesTabsWithFactors: Array<{ key: StoriesSubTab; label: string }> = storiesTabs.some((tab) => tab.key === "taoYeuTo")
  ? storiesTabs
  : [
      storiesTabs[0],
      { key: "taoYeuTo", label: "Tạo Yếu Tố" },
      ...storiesTabs.slice(1),
    ];

const storiesTabsUi: Array<{ key: StoriesSubTab; label: string }> = [
  { key: "taoTruyen", label: "Tiến trình" },
  { key: "taoYeuTo", label: "Tạo Yếu Tố" },
  { key: "taoDna", label: "Tạo DNA" },
  { key: "quanLyDna", label: "Thư viện DNA" },
];

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeManualEntries(raw: unknown): DnaEntry[] {
  if (!Array.isArray(raw)) return [];

  const allowedStatus = new Set(["ready", "processing", "archived"]);
  const allowedSourceType = new Set(["TEXT/PDF", "WEB SCRAPING", "STRUCTURED", "AUDIO"]);

  return raw
    .map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const dnaId = String(row.dna_id ?? "").trim() || `manual_${Date.now()}_${index}`;
      const category = String(row.category ?? "").trim() || "truyen_ma";
      const title = String(row.title ?? "").trim() || `DNA ${index + 1}`;
      const sourceFile = String(row.source_file ?? "").trim();
      const subCategory = String(row.sub_category ?? "").trim() || "general";
      const styles = normalizeStringArray(row.styles);
      const tags = normalizeStringArray(row.tags);
      const statusRaw = String(row.status ?? "ready").trim();
      const sourceTypeRaw = String(row.source_type ?? "TEXT/PDF").trim();
      const createdAt = String(row.created_at ?? "").trim() || new Date().toISOString();
      const sizeMb = Math.max(0, toFiniteNumber(row.size_mb, 0));
      const scoreRow = row.scores && typeof row.scores === "object" ? (row.scores as Record<string, unknown>) : {};
      const matchRow = row.match_bonus && typeof row.match_bonus === "object" ? (row.match_bonus as Record<string, unknown>) : {};

      return {
        dna_id: dnaId,
        category,
        title,
        source_file: sourceFile,
        sub_category: subCategory,
        styles,
        tags,
        status: allowedStatus.has(statusRaw) ? (statusRaw as DnaEntry["status"]) : "ready",
        source_type: allowedSourceType.has(sourceTypeRaw) ? (sourceTypeRaw as DnaEntry["source_type"]) : "TEXT/PDF",
        size_mb: sizeMb,
        scores: {
          overall: Math.max(0, toFiniteNumber(scoreRow.overall, 0)),
          fear_factor: Math.max(0, toFiniteNumber(scoreRow.fear_factor, 0)),
          twist_power: Math.max(0, toFiniteNumber(scoreRow.twist_power, 0)),
          cinematic_quality: Math.max(0, toFiniteNumber(scoreRow.cinematic_quality, 0)),
          reusability: Math.max(0, toFiniteNumber(scoreRow.reusability, 0)),
        },
        created_at: createdAt,
        match_bonus: {
          genre_match: Math.max(0, toFiniteNumber(matchRow.genre_match, 0)),
          style_match: Math.max(0, toFiniteNumber(matchRow.style_match, 0)),
        },
      } as DnaEntry;
    })
    .filter((entry) => Boolean(entry.dna_id && entry.category && entry.title));
}

function clearSavedState(): void {
  if (typeof window === "undefined") return;
  STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
}

function modelKey(vendor: string, model: string): string {
  return `${vendor.trim().toLowerCase()}::${model.trim().toLowerCase()}`;
}

function makeModelId(vendor: string, model: string): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}_${modelKey(vendor, model).replace(/[^a-z0-9:]/g, "_")}`;
}

const DEFAULT_SETTINGS: AppSettingsState = {
  apiUrl: DEFAULT_API_URL,
  dnaApiKey: "",
  dnaStoragePath: "",
  storyStoragePath: "",
  storyCookieJsonPath: "",
  storyWriterChatUrl: "https://chatgpt.com/",
  storyReviewerVendor: "",
  storyReviewerModel: "",
  dnaVendor: "",
  dnaModel: "",
  storyBatchSize: 1,
  dnaBatchSize: 1,
  storyApiKeys: "",
  useStoryReviewer: true,
  maxRetries: 3,
  retryDelay: 30000,
  dnaSystemPrompt: "",
  storySystemPrompt: "",
};

function normalizeSettings(raw: Record<string, unknown>): AppSettingsState {
  const clampBatch = (value: unknown, fallback: number, max: number = 10): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(max, Math.round(parsed)));
  };
  const storyReviewerVendor = String(raw.storyReviewerVendor ?? "").trim();
  const storyReviewerModel = String(raw.storyReviewerModel ?? "").trim();
  const dnaVendor = String(raw.dnaVendor ?? "").trim();
  const dnaModel = String(raw.dnaModel ?? "").trim();
  const legacyBatch = clampBatch(raw.batchSize, 1);
  const storyBatchSize = clampBatch(raw.storyBatchSize, legacyBatch, 15);
  const dnaBatchSize = clampBatch(raw.dnaBatchSize, legacyBatch, 15);
  const maxRetries = clampBatch(raw.maxRetries, 3, 10);
  const retryDelay = clampBatch(raw.retryDelay, 30000, 300000);

  return {
    apiUrl: String(raw.apiUrl ?? DEFAULT_SETTINGS.apiUrl).trim() || DEFAULT_SETTINGS.apiUrl,
    dnaApiKey: String(raw.dnaApiKey ?? "").trim(),
    dnaStoragePath: String(raw.dnaStoragePath ?? "").trim(),
    storyStoragePath: String(raw.storyStoragePath ?? "").trim(),
    storyCookieJsonPath: String(raw.storyCookieJsonPath ?? "").trim(),
    storyWriterChatUrl: String(raw.storyWriterChatUrl ?? DEFAULT_SETTINGS.storyWriterChatUrl).trim() || DEFAULT_SETTINGS.storyWriterChatUrl,
    storyReviewerVendor,
    storyReviewerModel,
    dnaVendor,
    dnaModel,
    storyBatchSize,
    dnaBatchSize,
    storyApiKeys: String(raw.storyApiKeys ?? raw.storyApiKey ?? "").trim(),
    useStoryReviewer: raw.useStoryReviewer !== undefined ? Boolean(raw.useStoryReviewer) : DEFAULT_SETTINGS.useStoryReviewer,
    maxRetries,
    retryDelay,
    dnaSystemPrompt: String(raw.dnaSystemPrompt ?? "").trim(),
    storySystemPrompt: String(raw.storySystemPrompt ?? "").trim(),
  };
}

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [updateStatus, setUpdateStatus] = useState("");
  const [theme, setTheme] = useState<AppTheme>("dark");
  const [activeProduct, setActiveProduct] = useState<ProductTab>(() => {
    const value = readJsonStorage<string>("app.activeProduct", "autoStories");
    return ["autoStories", "autoGrok", "autoPrompt", "autoAudio"].includes(value) ? (value as ProductTab) : "autoStories";
  });
  const [activeStoriesTab, setActiveStoriesTab] = useState<StoriesSubTab>(() => {
    const value = readJsonStorage<string>("app.activeStoriesTab", "taoTruyen");
    return ["taoTruyen", "khoTruyen", "taoYeuTo", "taoDna", "quanLyDna"].includes(value) ? (value as StoriesSubTab) : "taoTruyen";
  });
  const [sideSection, setSideSection] = useState<SideSection>(() => {
    const value = readJsonStorage<string>("app.sideSection", "dashboard");
    return ["dashboard", "library", "analysis", "models", "settings"].includes(value) ? (value as SideSection) : "dashboard";
  });
  const [manualEntries, setManualEntries] = useState<DnaEntry[]>(() => normalizeManualEntries(readJsonStorage<unknown>("app.manualEntries", [])));
  const [settings, setSettings] = useState<AppSettingsState>(() => normalizeSettings(readJsonStorage<Record<string, unknown>>("app.settings", DEFAULT_SETTINGS)));
  const [models, setModels] = useState<ModelRegistryItem[]>(() => readJsonStorage<ModelRegistryItem[]>("app.models", []));
  const [storyFactors, setStoryFactors] = useState<StoryFactorDefinition[]>(() =>
    normalizeStoryFactors(readJsonStorage<StoryFactorDefinition[]>("app.storyFactors", DEFAULT_STORY_FACTORS)),
  );
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [apiHealth, setApiHealth] = useState<ApiRuntimeHealth>({
    status: "idle",
    message: "Chưa test API.",
    checkedAt: "",
  });

  const runtimeSelections = useMemo(
    () => [
      {
        scope: "dna" as const,
        vendor: settings.dnaVendor.trim(),
        model: settings.dnaModel.trim(),
        apiKey: settings.dnaApiKey.trim(),
        label: "Tạo DNA",
      },
    ],
    [settings.dnaVendor, settings.dnaModel, settings.dnaApiKey],
  );

  const runtimeSelectionsForHealth = useMemo(
    () => {
      const storyKeys = settings.storyApiKeys.split(/[;,\n]+/).map(k => k.trim()).filter(Boolean);
      const storyReviewerKey = storyKeys[0] || "";
      
      return [
        ...runtimeSelections,
        {
          scope: "storyReviewer" as const,
          vendor: settings.storyReviewerVendor.trim(),
          model: settings.storyReviewerModel.trim(),
          apiKey: storyReviewerKey,
          label: "Reviewer Truyện",
        },
      ];
    },
    [runtimeSelections, settings.storyReviewerVendor, settings.storyReviewerModel, settings.storyApiKeys],
  );

  const runRuntimeApiHealthCheck = async (): Promise<void> => {
    if (isTestingModel) return;

    const apiUrl = settings.apiUrl.trim();
    const invalidScopes = runtimeSelectionsForHealth.filter((item) => !item.vendor || !item.model || !item.apiKey || !apiUrl).map((item) => item.label);

    if (invalidScopes.length > 0) {
      setApiHealth({
        status: "idle",
        message: `Chưa đủ cấu hình API cho: ${invalidScopes.join(", ")}.`,
        checkedAt: "",
      });
      return;
    }

    setIsTestingModel(true);
    setApiHealth({
      status: "testing",
      message: "Đang kiểm tra API cho Reviewer Truyện và Tạo DNA...",
      checkedAt: new Date().toISOString(),
    });

    const checkedAt = new Date().toISOString();

    try {
      const results = await Promise.all(
        runtimeSelectionsForHealth.map(async (item) => {
          try {
            const result = await testBeeModelConnection({
              apiKey: item.apiKey,
              apiUrl,
              model: item.model,
            });
            return { ...item, ok: result.ok, message: result.message };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Lỗi không xác định";
            return { ...item, ok: false, message };
          }
        }),
      );

      const failed = results.filter((item) => !item.ok);
      setApiHealth({
        status: failed.length > 0 ? "error" : "ok",
        message:
          failed.length > 0
            ? `API đang lỗi: ${failed.map((item) => `${item.label} (${item.message})`).join(" | ")}`
            : "API đang hoạt động tốt cho Reviewer Truyện và Tạo DNA.",
        checkedAt,
      });

      setModels((prev) =>
        prev.map((item) => {
          const matched = results.filter((result) => result.vendor === item.vendor && result.model === item.model);
          if (!matched.length) return item;
          const failedResult = matched.find((result) => !result.ok);
          const picked = failedResult ?? matched[0];
          return {
            ...item,
            lastStatus: picked.ok ? "ok" : "error",
            lastMessage: picked.message,
            lastCheckedAt: checkedAt,
          };
        }),
      );
    } finally {
      setIsTestingModel(false);
    }
  };

  const addModel = (vendorRaw: string, modelRaw: string): { ok: boolean; message: string } => {
    const vendor = vendorRaw.trim();
    const model = modelRaw.trim();

    if (!vendor) return { ok: false, message: "Hãng AI không được để trống." };
    if (!model) return { ok: false, message: "Tên model không được để trống." };

    const dup = models.some((item) => modelKey(item.vendor, item.model) === modelKey(vendor, model));
    if (dup) return { ok: false, message: "Model này đã tồn tại trong danh sách." };

    const next: ModelRegistryItem = {
      id: makeModelId(vendor, model),
      vendor,
      model,
      lastStatus: "idle",
      lastMessage: "",
      lastCheckedAt: "",
    };

    setModels((prev) => {
      const merged = [...prev, next];
      merged.sort((a, b) => {
        const byVendor = a.vendor.localeCompare(b.vendor, "vi");
        if (byVendor !== 0) return byVendor;
        return a.model.localeCompare(b.model, "vi");
      });
      return merged;
    });

    setSettings((prev) => {
      const nextSettings = { ...prev };
      const isDnaScopeActive = sideSection === "dashboard" && activeProduct === "autoStories" && activeStoriesTab === "taoDna";
      if (isDnaScopeActive) {
        nextSettings.dnaVendor = vendor;
        nextSettings.dnaModel = model;
      }
      if (!nextSettings.storyReviewerVendor || !nextSettings.storyReviewerModel) {
        nextSettings.storyReviewerVendor = vendor;
        nextSettings.storyReviewerModel = model;
      }
      if (!nextSettings.dnaVendor || !nextSettings.dnaModel) {
        nextSettings.dnaVendor = vendor;
        nextSettings.dnaModel = model;
      }
      return nextSettings;
    });

    return { ok: true, message: "Đã thêm model vào danh sách." };
  };

  const deleteModelsByIds = (ids: string[]): { ok: boolean; message: string } => {
    const idSet = new Set(ids);
    const deletedCount = models.filter((item) => idSet.has(item.id)).length;
    if (!deletedCount) return { ok: false, message: "Không có model hợp lệ để xóa." };
    setModels((prev) => prev.filter((item) => !idSet.has(item.id)));
    return { ok: true, message: `Đã xóa ${deletedCount} model.` };
  };

  const resolveApiKeyForModel = (item: ModelRegistryItem): string => {
    const dnaKey = settings.dnaApiKey.trim();
    const storyKeys = settings.storyApiKeys.split(/[;,\n]+/).map(k => k.trim()).filter(Boolean);
    const storyReviewerKey = storyKeys[0] || "";
    
    const storyReviewerPair = modelKey(settings.storyReviewerVendor, settings.storyReviewerModel);
    const dnaPair = modelKey(settings.dnaVendor, settings.dnaModel);
    const currentPair = modelKey(item.vendor, item.model);

    if (currentPair === storyReviewerPair && storyReviewerKey) return storyReviewerKey;
    if (currentPair === dnaPair && dnaKey) return dnaKey;
    return storyReviewerKey || dnaKey;
  };

  const testModelsByIds = async (ids: string[]): Promise<{ ok: boolean; message: string }> => {
    if (isTestingModel) return { ok: false, message: "Đang có tiến trình test API khác." };

    const idSet = new Set(ids);
    const targets = models.filter((item) => idSet.has(item.id));
    if (!targets.length) return { ok: false, message: "Chưa chọn model để test." };

    const apiUrl = settings.apiUrl.trim();
    if (!apiUrl) return { ok: false, message: "Thiếu địa chỉ API." };

    setIsTestingModel(true);
    setApiHealth({
      status: "testing",
      message: `Đang test ${targets.length} model đã chọn...`,
      checkedAt: new Date().toISOString(),
    });

    const checkedAt = new Date().toISOString();
    try {
      const results = await Promise.all(
        targets.map(async (item) => {
          const apiKey = resolveApiKeyForModel(item);
          if (!apiKey) {
            return {
              id: item.id,
              ok: false,
              message: "Thiếu API key cho model này.",
            };
          }
          try {
            const result = await testBeeModelConnection({
              apiKey,
              apiUrl,
              model: item.model,
            });
            return {
              id: item.id,
              ok: result.ok,
              message: result.message,
            };
          } catch (error) {
            return {
              id: item.id,
              ok: false,
              message: error instanceof Error ? error.message : "Lỗi không xác định",
            };
          }
        }),
      );

      const failed = results.filter((item) => !item.ok);
      const summaryMessage =
        failed.length > 0
          ? `API lỗi ở ${failed.length}/${results.length} model.`
          : `Đã test thành công ${results.length}/${results.length} model.`;

      setApiHealth({
        status: failed.length > 0 ? "error" : "ok",
        message: summaryMessage,
        checkedAt,
      });

      setModels((prev) =>
        prev.map((item) => {
          const matched = results.find((result) => result.id === item.id);
          if (!matched) return item;
          return {
            ...item,
            lastStatus: matched.ok ? "ok" : "error",
            lastMessage: matched.message,
            lastCheckedAt: checkedAt,
          };
        }),
      );

      return { ok: failed.length === 0, message: summaryMessage };
    } finally {
      setIsTestingModel(false);
    }
  };


  const setStoryReviewerVendor = (vendor: string) => {
    setSettings((prev) => {
      const firstModelForVendor = models.find((item) => item.vendor === vendor)?.model ?? "";
      const keepCurrent = models.some((item) => item.vendor === vendor && item.model === prev.storyReviewerModel);
      return {
        ...prev,
        storyReviewerVendor: vendor,
        storyReviewerModel: keepCurrent ? prev.storyReviewerModel : firstModelForVendor,
      };
    });
  };

  const setStoryReviewerModel = (model: string) => {
    setSettings((prev) => ({
      ...prev,
      storyReviewerModel: model,
    }));
  };

  const setDnaVendor = (vendor: string) => {
    setSettings((prev) => {
      const firstModelForVendor = models.find((item) => item.vendor === vendor)?.model ?? "";
      const keepCurrent = models.some((item) => item.vendor === vendor && item.model === prev.dnaModel);
      return {
        ...prev,
        dnaVendor: vendor,
        dnaModel: keepCurrent ? prev.dnaModel : firstModelForVendor,
      };
    });
  };

  const setDnaModel = (model: string) => {
    setSettings((prev) => ({
      ...prev,
      dnaModel: model,
    }));
  };

  const handleChangeSettings = (next: Partial<AppSettingsState>) => {
    setSettings((prev) => ({ ...prev, ...next }));
  };

  useEffect(() => {
    writeJsonStorage("app.theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    let forceTimer: number | null = null;
    const minDelay = 950;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

    const finishBoot = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - startedAt;
      const remain = Math.max(0, minDelay - elapsed);
      timer = window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          if (!disposed) setIsBooting(false);
        });
      }, remain);
    };

    const fontsReady =
      typeof document !== "undefined" && "fonts" in document && document.fonts?.ready
        ? document.fonts.ready.catch(() => undefined)
        : Promise.resolve();

    // Hard fallback to avoid black screen if font loading hangs in Electron.
    forceTimer = window.setTimeout(() => {
      if (!disposed) setIsBooting(false);
    }, 2600);

    const waitForBoot = Promise.race([
      fontsReady,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1200);
      }),
    ]);

    void waitForBoot.finally(finishBoot);

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      if (forceTimer !== null) window.clearTimeout(forceTimer);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleAltWheelScrollX = (event: WheelEvent) => {
      if (!event.altKey) return;
      if (!(event.target instanceof HTMLElement)) return;

      let current: HTMLElement | null = event.target;
      while (current) {
        const style = window.getComputedStyle(current);
        const canScrollX = /(auto|scroll)/.test(style.overflowX) && current.scrollWidth > current.clientWidth + 1;
        if (canScrollX) {
          event.preventDefault();
          const delta = Math.abs(event.deltaY) > 0 ? event.deltaY : event.deltaX;
          current.scrollLeft += delta;
          return;
        }
        current = current.parentElement;
      }
    };

    window.addEventListener("wheel", handleAltWheelScrollX, { passive: false });
    return () => window.removeEventListener("wheel", handleAltWheelScrollX);
  }, []);

  useEffect(() => {
    writeJsonStorage("app.activeProduct", activeProduct);
  }, [activeProduct]);

  useEffect(() => {
    writeJsonStorage("app.activeStoriesTab", activeStoriesTab);
  }, [activeStoriesTab]);

  useEffect(() => {
    writeJsonStorage("app.sideSection", sideSection);
  }, [sideSection]);

  useEffect(() => {
    writeJsonStorage("app.manualEntries", manualEntries);
  }, [manualEntries]);

  useEffect(() => {
    writeJsonStorage("app.settings", settings);
  }, [settings]);

  useEffect(() => {
    writeJsonStorage("app.models", models);
  }, [models]);

  useEffect(() => {
    writeJsonStorage("app.storyFactors", storyFactors);
  }, [storyFactors]);

  useEffect(() => {
    if (!models.length) return;
    const first = models[0];
    setSettings((prev) => {
      const next = { ...prev };

      const hasStoryReviewerPair = models.some((item) => item.vendor === prev.storyReviewerVendor && item.model === prev.storyReviewerModel);
      if (!hasStoryReviewerPair) {
        const storyReviewerVendor = models.some((item) => item.vendor === prev.storyReviewerVendor) ? prev.storyReviewerVendor : first.vendor;
        const storyReviewerModel = models.find((item) => item.vendor === storyReviewerVendor)?.model ?? first.model;
        next.storyReviewerVendor = storyReviewerVendor;
        next.storyReviewerModel = storyReviewerModel;
      }

      const hasDnaPair = models.some((item) => item.vendor === prev.dnaVendor && item.model === prev.dnaModel);
      if (!hasDnaPair) {
        const dnaVendor = models.some((item) => item.vendor === prev.dnaVendor) ? prev.dnaVendor : first.vendor;
        const dnaModel = models.find((item) => item.vendor === dnaVendor)?.model ?? first.model;
        next.dnaVendor = dnaVendor;
        next.dnaModel = dnaModel;
      }

      if (
        next.storyReviewerVendor === prev.storyReviewerVendor &&
        next.storyReviewerVendor === prev.storyReviewerVendor &&
        next.storyReviewerModel === prev.storyReviewerModel &&
        next.dnaVendor === prev.dnaVendor &&
        next.dnaModel === prev.dnaModel
      ) {
        return prev;
      }
      return next;
    });
  }, [models]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runRuntimeApiHealthCheck();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    settings.apiUrl,
    settings.storyApiKeys,
    settings.storyReviewerVendor,
    settings.storyReviewerModel,
    settings.dnaApiKey,
    settings.dnaVendor,
    settings.dnaModel,
  ]);

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
    if (!canUseElectronBridge()) return;
    const unlisten = listenUpdateStatus((status) => {
      setUpdateStatus(status);
    });
    return () => unlisten();
  }, []);

  const handleResetSavedData = () => {
    if (typeof window === "undefined") return;
    const confirmed = window.confirm("Xóa toàn bộ dữ liệu cài đặt đã lưu và tải lại ứng dụng?");
    if (!confirmed) return;
    clearSavedState();
    window.location.reload();
  };

  const apiStatusClass = apiHealth.status === "ok" ? "ok" : apiHealth.status === "error" ? "error" : apiHealth.status === "testing" ? "testing" : "idle";

  return (
    <main className={`studio-shell ${isBooting ? "is-booting" : ""}`} data-theme={theme}>
      <section className="studio-frame">
        <aside className="left-sidebar">
          <div className="brand-block">
            <div className="brand-logo">
              <img className="brand-logo-image" src={appLogo} alt="AutoRun logo" loading="eager" />
            </div>
            <div>
              <p className="brand-name">AutoSAPG</p>
              <p className="brand-sub">Story DNA Studio 1.0.14</p>
            </div>
          </div>

          <nav className="side-nav">
            <button type="button" className={`side-link ${sideSection === "dashboard" ? "active" : ""}`} onClick={() => setSideSection("dashboard")}>
              <LayoutDashboard size={18} />
              Bảng điều khiển DNA
            </button>
            <button type="button" className={`side-link ${sideSection === "library" ? "active" : ""}`} onClick={() => setSideSection("library")}>
              <BookOpenText size={18} />
              Kho truyện
            </button>
            <button type="button" className={`side-link ${sideSection === "analysis" ? "active" : ""}`} onClick={() => setSideSection("analysis")}>
              <BrainCircuit size={18} />
              Phân tích
            </button>
            <button type="button" className={`side-link ${sideSection === "models" ? "active" : ""}`} onClick={() => setSideSection("models")}>
              <ServerCog size={18} />
              Model
            </button>
            <button type="button" className={`side-link ${sideSection === "settings" ? "active" : ""}`} onClick={() => setSideSection("settings")}>
              <SlidersHorizontal size={18} />
              Cài đặt
            </button>
          </nav>
        </aside>

        <section className="workspace">
          <header className="workspace-header">
            <div className="app-logo">
              <img src={appLogo} alt="AutoSAPG Logo" className="logo-image" style={{ width: "24px", height: "24px", borderRadius: "4px" }} />
              <h1>
                AutoSAPG <span>v1.0.14</span>
              </h1>
              <button 
                type="button" 
                onClick={triggerUpdateCheck} 
                className="update-check-btn tooltip-trigger" 
                title="Kiểm tra cập nhật phần mềm"
                style={{ background: "transparent", border: "none", color: "var(--text-3)", cursor: "pointer", marginLeft: "4px", padding: 0 }}
              >
                 <RefreshCw size={14} />
              </button>
              {updateStatus && <div className="update-badge">{updateStatus}</div>}
            </div>
            <div className="product-nav">
              {productTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button key={tab.key} type="button" className={`product-nav-btn product-${tab.key} ${activeProduct === tab.key ? "active" : ""}`} onClick={() => setActiveProduct(tab.key)}>
                    <Icon size={16} />
                    {tab.label}
                    {tab.soon ? <span className="soon-chip">Sắp ra mắt</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="top-actions">
              {activeSessionCount > 0 && (
                <div className="chrome-status-chip">
                  <span className="api-status-dot green pulse-glow" />
                  <span>Chrome: {activeSessionCount}</span>
                </div>
              )}
              <div className={`api-status-badge ${apiStatusClass}`} style={{ minWidth: "100px" }}>
                <span className="api-status-dot" />
                <span>{apiHealth.status === "ok" ? "HỆ THỐNG OK" : apiHealth.status === "error" ? "HỆ THỐNG Lỗi" : apiHealth.status === "testing" ? "Đang Test" : "Chờ Test"}</span>
              </div>
              <button type="button" className="icon-square" aria-label="Thông báo">
                {isTestingModel ? <LoaderCircle size={16} className="spin" /> : <Bell size={16} />}
              </button>
            </div>
          </header>

          <section className={`workspace-pane ${sideSection === "dashboard" ? "" : "pane-hidden"}`}>
            <section className={`coming-soon ${activeProduct !== "autoStories" ? "" : "pane-hidden"}`}>
              <div className="coming-soon-card">
                <Sparkles size={28} />
                <h2>{productTabs.find((tab) => tab.key === activeProduct)?.label}</h2>
                <p>Mục này đang trong quá trình phát triển. Hiện tại bạn có thể dùng Auto Stories để quản lý DNA.</p>
              </div>
            </section>

            <section className={`stories-stack ${activeProduct === "autoStories" ? "" : "pane-hidden"}`}>
              <div className="stories-subnav">
                {storiesTabsUi.map((tab) => (
                  <button key={tab.key} type="button" className={`stories-tab-btn ${activeStoriesTab === tab.key ? "active" : ""}`} onClick={() => setActiveStoriesTab(tab.key)}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className={`stories-panel ${activeStoriesTab === "taoTruyen" ? "" : "pane-hidden"}`}>
	                  <StoryBlueprintView
	                    manualEntries={manualEntries}
	                    storyApiKeys={settings.storyApiKeys}
	                    apiUrl={settings.apiUrl}
	                    storyStoragePath={settings.storyStoragePath}
	                    storyCookieJsonPath={settings.storyCookieJsonPath}
	                    storyWriterChatUrl={settings.storyWriterChatUrl}
	                    models={models}
                    reviewerVendor={settings.storyReviewerVendor}
                    reviewerModel={settings.storyReviewerModel}
                    useStoryReviewer={settings.useStoryReviewer}
                    batchSize={settings.storyBatchSize}
                    factors={storyFactors}
                    maxRetries={settings.maxRetries}
                    retryDelay={settings.retryDelay}
                    onSelectReviewerVendor={setStoryReviewerVendor}
                    onSelectReviewerModel={setStoryReviewerModel}
                    onToggleReviewer={(val) => setSettings(prev => ({ ...prev, useStoryReviewer: val }))}
                  />
              </div>


              <div className={`stories-panel ${activeStoriesTab === "taoYeuTo" ? "" : "pane-hidden"}`}>
                {activeStoriesTab === "taoYeuTo" ? <StoryFactorView factors={storyFactors} onChangeFactors={setStoryFactors} /> : null}
              </div>

              <div className={`stories-panel ${activeStoriesTab === "taoDna" ? "" : "pane-hidden"}`}>
                {activeStoriesTab === "taoDna" ? (
                  <StoryCreateView
                    onSavedEntry={(entry) => setManualEntries((prev) => [entry, ...prev])}
                    apiKey={settings.dnaApiKey}
                    apiUrl={settings.apiUrl}
                    dnaStoragePath={settings.dnaStoragePath}
                    models={models}
                    selectedVendor={settings.dnaVendor}
                    selectedModel={settings.dnaModel}
                    batchSize={settings.dnaBatchSize}
                    onSelectVendor={setDnaVendor}
                    onSelectModel={setDnaModel}
                  />
                ) : null}
              </div>

              <div className={`stories-panel ${activeStoriesTab === "quanLyDna" ? "" : "pane-hidden"}`}>
                {activeStoriesTab === "quanLyDna" ? (
                  <DnaManagementView 
                    manualEntries={manualEntries} 
                    setManualEntries={setManualEntries} 
                    dnaStoragePath={settings.dnaStoragePath}
                  />
                ) : null}
              </div>
            </section>
          </section>

          <section className={`stories-stack ${sideSection === "library" ? "" : "pane-hidden"}`}>
            {sideSection === "library" ? <StoryLibraryView storyStoragePath={settings.storyStoragePath} /> : null}
          </section>

          <section className={`coming-soon pane-hidden`}>
            <div className="coming-soon-card">
              <BrainCircuit size={28} />
              <h2>Phân tích</h2>
              <p>Khu vực phân tích tổng hợp, thống kê điểm DNA và hiệu năng prompt.</p>
            </div>
          </section>

          <section className={`stories-stack ${sideSection === "analysis" ? "" : "pane-hidden"}`}>
            {sideSection === "analysis" ? <AnalysisView /> : null}
          </section>

          <section className={`stories-stack ${sideSection === "models" ? "" : "pane-hidden"}`}>
            {sideSection === "models" ? (
              <ModelRegistryView models={models} onAddModel={addModel} onDeleteModels={deleteModelsByIds} onTestModels={testModelsByIds} isTesting={isTestingModel} />
            ) : null}
          </section>

          <section className={`stories-stack ${sideSection === "settings" ? "" : "pane-hidden"}`}>
            {sideSection === "settings" ? (
              <SettingsView
                settings={settings}
                theme={theme}
                apiHealth={apiHealth}
                onChangeSettings={handleChangeSettings}
                onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                onResetData={handleResetSavedData}
              />
            ) : null}
          </section>
        </section>
      </section>
      {isBooting ? (
        <div className="app-boot-overlay" role="status" aria-live="polite" aria-label="Đang khởi động ứng dụng">
          <div className="app-boot-card">
            <div className="app-boot-logo-wrap">
              <img className="app-boot-logo" src={appLogo} alt="AutoRun" loading="eager" />
            </div>
            <h2>AutoRun</h2>
            <p>Đang khởi động hệ thống và đồng bộ giao diện...</p>
            <div className="app-boot-progress">
              <span />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
