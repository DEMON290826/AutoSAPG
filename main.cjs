const electron = require("electron");
const path = require("path");
const fs = require("fs");

if (!electron || !electron.app || !electron.BrowserWindow) {
  console.error("[AutoRun] Electron runtime khong hop le. Kiem tra bien moi truong ELECTRON_RUN_AS_NODE.");
  process.exit(1);
}

const { app, BrowserWindow, dialog, ipcMain } = electron;

const DEFAULT_WINDOW_WIDTH = 1920;
const DEFAULT_WINDOW_HEIGHT = 1080;
const WINDOW_STATE_FILE = "window-state.json";
const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";
const { spawn } = require("child_process");
const NODRIVER_SESSIONS = new Map();
const WRITER_PROFILE_DIR = "writer-browser-profile";

function getPythonBridgePath() {
  const bridgeName = "nodriver_bridge.py";
  const internalPath = path.join(__dirname, bridgeName);

  if (__dirname.includes("app.asar")) {
    const extractedPath = path.join(app.getPath("userData"), bridgeName);
    try {
      if (!fs.existsSync(extractedPath) || fs.statSync(internalPath).mtimeMs > fs.statSync(extractedPath).mtimeMs || true) {
         const bridgeContent = fs.readFileSync(internalPath, "utf8");
         fs.writeFileSync(extractedPath, bridgeContent, "utf8");
      }
      return extractedPath;
    } catch (error) {
      console.error("Loi khi trich xuat nodriver_bridge.py tu asar:", error);
    }
  }

  return internalPath;
}

function makeNodriverSessionId() {
  return `nodriver_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function windowStatePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function readWindowState() {
  const fallback = {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    x: undefined,
    y: undefined,
    isMaximized: true,
    isFullScreen: false,
  };

  try {
    const filePath = windowStatePath();
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    const x = Number(parsed.x);
    const y = Number(parsed.y);

    return {
      width: Number.isFinite(width) ? Math.max(1100, width) : fallback.width,
      height: Number.isFinite(height) ? Math.max(650, height) : fallback.height,
      x: Number.isFinite(x) ? x : undefined,
      y: Number.isFinite(y) ? y : undefined,
      isMaximized: Boolean(parsed.isMaximized),
      isFullScreen: Boolean(parsed.isFullScreen),
    };
  } catch {
    return fallback;
  }
}

function writeWindowState(state) {
  try {
    const filePath = windowStatePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  } catch (error) {
    console.error("Save window state failed:", error?.message || error);
  }
}

function bindWindowStatePersistence(win) {
  let saveTimer = null;

  const saveNow = () => {
    if (win.isDestroyed()) return;
    const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    writeWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
      updatedAt: new Date().toISOString(),
    });
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 180);
  };

  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("maximize", scheduleSave);
  win.on("unmaximize", scheduleSave);
  win.on("enter-full-screen", scheduleSave);
  win.on("leave-full-screen", scheduleSave);
  win.on("close", saveNow);
}

function resolveWindowIconPath() {
  const resourceRoot = process.resourcesPath || "";
  const candidates = [
    path.join(__dirname, "build", "icons", "app-icon.png"),
    path.join(resourceRoot, "build", "icons", "app-icon.png"),
    path.join(resourceRoot, "app.asar", "build", "icons", "app-icon.png"),
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function normalizeChatUrl(raw) {
  const value = String(raw || "").trim();
  return value || DEFAULT_CHATGPT_URL;
}

function normalizeCookieEntry(cookie) {
  if (!cookie || typeof cookie !== "object") return null;
  const row = cookie;
  const name = String(row.name || "").trim();
  const value = String(row.value || "").trim();
  const domain = String(row.domain || "").trim();
  if (!name || !value || !domain) return null;

  const normalized = {
    name,
    value,
    domain,
    path: String(row.path || "/").trim() || "/",
    httpOnly: Boolean(row.httpOnly),
    secure: Boolean(row.secure),
  };

  const expires = Number(row.expires);
  if (Number.isFinite(expires) && expires > 0) {
    normalized.expires = expires;
  }

  const sameSiteRaw = String(row.sameSite || "").trim().toLowerCase();
  if (sameSiteRaw === "strict") normalized.sameSite = "Strict";
  else if (sameSiteRaw === "lax") normalized.sameSite = "Lax";
  else if (sameSiteRaw === "none") normalized.sameSite = "None";

  return normalized;
}

function loadCookieFile(cookieFilePath) {
  const rawPath = String(cookieFilePath || "").trim();
  if (!rawPath) {
    throw new Error("Chua cau hinh duong dan cookie JSON cho ChatGPT.");
  }
  if (!fs.existsSync(rawPath)) {
    throw new Error(`Khong tim thay file cookie: ${rawPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  } catch (error) {
    throw new Error(`Khong doc duoc file cookie JSON: ${error?.message || error}`);
  }

  const cookieList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : null;
  if (!cookieList) {
    throw new Error("File cookie khong dung dinh dang. Can JSON array hoac object co key cookies.");
  }

  const normalized = cookieList.map(normalizeCookieEntry).filter(Boolean);
  if (!normalized.length) {
    throw new Error("File cookie khong co cookie hop le de nap vao trinh duyet.");
  }

  return normalized;
}

