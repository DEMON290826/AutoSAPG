import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { Database, FilePlus2, FileText, Filter, FolderOpen, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import {
  addressesIndex,
  computeCategoryStats,
  getSortedCategoryKeys,
  loadCategoryEntries,
  matchesEntryQuery,
  normalizeText,
  resolveCategoryKey,
  searchEntries,
} from "../dna/libraryService";
import type { DnaEntry, DnaStatus } from "../dna/types";
import { loadDnaBundleFromSourceFile } from "../utils/dnaBundleView";
import { readJsonStorage, writeJsonStorage } from "../utils/localState";
import { openPathInExplorer, resolveDnaDirectoryFromSourceFile } from "../utils/openPath";

type SortMode = "score" | "newest" | "title";
type StatusFilter = "all" | DnaStatus;

type Props = {
  manualEntries: DnaEntry[];
  setManualEntries: (entries: DnaEntry[] | ((prev: DnaEntry[]) => DnaEntry[])) => void;
  dnaStoragePath: string;
};

type PersistedManagerState = {
  activeCategory: string;
  query: string;
  sortMode: SortMode;
  statusFilter: StatusFilter;
  rowDisplay: "all" | "50" | "100" | "200";
  selectedEntryId: string;
  hiddenEntryIds: string[];
};

const ALL_CATEGORY_KEY = "__all__";
const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });

const categoryDisplayName: Record<string, string> = {
  truyen_ma: "Truyện Ma",
  nosleep: "NoSleep",
  creepypasta: "Creepypasta",
  kinh_di_tam_ly: "Kinh Dị Tâm Lý",
};

const scopeLabel: Record<"category" | "related" | "global", string> = {
  category: "Theo danh mục",
  related: "Danh mục liên quan",
  global: "Toàn bộ thư viện",
};

const statusFilterOptions = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "ready", label: "Sẵn sàng" },
  { value: "processing", label: "Đang nạp" },
  { value: "archived", label: "Lưu trữ" },
];

const sortModeOptions = [
  { value: "score", label: "Điểm cao nhất" },
  { value: "newest", label: "Mới nhất" },
  { value: "title", label: "Theo bảng chữ cái" },
];

const rowDisplayOptions = [
  { value: "all", label: "Tất cả dòng" },
  { value: "50", label: "50 dòng" },
  { value: "100", label: "100 dòng" },
  { value: "200", label: "200 dòng" },
];

const sourceTypeOptions = [
  { value: "TEXT/PDF", label: "TEXT/PDF" },
  { value: "WEB SCRAPING", label: "WEB SCRAPING" },
  { value: "STRUCTURED", label: "STRUCTURED" },
  { value: "AUDIO", label: "AUDIO" },
];

function statusLabel(status: DnaStatus): string {
  if (status === "ready") return "Sẵn sàng";
  if (status === "processing") return "Đang nạp";
  return "Lưu trữ";
}

