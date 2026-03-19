declare global {
  interface Window {
    require?: (name: string) => unknown;
  }
}

type IpcRendererLike = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  on: (channel: string, func: (event: any, ...args: any[]) => void) => void;
  removeAllListeners: (channel: string) => void;
};

function getIpcRenderer(): IpcRendererLike | null {
  if (typeof window === "undefined" || typeof window.require !== "function") {
    return null;
  }

  const electron = window.require("electron") as { ipcRenderer?: IpcRendererLike } | null;
  return electron?.ipcRenderer ?? null;
}

export function canUseElectronBridge(): boolean {
  return getIpcRenderer() !== null;
}

async function invokeBridge<T>(channel: string, payload?: unknown): Promise<T> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) {
    throw new Error("Tinh nang nay chi hoat dong khi chay bang Electron.");
  }
  return (await ipcRenderer.invoke(channel, payload)) as T;
}

export async function pickJsonFileDialog(): Promise<string | null> {
  return invokeBridge<string | null>("dialog:pick-json-file");
}

export async function pickDirectoryDialog(): Promise<string | null> {
  return invokeBridge<string | null>("dialog:pick-directory");
}

export type BrowserWriterSessionStartInput = {
  cookieFilePath: string;
  chatUrl?: string;
  windowIndex?: number;
};

export type BrowserWriterSessionInfo = {
  sessionId: string;
  browserName: string;
  chatUrl: string;
};

export type BrowserWriterPromptInput = {
  sessionId: string;
  prompt: string;
  newConversation?: boolean;
  timeoutMs?: number;
};

export async function startBrowserWriterSession(input: BrowserWriterSessionStartInput): Promise<BrowserWriterSessionInfo> {
  return invokeBridge<BrowserWriterSessionInfo>("story-writer:start-session", input);
}

export async function sendBrowserWriterPrompt(input: BrowserWriterPromptInput): Promise<string> {
  return invokeBridge<string>("story-writer:send-prompt", input);
}

export async function closeBrowserWriterSession(sessionId: string): Promise<void> {
  await invokeBridge<void>("story-writer:close-session", { sessionId });
}

export async function closeBrowserAllSessions(): Promise<void> {
  await invokeBridge<void>("story-writer:cleanup-all");
}

export async function getBrowserWriterSessionCount(): Promise<number> {
  return invokeBridge<number>("story-writer:count");
}

export function listenUpdateStatus(callback: (status: string) => void): () => void {
  const ipc = (window.require?.("electron") as any)?.ipcRenderer;
  if (!ipc) return () => {};
  
  const listener = (_event: any, status: string) => callback(status);
  ipc.on("update-status", listener);
  return () => {
    ipc.removeAllListeners("update-status");
  };
}

export async function triggerUpdateCheck(): Promise<void> {
  const ipc = (window.require?.("electron") as any)?.ipcRenderer;
  if (ipc) {
    await ipc.invoke("app:check-for-updates");
  } else {
    console.log("Not in electron environment");
  }
}