function detectHumanVerification(bodyText) {
  const text = String(bodyText || "").toLowerCase();
  return (
    text.includes("captcha") ||
    text.includes("verify you are human") ||
    text.includes("human verification") ||
    text.includes("security check") ||
    text.includes("xác minh bạn là con người") ||
    text.includes("xac minh ban la con nguoi")
  );
}

async function callPythonBridge(session, command) {
  return new Promise((resolve, reject) => {
    if (!session || !session.process || session.process.killed) {
      return reject(new Error("Nodriver process is dead or not initialized"));
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";

    const onData = (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const res = JSON.parse(line);
          if (res.error) {
            cleanup();
            reject(new Error(res.error));
          } else {
            cleanup();
            resolve(res);
          }
        } catch {
          // ignore partial/non-json lines
        }
      }
    };

    const onStdErr = (err) => {
      stderrBuffer += err.toString();
    };

    const onExit = (code, signal) => {
      cleanup();
      const detail = stderrBuffer.trim().slice(0, 400);
      reject(new Error(`Nodriver bridge da dung (code=${code ?? "null"}, signal=${signal ?? "null"}). ${detail}`.trim()));
    };

    const cleanup = () => {
      session.process.stdout.removeListener("data", onData);
      session.process.stderr.removeListener("data", onStdErr);
      session.process.removeListener("exit", onExit);
    };

    session.process.stdout.on("data", onData);
    session.process.stderr.on("data", onStdErr);
    session.process.on("exit", onExit);
    session.process.stdin.write(JSON.stringify(command) + "\n");
  });
}

async function createStoryWriterSession(input) {
  const cookieFilePath = String(input?.cookieFilePath || "").trim();
  const chatUrl = normalizeChatUrl(input?.chatUrl);
  const windowIndex = Number.isFinite(Number(input?.windowIndex)) ? Number(input?.windowIndex) : 0;
  
  // Reuse logic: Find an existing session for the same cookie + window index
  for (const [sid, sess] of NODRIVER_SESSIONS.entries()) {
    if (sess.cookieFilePath === cookieFilePath && sess.windowIndex === windowIndex) {
      if (!sess.process || sess.process.killed) {
        NODRIVER_SESSIONS.delete(sid);
        continue;
      }
      try {
        console.log(`[AutoRun] Reusing existing session ${sid} (Window: ${windowIndex})`);
        // Maybe ensure we are on the right URL? 
        // For now just returning it is safer and faster.
        return { sessionId: sid, browserName: "Nodriver (Reused)", chatUrl: sess.chatUrl };
      } catch (e) {
        NODRIVER_SESSIONS.delete(sid);
      }
    }
  }

  const sessionId = makeNodriverSessionId();
  const pyProcess = spawn("python", [getPythonBridgePath()], {
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    stdio: ["pipe", "pipe", "pipe"], // Ensure pipes are open
  });

  const session = {
    process: pyProcess,
    sessionId,
    chatUrl,
    cookieFilePath,
    windowIndex,
  };

  NODRIVER_SESSIONS.set(sessionId, session);

  try {
    const res = await callPythonBridge(session, {
      cmd: "start",
      url: chatUrl,
      cookie_file: cookieFilePath,
      window_index: windowIndex,
    });
    return { sessionId, browserName: "Nodriver (Chromium Stealth)", chatUrl: res.url };
  } catch (error) {
    pyProcess.kill("SIGKILL");
    NODRIVER_SESSIONS.delete(sessionId);
    throw error;
  }
}

async function closeStoryWriterSession(sessionId) {
  const session = NODRIVER_SESSIONS.get(sessionId);
  if (!session) return;
  NODRIVER_SESSIONS.delete(sessionId);
  if (session.process) {
    try {
      // Try polite exit first
      session.process.stdin.write(JSON.stringify({ cmd: "exit" }) + "\n");
      setTimeout(() => {
        if (!session.process.killed) session.process.kill("SIGKILL");
      }, 2000);
    } catch (e) {
      session.process.kill("SIGKILL");
    }
  }
}