function formatDate(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatGb(value: number): string {
  return `${value.toFixed(2)} GB`;
}

function buildPreview(entry: DnaEntry): string {
  const style = entry.styles.slice(0, 2).join(", ");
  const tag = entry.tags.slice(0, 3).join(", ");
  return `${entry.title} pha trộn ${style}. DNA phù hợp bối cảnh ${entry.sub_category}, tag nổi bật: ${tag}.`;
}

function toDisplayCategoryName(key: string): string {
  if (key === ALL_CATEGORY_KEY) return "Tất cả";
  if (categoryDisplayName[key]) return categoryDisplayName[key];
  const fromAddress = addressesIndex.categories[key]?.display_name;
  if (fromAddress) return fromAddress;
  return key
    .split("_")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function getEntryUniqueId(entry: DnaEntry): string {
  return `${entry.category}::${entry.dna_id}::${entry.source_file}`;
}

function useAnimatedNumber(target: number, durationMs = 420): number {
  const [value, setValue] = useState(target);

  useEffect(() => {
    const from = value;
    const to = target;
    if (from === to) return;

    const start = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (to - from) * eased);
      if (progress < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return value;
}

export function DnaManagementView({ manualEntries, setManualEntries, dnaStoragePath }: Props) {
  const defaultCategory = getSortedCategoryKeys()[0] ?? "truyen_ma";
  const persisted = readJsonStorage<PersistedManagerState | null>("manager.state", null);

  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY_KEY);
  const [query, setQuery] = useState(persisted?.query || "");
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const value = persisted?.sortMode;
    return value === "score" || value === "newest" || value === "title" ? value : "score";
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const value = persisted?.statusFilter;
    return value === "all" || value === "ready" || value === "processing" || value === "archived" ? value : "all";
  });
  const [searchEntriesRaw, setSearchEntriesRaw] = useState<DnaEntry[]>([]);
  const [displayEntries, setDisplayEntries] = useState<DnaEntry[]>([]);
  const [categoriesVisited, setCategoriesVisited] = useState<string[]>([defaultCategory]);
  const [searchScope, setSearchScope] = useState<"category" | "related" | "global">("category");
  const [selectedEntryId, setSelectedEntryId] = useState(persisted?.selectedEntryId || "");
  const [hiddenEntryIds, setHiddenEntryIds] = useState<string[]>(() => (Array.isArray(persisted?.hiddenEntryIds) ? persisted.hiddenEntryIds : []));
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [rowDisplay, setRowDisplay] = useState<"all" | "50" | "100" | "200">(() => {
    const value = persisted?.rowDisplay;
    return value === "all" || value === "50" || value === "100" || value === "200" ? value : "all";
  });
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSubCategory, setDraftSubCategory] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftType, setDraftType] = useState<DnaEntry["source_type"]>("TEXT/PDF");
  const [openDnaViewer, setOpenDnaViewer] = useState(false);
  const [dnaViewerContent, setDnaViewerContent] = useState("");
  const [dnaViewerError, setDnaViewerError] = useState("");

  const isAllCategory = activeCategory === ALL_CATEGORY_KEY;
  const effectiveCategory = isAllCategory ? defaultCategory : activeCategory;
  const categoryAddress = addressesIndex.categories[effectiveCategory];
  const draftSubCategoryOptions = useMemo(
    () => (categoryAddress?.sub_categories ?? ["general"]).map((sub) => ({ value: sub, label: sub })),
    [categoryAddress?.sub_categories],
  );
  const hiddenEntrySet = useMemo(() => new Set(hiddenEntryIds), [hiddenEntryIds]);
  const manualIdSet = useMemo(() => new Set(manualEntries.map((entry) => getEntryUniqueId(entry))), [manualEntries]);
  const isEntryHidden = (entry: DnaEntry) => hiddenEntrySet.has(getEntryUniqueId(entry));

  const realCategoryKeys = useMemo(() => {
    const fromIndex = getSortedCategoryKeys();
    const fromManual = manualEntries.map((entry) => entry.category);
    return Array.from(new Set([...fromIndex, ...fromManual, effectiveCategory]))
      .filter((key) => key !== ALL_CATEGORY_KEY)
      .sort((left, right) =>
      collator.compare(toDisplayCategoryName(left), toDisplayCategoryName(right)),
    );
  }, [manualEntries, effectiveCategory]);

  const categoryKeys = useMemo(() => [ALL_CATEGORY_KEY, ...realCategoryKeys], [realCategoryKeys]);

  const allLibraryEntries = useMemo(() => {
    const merged = new Map<string, DnaEntry>();
    realCategoryKeys.forEach((categoryKey) => {
      loadCategoryEntries(categoryKey).forEach((entry) => {
        const entryId = getEntryUniqueId(entry);
        if (!merged.has(entryId)) merged.set(entryId, entry);
      });
    });
    return Array.from(merged.values()).filter((entry) => !isEntryHidden(entry));
  }, [realCategoryKeys, hiddenEntrySet]);

  const allEntriesMerged = useMemo(() => {
    const merged = new Map<string, DnaEntry>();
    [...allLibraryEntries, ...manualEntries].forEach((entry) => {
      const entryId = getEntryUniqueId(entry);
      if (!merged.has(entryId)) merged.set(entryId, entry);
    });
    return Array.from(merged.values()).filter((entry) => !isEntryHidden(entry));
  }, [allLibraryEntries, manualEntries, hiddenEntrySet]);

  const categoryEntries = isAllCategory
    ? allEntriesMerged
    : [...loadCategoryEntries(activeCategory), ...manualEntries.filter((entry) => entry.category === activeCategory)].filter(
        (entry) => !isEntryHidden(entry),
      );
  const stats = isAllCategory
    ? {
        total: categoryEntries.length,
        active: categoryEntries.filter((entry) => entry.status === "ready").length,
        storageUsedGb: categoryEntries.reduce((sum, entry) => sum + entry.size_mb / 1024, 0),
        storageLimitGb: Math.max(6, Math.ceil(categoryEntries.length / 2)) + 2,
      }
    : computeCategoryStats(activeCategory, categoryEntries);
  const storagePercent = stats.storageLimitGb === 0 ? 0 : Math.min(100, Math.round((stats.storageUsedGb / stats.storageLimitGb) * 100));
  const healthyFileCount = categoryEntries.filter((entry) => {
    const hasPath = entry.source_file.trim().length > 0;
    const hasSize = Number.isFinite(entry.size_mb) && entry.size_mb > 0;
    return entry.status === "ready" && hasPath && hasSize;
  }).length;
  const brokenFileCount = Math.max(0, stats.total - healthyFileCount);
  const fileHealthPercent = stats.total === 0 ? 0 : Math.round((healthyFileCount / stats.total) * 100);
  const healthRingStyle = { "--ring-percent": fileHealthPercent } as CSSProperties;
  const animatedTotal = useAnimatedNumber(stats.total);
  const animatedHealthyCount = useAnimatedNumber(healthyFileCount);
  const animatedFileHealth = useAnimatedNumber(fileHealthPercent);
  const animatedStorageUsed = useAnimatedNumber(stats.storageUsedGb, 520);

  useEffect(() => {
    if (!categoryAddress?.sub_categories?.length) return;
    setDraftSubCategory(categoryAddress.sub_categories[0]);
  }, [categoryAddress?.sub_categories, activeCategory]);

  useEffect(() => {
    if (!query.trim()) {
      if (isAllCategory) {
        const visited = realCategoryKeys.length ? realCategoryKeys : [defaultCategory];
        setCategoriesVisited(visited);
        setSearchScope("global");
        setSearchEntriesRaw(allLibraryEntries);
      } else {
        setCategoriesVisited([activeCategory]);
        setSearchScope("category");
        setSearchEntriesRaw(loadCategoryEntries(activeCategory).filter((entry) => !isEntryHidden(entry)));
      }
      return;
    }

    if (isAllCategory) {
      const normalizedQuery = normalizeText(query);
      const visited = realCategoryKeys.length ? realCategoryKeys : [defaultCategory];
      setCategoriesVisited(visited);
      setSearchScope("global");
      setSearchEntriesRaw(allLibraryEntries.filter((entry) => matchesEntryQuery(entry, normalizedQuery)));
      return;
    }

    const resolvedCategory = resolveCategoryKey(query) ?? activeCategory;
    const result = searchEntries(resolvedCategory, query);
    setCategoriesVisited(result.categoriesVisited.length ? result.categoriesVisited : [activeCategory]);
    setSearchScope(result.scope);
    setSearchEntriesRaw(result.entries.filter((entry) => !isEntryHidden(entry)));
  }, [activeCategory, query, isAllCategory, realCategoryKeys, defaultCategory, allLibraryEntries, hiddenEntrySet]);

  useEffect(() => {
    const normalizedQuery = normalizeText(query);
    const manualPool = manualEntries.filter((entry) => {
      if (!query.trim()) return isAllCategory || entry.category === activeCategory;
      const inScope = isAllCategory || categoriesVisited.includes(entry.category) || entry.category === activeCategory;
      if (!inScope) return false;
      return matchesEntryQuery(entry, normalizedQuery);
    }).filter((entry) => !isEntryHidden(entry));

    const merged = new Map<string, DnaEntry>();
    [...searchEntriesRaw, ...manualPool].forEach((entry) => {
      const entryId = getEntryUniqueId(entry);
      if (!merged.has(entryId)) merged.set(entryId, entry);
    });

    let rows = Array.from(merged.values());
    rows = rows.filter((entry) => !isEntryHidden(entry));
    if (statusFilter !== "all") rows = rows.filter((entry) => entry.status === statusFilter);
    rows.sort((left, right) => {
      if (sortMode === "score") return right.scores.overall - left.scores.overall;
      if (sortMode === "newest") return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      return collator.compare(left.title, right.title);
    });
    setDisplayEntries(rows);
  }, [categoriesVisited, query, activeCategory, manualEntries, searchEntriesRaw, sortMode, statusFilter, isAllCategory, hiddenEntrySet]);

  useEffect(() => {
    writeJsonStorage<PersistedManagerState>("manager.state", {
      activeCategory,
      query,
      sortMode,
      statusFilter,
      rowDisplay,
      selectedEntryId,
      hiddenEntryIds,
    });
  }, [activeCategory, query, sortMode, statusFilter, rowDisplay, selectedEntryId, hiddenEntryIds]);

  useEffect(() => {
    if (displayEntries.length === 0) {
      setSelectedEntryId("");
      return;
    }
    if (!displayEntries.some((entry) => getEntryUniqueId(entry) === selectedEntryId)) {
      setSelectedEntryId(getEntryUniqueId(displayEntries[0]));
    }
  }, [displayEntries, selectedEntryId]);

  useEffect(() => {
    const availableIds = new Set(displayEntries.map((entry) => getEntryUniqueId(entry)));
    setSelectedRowIds((prev) => prev.filter((id) => availableIds.has(id)));
  }, [displayEntries]);

  const visibleLimit = rowDisplay === "all" ? Number.POSITIVE_INFINITY : Number(rowDisplay);
  const visibleEntries = displayEntries.slice(0, visibleLimit);
  const selectedEntry = displayEntries.find((entry) => getEntryUniqueId(entry) === selectedEntryId) ?? visibleEntries[0] ?? null;
  const visitedCategoryLabels = isAllCategory ? "Tất cả danh mục" : categoriesVisited.map((key) => toDisplayCategoryName(key)).join(", ");
  const pageRowIds = visibleEntries.map((entry) => getEntryUniqueId(entry));
  const selectedOnPageCount = pageRowIds.filter((id) => selectedRowIds.includes(id)).length;
  const allPageSelected = pageRowIds.length > 0 && selectedOnPageCount === pageRowIds.length;
  const hasSelection = selectedRowIds.length > 0;

  const toggleRowSelection = (entryId: string) => {
    setSelectedRowIds((prev) => (prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId]));
  };

  const toggleSelectPageRows = () => {
    if (!pageRowIds.length) return;
    setSelectedRowIds((prev) => {
      const rowSet = new Set(prev);
      if (allPageSelected) {
        pageRowIds.forEach((id) => rowSet.delete(id));
      } else {
        pageRowIds.forEach((id) => rowSet.add(id));
      }
      return Array.from(rowSet);
    });
  };

  const removeByIds = (ids: string[]) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
    setManualEntries((prev) => prev.filter((entry) => !idSet.has(getEntryUniqueId(entry))));
    const nonManualIds = ids.filter((id) => !manualIdSet.has(id));
    if (nonManualIds.length) {
      setHiddenEntryIds((prev) => Array.from(new Set([...prev, ...nonManualIds])));
    }
    setSelectedRowIds((prev) => prev.filter((id) => !idSet.has(id)));
    if (selectedEntryId && idSet.has(selectedEntryId)) setSelectedEntryId("");
  };

  const removeSelectedRows = () => {
    if (!selectedRowIds.length) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Xóa ${selectedRowIds.length} nguồn DNA đã chọn khỏi danh sách?`);
      if (!confirmed) return;
    }
    removeByIds(selectedRowIds);
  };

  const removeAllVisibleRows = () => {
    if (!displayEntries.length) return;
    const visibleIds = displayEntries.map((entry) => getEntryUniqueId(entry));
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Xóa toàn bộ ${visibleIds.length} nguồn DNA đang hiển thị?`);
      if (!confirmed) return;
    }
    removeByIds(visibleIds);
  };

  const saveNewDnaSource = () => {
    const cleanTitle = draftTitle.trim();
    if (!cleanTitle) return;

    const targetCategory = isAllCategory ? defaultCategory : activeCategory;
    const fallbackSubCategory = addressesIndex.categories[targetCategory]?.sub_categories?.[0] ?? "general";
    const finalSubCategory = draftSubCategory || fallbackSubCategory;

    const generatedId = `dna_custom_${Date.now()}`;
    const tags = draftTags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const newEntry: DnaEntry = {
      dna_id: generatedId,
      category: targetCategory,
      title: cleanTitle,
      source_file: `../objects/${targetCategory}/${finalSubCategory}/${generatedId}/dna.json`,
      sub_category: finalSubCategory,
      styles: tags.slice(0, 2),
      tags: tags.length ? tags : ["new", "custom"],
      status: "processing",
      source_type: draftType,
      size_mb: Number((4 + Math.random() * 7).toFixed(1)),
      scores: { overall: 7.2, fear_factor: 7.0, twist_power: 7.3, cinematic_quality: 7.4, reusability: 7.1 },
      created_at: new Date().toISOString(),
      match_bonus: { genre_match: 30, style_match: 20 },
    };

    setManualEntries((prev) => [newEntry, ...prev]);
    setOpenCreateModal(false);
    setSelectedEntryId(getEntryUniqueId(newEntry));
  };

  const openSelectedDnaPath = async () => {
    if (!selectedEntry) return;
    const dnaDirectory = resolveDnaDirectoryFromSourceFile(selectedEntry.source_file, dnaStoragePath);
    if (!dnaDirectory) {
      if (typeof window !== "undefined") window.alert("Không có đường dẫn DNA để mở.");
      return;
    }

    try {
      await openPathInExplorer(dnaDirectory);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể mở đường dẫn DNA.";
      if (typeof window !== "undefined") window.alert(message);
    }
  };

  const viewSelectedDnaBundle = () => {
    if (!selectedEntry) return;

    try {
      const bundle = loadDnaBundleFromSourceFile(selectedEntry.source_file, dnaStoragePath);
      const combined = bundle.files
        .map((file) => `=== ${file.filename} ===\nPath: ${file.absolutePath}\n\n${file.content}`)
        .join("\n\n");

      setDnaViewerContent(combined);
      setDnaViewerError("");
      setOpenDnaViewer(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể đọc toàn bộ DNA.";
      setDnaViewerContent("");
      setDnaViewerError(message);
      setOpenDnaViewer(true);
    }
  };

  return (
    <div className="dna-layout">
      <section className="dna-main">
        <div className="section-head">
          <div>
            <p className="breadcrumb">Dữ liệu &gt; Danh sách nguồn</p>
            <h1>Quản lý Nguồn DNA</h1>
          </div>
          <div className="dna-head-actions">
            <label className="search-box">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm kiếm nguồn DNA, tag, style..." />
            </label>
            <button type="button" className="primary-btn" onClick={() => setOpenCreateModal(true)}>
              <Plus size={15} />
              Thêm nguồn DNA
            </button>
          </div>
        </div>

        <div className="category-tabs">
          {categoryKeys.map((categoryKey) => {
            const count =
              categoryKey === ALL_CATEGORY_KEY
                ? allEntriesMerged.length
                : loadCategoryEntries(categoryKey).filter((entry) => !isEntryHidden(entry)).length +
                  manualEntries.filter((entry) => entry.category === categoryKey && !isEntryHidden(entry)).length;
            return (
              <button
                key={categoryKey}
                type="button"
                className={`category-btn ${activeCategory === categoryKey ? "active" : ""}`}
                onClick={() => setActiveCategory(categoryKey)}
              >
                {toDisplayCategoryName(categoryKey)}
                <span>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="scope-hint">
          Phạm vi tìm kiếm: <strong>{scopeLabel[searchScope]}</strong> | Danh mục: {visitedCategoryLabels}
        </div>

        <div className="kpi-grid">
          <article className="kpi-card">
            <p>Số truyện</p>
            <h3>{Math.round(animatedTotal)}</h3>
          </article>
          <article className="kpi-card">
            <p>Tệp ổn định</p>
            <div className="kpi-health">
              <div className="kpi-health-copy">
                <h3>
                  {Math.round(animatedHealthyCount)} <span>{Math.round(animatedFileHealth)}%</span>
                </h3>
                <small>{brokenFileCount === 0 ? "100% tệp đọc tốt" : `Lỗi ${brokenFileCount}/${stats.total} tệp`}</small>
              </div>
              <div className={`kpi-ring ${brokenFileCount === 0 ? "ok" : "warning"} ${fileHealthPercent === 100 ? "full" : ""}`} style={healthRingStyle}>
                <span>{fileHealthPercent}%</span>
              </div>
            </div>
          </article>
          <article className="kpi-card">
            <p>Dung lượng chiếm</p>
            <h3>{formatGb(animatedStorageUsed)}</h3>
            <div className="progress-track">
              <span className="progress-value" style={{ width: `${storagePercent}%` }} />
            </div>
            <small>
              {storagePercent}% / {formatGb(stats.storageLimitGb)}
            </small>
          </article>
        </div>

        <section className="table-card">
          <header className="table-head">
            <h2>Danh sách chi tiết</h2>
            <div className="table-filters">
              <button type="button" className="ghost-btn compact" disabled={!hasSelection} onClick={removeSelectedRows}>
                <Trash2 size={14} />
                Xóa đã chọn
              </button>
              <button type="button" className="ghost-btn compact" disabled={!displayEntries.length} onClick={removeAllVisibleRows}>
                <Trash2 size={14} />
                Xóa tất cả
              </button>
              <div className="select-wrap custom-select-wrap">
                <Filter size={14} />
                <CustomSelect
                  value={statusFilter}
                  options={statusFilterOptions}
                  onChange={(next) => setStatusFilter(next as StatusFilter)}
                  placeholder="Tất cả trạng thái"
                  className="settings-custom-select"
                />
              </div>
              <div className="select-wrap custom-select-wrap">
                <SlidersHorizontal size={14} />
                <CustomSelect
                  value={sortMode}
                  options={sortModeOptions}
                  onChange={(next) => setSortMode(next as SortMode)}
                  placeholder="Điểm cao nhất"
                  className="settings-custom-select"
                />
              </div>
            </div>
          </header>

          <div className="table-head-row">
            <label className="check-cell" onClick={(event) => event.stopPropagation()}>
              <input type="checkbox" checked={allPageSelected} onChange={toggleSelectPageRows} aria-label="Chọn tất cả dòng đang hiển thị" />
            </label>
            <span>Tên nguồn</span>
            <span>Loại dữ liệu</span>
            <span>Trạng thái</span>
            <span>Ngày tạo</span>
            <span>Điểm</span>
          </div>

          <div className="table-body">
            {visibleEntries.length === 0 ? (
              <div className="empty-state">
                <Database size={22} />
                <p>Không tìm thấy DNA phù hợp.</p>
              </div>
            ) : (
              visibleEntries.map((entry) => (
                <button
                  key={getEntryUniqueId(entry)}
                  type="button"
                  className={`data-row ${selectedEntry && getEntryUniqueId(selectedEntry) === getEntryUniqueId(entry) ? "active" : ""}`}
                  onClick={() => setSelectedEntryId(getEntryUniqueId(entry))}
                >
                  <label className="check-cell" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedRowIds.includes(getEntryUniqueId(entry))}
                      onChange={() => toggleRowSelection(getEntryUniqueId(entry))}
                      aria-label={`Chọn ${entry.title}`}
                    />
                  </label>
                  <div className="cell-main">
                    <strong>{entry.title}</strong>
                    <small>{entry.sub_category}</small>
                  </div>
                  <span className="chip">{entry.source_type}</span>
                  <span className={`status ${entry.status}`}>{statusLabel(entry.status)}</span>
                  <span>{formatDate(entry.created_at)}</span>
                  <span className="score">{entry.scores.overall.toFixed(1)}</span>
                </button>
              ))
            )}
          </div>

          <footer className="table-footer">
            <p>
              Hiển thị {visibleEntries.length} / {displayEntries.length} nguồn
            </p>
            <div className="select-wrap custom-select-wrap">
              <SlidersHorizontal size={14} />
              <CustomSelect
                value={rowDisplay}
                options={rowDisplayOptions}
                onChange={(next) => setRowDisplay(next as "all" | "50" | "100" | "200")}
                placeholder="Tất cả dòng"
                className="settings-custom-select"
              />
            </div>
          </footer>
        </section>
      </section>

      <aside className="detail-panel">
        {selectedEntry ? (
          <>
            <header className="detail-head">
              <h3>Chi tiết DNA</h3>
              <button type="button" className="icon-square" onClick={() => setSelectedEntryId("")}>
                <X size={14} />
              </button>
            </header>
            <article className="dna-card">
              <p className="dna-id">{selectedEntry.dna_id}</p>
              <h4>{selectedEntry.title}</h4>
              <p>{selectedEntry.source_file}</p>
            </article>
            <section className="detail-box">
              <h5>Thông tin nguồn</h5>
              <div className="detail-grid">
                <span>Chủ đề</span>
                <strong>{selectedEntry.sub_category}</strong>
                <span>Giọng văn</span>
                <strong>{selectedEntry.styles.join(", ") || "Tùy chỉnh"}</strong>
                <span>Dung lượng</span>
                <strong>{selectedEntry.size_mb.toFixed(1)} MB</strong>
              </div>
            </section>
            <section className="detail-box">
              <h5>Thẻ phân loại</h5>
              <div className="tag-wrap">
                {selectedEntry.tags.map((tag) => (
                  <span key={tag} className="tag-pill">
                    {tag}
                  </span>
                ))}
              </div>
            </section>
            <section className="detail-box preview-box">
              <h5>Xem trước nội dung</h5>
              <div className="preview-scroll">
                <p className="preview-text">{buildPreview(selectedEntry)}</p>
              </div>
            </section>
            <div className="detail-actions">
              <button type="button" className="ghost-btn full" onClick={openSelectedDnaPath}>
                <FolderOpen size={15} />
                Mở đường dẫn DNA
              </button>
              <button type="button" className="ghost-btn full" onClick={viewSelectedDnaBundle}>
                <FileText size={15} />
                Xem toàn bộ DNA
              </button>
              <button type="button" className="primary-btn full">
                <FilePlus2 size={15} />
                Chỉnh sửa DNA
              </button>
            </div>
          </>
        ) : (
          <div className="empty-detail">
            <Database size={28} />
            <p>Chọn một DNA để xem chi tiết.</p>
          </div>
        )}
      </aside>

      {openDnaViewer ? (
        <div className="modal-backdrop" onClick={() => setOpenDnaViewer(false)}>
          <div className="modal-card dna-viewer-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>Toàn bộ DNA</h3>
              <button type="button" className="icon-square" onClick={() => setOpenDnaViewer(false)}>
                <X size={14} />
              </button>
            </header>
            {dnaViewerError ? <div className="story-error-box">{dnaViewerError}</div> : null}
            {!dnaViewerError ? (
              <div className="dna-viewer-scroll">
                <pre className="dna-json-pre">{dnaViewerContent}</pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {openCreateModal ? (
        <div className="modal-backdrop" onClick={() => setOpenCreateModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>Thêm nguồn DNA mới</h3>
              <button type="button" className="icon-square" onClick={() => setOpenCreateModal(false)}>
                <X size={14} />
              </button>
            </header>
            <label>
              Tên nguồn
              <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Ví dụ: Bản thảo lời nguyền hành lang cũ" />
            </label>
            <label>
              Danh mục con
              <CustomSelect
                value={draftSubCategory}
                options={draftSubCategoryOptions}
                onChange={setDraftSubCategory}
                placeholder="Chọn danh mục con"
                className="settings-custom-select"
              />
            </label>
            <label>
              Loại dữ liệu
              <CustomSelect
                value={draftType}
                options={sourceTypeOptions}
                onChange={(next) => setDraftType(next as DnaEntry["source_type"])}
                placeholder="Chọn loại dữ liệu"
                className="settings-custom-select"
              />
            </label>
            <label>
              Tags (phân tách bằng dấu phẩy)
              <input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} placeholder="twist mạnh, đô thị, nhịp chậm" />
            </label>
            <footer>
              <button type="button" className="ghost-btn" onClick={() => setOpenCreateModal(false)}>
                Hủy
              </button>
              <button type="button" className="primary-btn" onClick={saveNewDnaSource}>
                <Plus size={15} />
                Tạo DNA
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
