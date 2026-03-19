export type DnaStatus = "ready" | "processing" | "archived";

export type DnaScore = {
  overall: number;
  fear_factor: number;
  twist_power: number;
  cinematic_quality: number;
  reusability: number;
};

export type MatchBonus = {
  genre_match: number;
  style_match: number;
};

export type DnaEntry = {
  dna_id: string;
  category: string;
  title: string;
  source_file: string;
  sub_category: string;
  styles: string[];
  tags: string[];
  status: DnaStatus;
  source_type: "TEXT/PDF" | "WEB SCRAPING" | "STRUCTURED" | "AUDIO";
  size_mb: number;
  scores: DnaScore;
  created_at: string;
  match_bonus: MatchBonus;
};

export type CategoryAddress = {
  filename: string;
  display_name: string;
  sub_categories: string[];
  related: string[];
  entry_count: number;
  priority: number;
};

export type AddressesIndex = {
  version: string;
  last_updated: string;
  categories: Record<string, CategoryAddress>;
  search_aliases: Record<string, string>;
};

export type CategoryFile = {
  category: string;
  version: string;
  last_updated: string;
  entries: DnaEntry[];
  sub_category_order: string[];
};