async function sendStoryWriterPrompt(input) {
  const sessionId = String(input?.sessionId || "").trim();
  const prompt = String(input?.prompt || "").trim();
  const timeoutMs = Math.max(30000, Number(input?.timeoutMs) || 300000);
  const newConversation = input?.newConversation !== false;

  const session = NODRIVER_SESSIONS.get(sessionId);
  if (!session) throw new Error("Session khong ton tai.");

  // Send prompt
  await callPythonBridge(session, { cmd: "send", prompt, new_conversation: newConversation });

  // Poll for response
  const start = Date.now();
  let retryCount = 0;
  while (Date.now() - start < timeoutMs) {
    const res = await callPythonBridge(session, { cmd: "get_response" });
    if (res.status === "completed") {
      return res.text;
    }
    
    // If we hit a known error UI, let's try to start a new chat and retry once.
    if (res.status === "error_retryable" && retryCount < 1) {
        console.log(`[AutoRun] Phat hien loi ChatGPT (${res.error}). Dang tu dong tao chat moi de thu lai...`);
        retryCount++;
        await new Promise((r) => setTimeout(r, 2000));
        await callPythonBridge(session, { cmd: "send", prompt, new_conversation: true });
        continue;
    }

    // generating or waiting
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error("Timeout cho phan hoi tu ChatGPT.");
}

function registerIpcHandlers() {
  ipcMain.handle("dialog:pick-json-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("dialog:pick-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("story-writer:start-session", async (_event, input) => createStoryWriterSession(input));
  ipcMain.handle("story-writer:send-prompt", async (_event, input) => sendStoryWriterPrompt(input));
  ipcMain.handle("story-writer:close-session", async (_event, input) => closeStoryWriterSession(input?.sessionId));
  ipcMain.handle("story-writer:cleanup-all", async () => {
    const list = Array.from(NODRIVER_SESSIONS.keys());
    for (const sid of list) {
       await closeStoryWriterSession(sid);
    }
  });
  ipcMain.handle("story-writer:count", async () => {
    return NODRIVER_SESSIONS.size;
  });
}

function createWindow() {
  const iconPath = resolveWindowIconPath();
  const initialState = readWindowState();

  const win = new BrowserWindow({
    width: initialState.width,
    height: initialState.height,
    x: initialState.x,
    y: initialState.y,
    minWidth: 1280,
    minHeight: 720,
    title: "AutoSAPG - v1.0.15",
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      zoomFactor: 1,
    },
  });

  win.setAspectRatio(16 / 9);
  win.loadFile(path.join(__dirname, "dist", "index.html"));
  bindWindowStatePersistence(win);
  win.once("ready-to-show", () => {
    if (initialState.isFullScreen) {
      win.setFullScreen(true);
    } else if (initialState.isMaximized) {
      win.maximize();
    }
    win.show();
  });
  win.webContents.setZoomFactor(1);
  win.webContents
    .setVisualZoomLevelLimits(1, 1)
    .catch(() => undefined);
  win.webContents.on("before-input-event", (event, input) => {
    const key = (input.key || "").toLowerCase();
    if (input.control && (key === "+" || key === "-" || key === "0" || input.code === "NumpadAdd" || input.code === "NumpadSubtract")) {
      event.preventDefault();
    }
  });
  return win;
}

function setupAutoUpdates(mainWindow) {
  if (!app.isPackaged) {
    return;
  }

  const updateConfigPath = path.join(process.resourcesPath, "app-update.yml");
  if (!fs.existsSync(updateConfigPath)) {
    return;
  }

  let autoUpdater = null;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (error) {
    console.error("AutoUpdater load failed:", error?.message || error);
    return;
  }

  if (!autoUpdater) return;

  const sendStatus = (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-status", status);
    }
  };

  autoUpdater.on("checking-for-update", () => sendStatus("Đang kiểm tra bản cập nhật..."));
  autoUpdater.on("update-available", (info) => sendStatus(`Phát hiện bản v${info.version}, đang tải...`));
  autoUpdater.on("update-not-available", () => sendStatus("Đã là bản mới nhất."));
  autoUpdater.on("error", (err) => sendStatus(`Lỗi cập nhật: ${err.message || err}`));
  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.round(progressObj.percent);
    sendStatus(`Đang tải bản cập nhật: ${percent}%`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    sendStatus(`Đã tải bản v${info.version}`);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Cập nhật ứng dụng",
      message: `Bản cập nhật v${info.version} đã sẵn sàng. Bạn có muốn khởi động lại để cài đặt ngay không?`,
      buttons: ["Khởi động lại ngay", "Để sau"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  ipcMain.handle("app:check-for-updates", async () => {
    try {
      if (autoUpdater) await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      sendStatus(`Lỗi: ${error.message || error}`);
    }
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error("Auto-update check failed:", error.message || error);
    sendStatus("");
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  const mainWindow = createWindow();
  setupAutoUpdates(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  const closing = Array.from(NODRIVER_SESSIONS.keys()).map((sessionId) => closeStoryWriterSession(sessionId));
  if (closing.length) {
    Promise.allSettled(closing).catch(() => undefined);
  }
});
