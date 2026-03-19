type NodeRuntime = {
  fs: {
    existsSync: (path: string) => boolean;
    readFileSync: (path: string, encoding: string) => string;
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

export type DnaBundleFile = {
  key: "dna_core" | "critique_improvement" | "story_summary" | "improved_outline_50";
  filename: string;
  absolutePath: string;
  exists: boolean;
  content: string;
};

export type DnaBundleView = {
  dnaDirectory: string;
  files: DnaBundleFile[];
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

function normalizeJsonText(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function readBundleByDirectory(runtime: NodeRuntime, dnaDirectory: string): DnaBundleView {
  const fileMeta: Array<{ key: DnaBundleFile["key"]; filename: string }> = [
    { key: "dna_core", filename: "dna_core.json" },
    { key: "critique_improvement", filename: "critique_improvement.json" },
    { key: "story_summary", filename: "story_summary.json" },
    { key: "improved_outline_50", filename: "improved_outline_50.json" },
  ];

  const files = fileMeta.map(({ key, filename }) => {
    const absolutePath = runtime.path.join(dnaDirectory, filename);
    const exists = runtime.fs.existsSync(absolutePath);
    if (!exists) {
      return {
        key,
        filename,
        absolutePath,
        exists: false,
        content: "File khong ton tai.",
      } satisfies DnaBundleFile;
    }

    const raw = runtime.fs.readFileSync(absolutePath, "utf8");
    return {
      key,
      filename,
      absolutePath,
      exists: true,
      content: normalizeJsonText(raw),
    } satisfies DnaBundleFile;
  });

  return { dnaDirectory, files };
}

export function loadDnaBundleFromDirectory(dnaDirectory: string): DnaBundleView {
  const runtime = getRuntime();
  if (!runtime) {
    throw new Error("Chi ho tro xem DNA khi chay bang Electron.");
  }
  if (!dnaDirectory.trim()) {
    throw new Error("Khong co duong dan DNA de doc.");
  }

  return readBundleByDirectory(runtime, dnaDirectory);
}

export function loadDnaBundleFromSourceFile(sourceFile: string): DnaBundleView {
  const runtime = getRuntime();
  if (!runtime) {
    throw new Error("Chi ho tro xem DNA khi chay bang Electron.");
  }
  if (!sourceFile.trim()) {
    throw new Error("Khong co source_file de doc DNA.");
  }

  const indexDir = runtime.path.join(runtime.os.homedir(), "Documents", "DNA_Library", "dna_index");
  const absoluteSource = runtime.path.isAbsolute(sourceFile) ? sourceFile : runtime.path.join(indexDir, sourceFile);
  const dnaDirectory = runtime.path.dirname(absoluteSource);

  return readBundleByDirectory(runtime, dnaDirectory);
}
