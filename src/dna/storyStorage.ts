import type { StoryBlueprintResult } from "./blueprintApi";
import type { StoryCreationRequest, StoryDraftResult, StoryDnaSource } from "./storyWriterApi";
import type { StoryFactorDefinition } from "./storyFactors";

declare global {
  interface Window {
    require?: (name: string) => unknown;
  }
}

type NodeRuntime = {
  fs: {
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, data: string, encoding: string) => void;
    readdirSync: (path: string) => string[];
    statSync: (path: string) => { isDirectory: () => boolean; isFile: () => boolean; size: number };
  };
  path: {
    join: (...parts: string[]) => string;
    dirname: (path: string) => string;
    isAbsolute: (path: string) => boolean;
  };
  os: {
    homedir: () => string;
  };
};

type StoryProjectIndexRow = {
  project_id: string;
  story_title: string;
  genre: string;
  chapter_count: number;
  total_words_requested: number;
  created_at: string;
  output_dir: string;
  factors: string[];
};

type StoryProjectIndex = {
  version: string;
  last_updated: string;
  stories: StoryProjectIndexRow[];
};

export type SaveStoryProjectInput = {
  request: StoryCreationRequest;
  blueprint: StoryBlueprintResult;
  draft: StoryDraftResult;
  dnaSources: StoryDnaSource[];
  factors: StoryFactorDefinition[];
  storageDir?: string;
};

export type SaveStoryProjectResult = {
  baseDir: string;
  storyDir: string;
  files: {
    request: string;
    factors: string;
    dnaSources: string;
    blueprint: string;
    chapters: string;
    fullStory: string;
  };
};

export type StoryProjectStorageStats = {
  available: boolean;
  baseDir: string;
  storyCount: number;
  storageBytes: number;
};

function getRuntime(): NodeRuntime | null {
  if (typeof window === "undefined" || typeof window.require !== "function") {
    return null;
  }

  const fs = window.require("fs");
  const path = window.require("path");
  const os = window.require("os");
  if (!fs || !path || !os) return null;

  return {
    fs: fs as NodeRuntime["fs"],
    path: path as NodeRuntime["path"],
    os: os as NodeRuntime["os"],
  };
}

