import type { AddressesIndex, CategoryFile } from "./types";

export const addressesIndex: AddressesIndex = {
  version: "1.2.0",
  last_updated: "2026-03-16T00:00:00+07:00",
  categories: {
    truyen_ma: {
      filename: "truyen_ma.json",
      display_name: "Truyện Ma",
      sub_categories: ["dan_gian", "lang_que", "ma_quy", "hien_dai"],
      related: ["nosleep", "kinh_di_tam_ly"],
      entry_count: 0,
      priority: 10,
    },
    nosleep: {
      filename: "nosleep.json",
      display_name: "NoSleep",
      sub_categories: ["quy_tac", "linh_di", "am_anh", "tam_ly"],
      related: ["truyen_ma", "creepypasta"],
      entry_count: 0,
      priority: 8,
    },
    creepypasta: {
      filename: "creepypasta.json",
      display_name: "Creepypasta",
      sub_categories: ["internet", "urban", "dark_web"],
      related: ["nosleep"],
      entry_count: 0,
      priority: 7,
    },
    kinh_di_tam_ly: {
      filename: "kinh_di_tam_ly.json",
      display_name: "Kinh Dị Tâm Lý",
      sub_categories: ["tam_than", "hoang_tuong", "bi_an"],
      related: ["truyen_ma", "nosleep"],
      entry_count: 0,
      priority: 6,
    },
  },
  search_aliases: {
    "truyen ma": "truyen_ma",
    "no sleep": "nosleep",
    "kinh di tam ly": "kinh_di_tam_ly",
  },
};

export const categoryFiles: Record<string, CategoryFile> = {
  truyen_ma: {
    category: "truyen_ma",
    version: "1.0.0",
    last_updated: "2026-03-16T00:00:00+07:00",
    sub_category_order: ["dan_gian", "lang_que", "ma_quy", "hien_dai"],
    entries: [],
  },
  nosleep: {
    category: "nosleep",
    version: "1.0.0",
    last_updated: "2026-03-16T00:00:00+07:00",
    sub_category_order: ["quy_tac", "linh_di", "am_anh", "tam_ly"],
    entries: [],
  },
  creepypasta: {
    category: "creepypasta",
    version: "1.0.0",
    last_updated: "2026-03-16T00:00:00+07:00",
    sub_category_order: ["internet", "urban", "dark_web"],
    entries: [],
  },
  kinh_di_tam_ly: {
    category: "kinh_di_tam_ly",
    version: "1.0.0",
    last_updated: "2026-03-16T00:00:00+07:00",
    sub_category_order: ["tam_than", "hoang_tuong", "bi_an"],
    entries: [],
  },
};
