const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const WINDOW_STATE_FILE = "window-state.json";

function windowStatePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function readWindowState() {
  const fallback = {
    width: 1280,
    height: 720,
    x: undefined,
    y: undefined,
    isMaximized: true,
  };

  try {
    const filePath = windowStatePath();
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      width: Number.isFinite(Number(parsed.width)) ? Math.max(960, Number(parsed.width)) : fallback.width,
      height: Number.isFinite(Number(parsed.height)) ? Math.max(540, Number(parsed.height)) : fallback.height,
      x: Number.isFinite(Number(parsed.x)) ? Number(parsed.x) : undefined,
      y: Number.isFinite(Number(parsed.y)) ? Number(parsed.y) : undefined,
      isMaximized: Boolean(parsed.isMaximized),
    };
  } catch {
    return fallback;
  }
}

function saveWindowState(win) {
  try {
    const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(
      windowStatePath(),
      JSON.stringify(
        {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          isMaximized: win.isMaximized(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    console.error("Save window state failed:", error?.message || error);
  }
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

function createWindow() {
  const iconPath = resolveWindowIconPath();
  const state = readWindowState();

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    title: "AutoRun - 1.0.0",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  win.once("ready-to-show", () => {
    if (state.isMaximized) win.maximize();
  });
  win.on("close", () => saveWindowState(win));
  win.loadFile(path.join(__dirname, "dist", "index.html"));
}

app.whenReady().then(() => {
  createWindow();

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