function readJsonFile<T>(runtime: NodeRuntime, filePath: string, fallback: T): T {
  if (!runtime.fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(runtime.fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(runtime: NodeRuntime, filePath: string, value: unknown): void {
  runtime.fs.mkdirSync(runtime.path.dirname(filePath), { recursive: true });
  runtime.fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function slugify(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function buildFullStoryMarkdown(title: string, chapters: StoryDraftResult["chapters"]): string {
  const lines: string[] = [`# ${title}`, ""];
  chapters.forEach((chapter) => {
    lines.push(`## ${chapter.chapter_number}. ${chapter.chapter_title}`);
    lines.push("");
    lines.push(chapter.content.trim());
    lines.push("");
  });
  return lines.join("\n");
}

function resolveStoryStorageDir(runtime: NodeRuntime, customPath: string | undefined): string {
  const raw = String(customPath ?? "").trim();
  if (!raw) return runtime.path.join(runtime.os.homedir(), "Documents", "DNA_Library", "story_projects");
  if (runtime.path.isAbsolute(raw)) return raw;
  return runtime.path.join(runtime.os.homedir(), raw);
}

function computeDirectorySizeBytes(runtime: NodeRuntime, dirPath: string): number {
  if (!runtime.fs.existsSync(dirPath)) return 0;
  let total = 0;
  let entries: string[] = [];
  try {
    entries = runtime.fs.readdirSync(dirPath);
  } catch {
    return 0;
  }

  entries.forEach((name) => {
    const childPath = runtime.path.join(dirPath, name);
    try {
      const stats = runtime.fs.statSync(childPath);
      if (stats.isDirectory()) {
        total += computeDirectorySizeBytes(runtime, childPath);
      } else if (stats.isFile()) {
        total += Math.max(0, Number(stats.size) || 0);
      }
    } catch {
      // ignore unreadable entries
    }
  });

  return total;
}

export function canSaveStoryProject(): boolean {
  return getRuntime() !== null;
}

export function getStoryProjectStorageStats(storageDir?: string): StoryProjectStorageStats {
  const runtime = getRuntime();
  if (!runtime) {
    return {
      available: false,
      baseDir: "",
      storyCount: 0,
      storageBytes: 0,
    };
  }

  const baseDir = resolveStoryStorageDir(runtime, storageDir);
  const indexPath = runtime.path.join(baseDir, "stories_index.json");
  const index = readJsonFile<StoryProjectIndex>(runtime, indexPath, {
    version: "1.0.0",
    last_updated: "",
    stories: [],
  });

  return {
    available: true,
    baseDir,
    storyCount: Array.isArray(index.stories) ? index.stories.length : 0,
    storageBytes: computeDirectorySizeBytes(runtime, baseDir),
  };
}

export function saveStoryProject(input: SaveStoryProjectInput): SaveStoryProjectResult {
  const runtime = getRuntime();
  if (!runtime) {
    throw new Error("Không có quyền truy cập filesystem cục bộ. Hãy chạy app bằng Electron.");
  }

  const createdAt = new Date().toISOString();
  const projectsDir = resolveStoryStorageDir(runtime, input.storageDir);
  const baseDir = projectsDir;
  runtime.fs.mkdirSync(projectsDir, { recursive: true });

  const projectId = `story_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
  const storySlug = slugify(input.request.story_title) || "bo_truyen";
  const storyDir = runtime.path.join(projectsDir, `${storySlug}_${projectId}`);
  runtime.fs.mkdirSync(storyDir, { recursive: true });

  const requestFile = runtime.path.join(storyDir, "story_request.json");
  const factorFile = runtime.path.join(storyDir, "factors_applied.json");
  const dnaFile = runtime.path.join(storyDir, "dna_sources.json");
  const blueprintFile = runtime.path.join(storyDir, "story_blueprint.json");
  const chaptersFile = runtime.path.join(storyDir, "story_chapters.json");
  const fullStoryFile = runtime.path.join(storyDir, "full_story.md");

  writeJsonFile(runtime, requestFile, input.request);
  writeJsonFile(
    runtime,
    factorFile,
    input.factors.map((factor) => ({
      key: factor.key,
      title: factor.title,
      description: factor.description,
      apply_rules: factor.apply_rules,
    })),
  );
  writeJsonFile(runtime, dnaFile, input.dnaSources);
  writeJsonFile(runtime, blueprintFile, input.blueprint);
  writeJsonFile(runtime, chaptersFile, input.draft);
  runtime.fs.writeFileSync(fullStoryFile, buildFullStoryMarkdown(input.request.story_title, input.draft.chapters), "utf8");

  const indexPath = runtime.path.join(projectsDir, "stories_index.json");
  const index = readJsonFile<StoryProjectIndex>(runtime, indexPath, {
    version: "1.0.0",
    last_updated: createdAt,
    stories: [],
  });

  index.stories = [
    {
      project_id: projectId,
      story_title: input.request.story_title,
      genre: input.request.genre,
      chapter_count: input.draft.chapter_count,
      total_words_requested: input.request.total_words,
      created_at: createdAt,
      output_dir: storyDir,
      factors: input.factors.map((factor) => factor.key),
    },
    ...index.stories,
  ];
  index.last_updated = createdAt;
  writeJsonFile(runtime, indexPath, index);

  return {
    baseDir,
    storyDir,
    files: {
      request: requestFile,
      factors: factorFile,
      dnaSources: dnaFile,
      blueprint: blueprintFile,
      chapters: chaptersFile,
      fullStory: fullStoryFile,
    },
  };
}

export function loadStoryProjects(storageDir?: string): StoryProjectIndexRow[] {
  const runtime = getRuntime();
  if (!runtime) return [];

  const baseDir = resolveStoryStorageDir(runtime, storageDir);
  const indexPath = runtime.path.join(baseDir, "stories_index.json");
  const index = readJsonFile<StoryProjectIndex>(runtime, indexPath, {
    version: "1.0.0",
    last_updated: "",
    stories: [],
  });

  return Array.isArray(index.stories) ? index.stories : [];
}

export function loadStoryMarkdown(storageDir: string | undefined, projectId: string): string | null {
  const runtime = getRuntime();
  if (!runtime) return null;

  const baseDir = resolveStoryStorageDir(runtime, storageDir);
  const indexPath = runtime.path.join(baseDir, "stories_index.json");
  const index = readJsonFile<StoryProjectIndex>(runtime, indexPath, { version: "1.0.0", last_updated: "", stories: [] });
  const row = index.stories?.find((s) => s.project_id === projectId);
  if (!row || !row.output_dir) return null;

  try {
    const mdPath = runtime.path.join(row.output_dir, "full_story.md");
    if (!runtime.fs.existsSync(mdPath)) return null;
    return runtime.fs.readFileSync(mdPath, "utf8");
  } catch {
    return null;
  }
}

export function deleteStoryProject(storageDir: string | undefined, projectId: string): boolean {
  const runtime = getRuntime();
  if (!runtime) return false;

  const baseDir = resolveStoryStorageDir(runtime, storageDir);
  const indexPath = runtime.path.join(baseDir, "stories_index.json");
  const index = readJsonFile<StoryProjectIndex>(runtime, indexPath, { version: "1.0.0", last_updated: "", stories: [] });
  
  const rowIdx = index.stories?.findIndex((s) => s.project_id === projectId);
  if (rowIdx === -1) return false;
  
  const row = index.stories[rowIdx];
  index.stories.splice(rowIdx, 1);
  index.last_updated = new Date().toISOString();
  writeJsonFile(runtime, indexPath, index);

  // We could delete the directory row.output_dir but maybe it's safer to just remove from index
  // or user might want to keep the files. I'll just remove from index to unpin it from Library UI.
  return true;
}
