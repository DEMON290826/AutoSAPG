declare global {
  interface Window {
    require?: (name: string) => unknown;
  }
}

type PathRuntime = {
  path: {
    join: (...parts: string[]) => string;
    dirname: (path: string) => string;
    isAbsolute: (path: string) => boolean;
  };
  os: {
    homedir: () => string;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
  };
};

function getPathRuntime(): PathRuntime | null {
  if (typeof window === "undefined" || typeof window.require !== "function") {
    return null;
  }

  const path = window.require("path");
  const os = window.require("os");
  const electron = window.require("electron") as { shell?: { openPath: (path: string) => Promise<string> } } | null;
  const shell = electron?.shell;

  if (!path || !os || !shell) {
    return null;
  }

  return {
    path: path as PathRuntime["path"],
    os: os as PathRuntime["os"],
    shell,
  };
}

export function canOpenLocalPath(): boolean {
  return getPathRuntime() !== null;
}

export function resolveDnaDirectoryFromSourceFile(sourceFile: string): string | null {
  const runtime = getPathRuntime();
  if (!runtime) return null;
  if (!sourceFile.trim()) return null;

  const indexDir = runtime.path.join(runtime.os.homedir(), "Documents", "DNA_Library", "dna_index");
  const absoluteSource = runtime.path.isAbsolute(sourceFile) ? sourceFile : runtime.path.join(indexDir, sourceFile);
  return runtime.path.dirname(absoluteSource);
}

export async function openPathInExplorer(targetPath: string): Promise<void> {
  const runtime = getPathRuntime();
  if (!runtime) {
    throw new Error("Chỉ hỗ trợ mở đường dẫn khi chạy bằng Electron.");
  }
  if (!targetPath.trim()) {
    throw new Error("Không có đường dẫn để mở.");
  }

  const result = await runtime.shell.openPath(targetPath);
  if (result) {
    throw new Error(result);
  }
}
