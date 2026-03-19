export type StoryCreateMode = "tac_gia" | "tu_phan_tich";
export type StoryFileType = "txt" | "word";

export type StorySourceStatus = "dang_cho" | "dang_chay" | "xong" | "loi";

export type EvaluatedScore = {
  score: number;
  reason: string;
};

export type ScoreReport = {
  hook_strength: EvaluatedScore;
  atmosphere: EvaluatedScore;
  pacing: EvaluatedScore;
  fear_factor: EvaluatedScore;
  originality: EvaluatedScore;
  character_depth: EvaluatedScore;
  cinematic_quality: EvaluatedScore;
  twist_power: EvaluatedScore;
  memorability: EvaluatedScore;
  reusability_as_dna: EvaluatedScore;
  language_quality: EvaluatedScore;
  language_identity: EvaluatedScore;
  cinematic_identity: EvaluatedScore;
  structural_integrity: EvaluatedScore;
  emotional_impact: EvaluatedScore;
  overall_score: EvaluatedScore;
};

export type CharacterProfile = {
  name: string;
  role: string;
  personality: string;
  mission: string;
};

export type StoryAnalysisResult = {
  main_genre: string;
  related_genres: string[];
  main_style: string;
  related_styles: string[];
  tags: string[];
  context_country: string;
  character_name_plan: string;
  character_count: number;
  characters: CharacterProfile[];
  core_outline: string[];
  story_summary: string;
  critique: string[];
  improvement_guidance: string[];
  improved_outline_50: string[];
  score_report: ScoreReport;
  evaluation_commentary_md: string;
  dna_json: Record<string, unknown>;
  improvement_json: Record<string, unknown>;
  summary_md: string;
  expert_commentary_md: string;
};
