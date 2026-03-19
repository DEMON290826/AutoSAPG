import { addressesIndex, categoryFiles } from "./mockLibrary";
import type { AddressesIndex, CategoryFile, DnaEntry } from "./types";

const vietnameseCollator = new Intl.Collator("vi", {
  sensitivity: "base",
  numeric: true,
});

export type SearchScope = "category" | "related" | "global";

export type SearchResult = {
  scope: SearchScope;
  entries: DnaEntry[];
  categoriesVisited: string[];
};

export type CategoryStats = {
  total: number;
  active: number;
  storageUsedGb: number;
  storageLimitGb: number;
};

export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\u0111\u0110]/g, "d")
    .replace(/[^a-z0-9\s_:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveCategoryKey(input: string): string | null {
  const normalized = normalizeText(input);
  if (!normalized) return null;

  if (addressesIndex.categories[normalized]) {
    return normalized;
  }

  if (addressesIndex.search_aliases[normalized]) {
    return addressesIndex.search_aliases[normalized];
  }

  return null;
}

export function getSortedCategoryKeys(index: AddressesIndex = addressesIndex): string[] {
  return Object.keys(index.categories).sort((left, right) => {
    const leftInfo = index.categories[left];
    const rightInfo = index.categories[right];

    if (leftInfo.priority !== rightInfo.priority) {
      return rightInfo.priority - leftInfo.priority;
    }

    return vietnameseCollator.compare(leftInfo.display_name, rightInfo.display_name);
  });
}

function sortEntriesForCategory(file: CategoryFile, entries: DnaEntry[]): DnaEntry[] {
  const subOrder = new Map(file.sub_category_order.map((name, idx) => [name, idx]));

  return [...entries].sort((left, right) => {
    const leftSub = subOrder.get(left.sub_category) ?? Number.MAX_SAFE_INTEGER;
    const rightSub = subOrder.get(right.sub_category) ?? Number.MAX_SAFE_INTEGER;

    if (leftSub !== rightSub) return leftSub - rightSub;
    return vietnameseCollator.compare(left.title, right.title);
  });
}

function matchesEntryQuery(entry: DnaEntry, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;

  const haystack = normalizeText(
    [
      entry.title,
      entry.sub_category,
      entry.status,
      entry.source_type,
      ...entry.styles,
      ...entry.tags,
    ].join(" "),
  );

  return haystack.includes(normalizedQuery);
}

function searchInsideCategories(
  categories: string[],
  normalizedQuery: string,
): { entries: DnaEntry[]; visited: string[] } {
  const visited: string[] = [];
  const result: DnaEntry[] = [];

  categories.forEach((categoryKey) => {
    const file = categoryFiles[categoryKey];
    if (!file) return;

    visited.push(categoryKey);
    const matched = file.entries.filter((entry) => matchesEntryQuery(entry, normalizedQuery));
    result.push(...sortEntriesForCategory(file, matched));
  });

  return { entries: result, visited };
}

export function loadCategoryEntries(categoryKey: string): DnaEntry[] {
  const file = categoryFiles[categoryKey];
  if (!file) return [];
  return sortEntriesForCategory(file, file.entries);
}

export function searchEntries(categoryKey: string, query: string): SearchResult {
  const normalizedQuery = normalizeText(query);
  const category = addressesIndex.categories[categoryKey];

  if (!category) {
    const fallbackKeys = getSortedCategoryKeys();
    const global = searchInsideCategories(fallbackKeys, normalizedQuery);
    return {
      scope: "global",
      entries: global.entries,
      categoriesVisited: global.visited,
    };
  }

  const current = searchInsideCategories([categoryKey], normalizedQuery);
  if (current.entries.length > 0 || !normalizedQuery) {
    return {
      scope: "category",
      entries: current.entries,
      categoriesVisited: current.visited,
    };
  }

  const related = searchInsideCategories(category.related, normalizedQuery);
  if (related.entries.length > 0) {
    return {
      scope: "related",
      entries: related.entries,
      categoriesVisited: related.visited,
    };
  }

  const globalKeys = getSortedCategoryKeys();
  const global = searchInsideCategories(globalKeys, normalizedQuery);
  return {
    scope: "global",
    entries: global.entries,
    categoriesVisited: global.visited,
  };
}

export function computeCategoryStats(categoryKey: string, entries: DnaEntry[]): CategoryStats {
  const total = entries.length;
  const active = entries.filter((entry) => entry.status === "ready").length;
  const storageUsedGb = entries.reduce((sum, entry) => sum + entry.size_mb / 1024, 0);
  const baseLimit = Math.max(6, Math.ceil(total / 2));
  const storageLimitGb = baseLimit + (addressesIndex.categories[categoryKey]?.priority ?? 5) / 4;

  return {
    total,
    active,
    storageUsedGb,
    storageLimitGb,
  };
}

export { addressesIndex, categoryFiles, matchesEntryQuery };
