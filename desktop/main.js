const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const fs = require("fs");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const Store = require("electron-store");

const DEFAULT_PORT = 8000;

app.setName("EasyRAG");
app.setPath("userData", path.join(app.getPath("appData"), "EasyRAG"));

const store = new Store({
  name: "config",
  encryptionKey: buildEncryptionKey(),
  defaults: { apiPort: DEFAULT_PORT },
});

let mainWindow = null;
let backendProcess = null;

function buildEncryptionKey() {
  const seed = `${os.userInfo().username}:${os.hostname()}:EasyRAG`;
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function getConfig() {
  return {
    deepseekApiKey: store.get("deepseekApiKey", ""),
    qwenApiKey: store.get("qwenApiKey", ""),
    kbRootPath: store.get("kbRootPath", ""),
    apiPort: store.get("apiPort", DEFAULT_PORT),
  };
}

function normalizeConfig(raw) {
  return {
    deepseekApiKey: (raw.deepseekApiKey || "").trim(),
    qwenApiKey: (raw.qwenApiKey || "").trim(),
    kbRootPath: (raw.kbRootPath || "").trim(),
    apiPort: Number(raw.apiPort || DEFAULT_PORT),
  };
}

function getKbRootPath(config) {
  if (config.kbRootPath) {
    return config.kbRootPath;
  }
  return path.join(app.getPath("userData"), "kb");
}

function ensureDataDirs(rootPath) {
  const rawDir = path.join(rootPath, "raw");
  const indexDir = path.join(rootPath, "index");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(indexDir, { recursive: true });
  return { rawDir, indexDir };
}

function buildBackendEnv(config) {
  const kbRoot = getKbRootPath(config);
  const { rawDir, indexDir } = ensureDataDirs(kbRoot);
  return {
    ...process.env,
    DEEPSEEK_API_KEY: config.deepseekApiKey || "",
    QWEN_API_KEY: config.qwenApiKey || "",
    RAW_DIR: rawDir,
    INDEX_DIR: indexDir,
    EASYRAG_PORT: String(config.apiPort || DEFAULT_PORT),
    CORS_ALLOW_ORIGINS: "*",
    CORS_ALLOW_CREDENTIALS: "false",
  };
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }
  backendProcess.kill();
  backendProcess = null;
}

function startBackend(config) {
  stopBackend();
  const env = buildBackendEnv(config);
  const port = config.apiPort || DEFAULT_PORT;
  if (app.isPackaged) {
    const exePath = path.join(process.resourcesPath, "backend", "backend.exe");
    backendProcess = spawn(exePath, [], { env, stdio: "pipe" });
  } else {
    const python = process.env.EASYRAG_PYTHON || "python";
    const backendCwd = path.join(__dirname, "..", "backend");
    backendProcess = spawn(
      python,
      ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(port)],
      { env, cwd: backendCwd, stdio: "pipe" }
    );
  }
  backendProcess.on("exit", () => {
    backendProcess = null;
  });
}

function getFrontendUrl() {
  const devUrl = process.env.EASYRAG_DEV_SERVER_URL;
  if (devUrl) {
    return devUrl;
  }
  const distPath = app.isPackaged
    ? path.join(process.resourcesPath, "frontend-dist", "index.html")
    : path.join(__dirname, "..", "frontend", "vite-react", "dist", "index.html");
  return pathToFileURL(distPath).toString();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(getFrontendUrl());
  return win;
}

ipcMain.handle("config:get", () => getConfig());
ipcMain.handle("config:save", async (_event, payload) => {
  const normalized = normalizeConfig(payload || {});
  store.set("deepseekApiKey", normalized.deepseekApiKey);
  store.set("qwenApiKey", normalized.qwenApiKey);
  store.set("kbRootPath", normalized.kbRootPath);
  store.set("apiPort", normalized.apiPort || DEFAULT_PORT);
  startBackend(normalized);
  return normalized;
});
ipcMain.handle("dialog:select-kb-root", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select knowledge base root",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return result.filePaths[0];
});

app.whenReady().then(() => {
  const config = normalizeConfig(getConfig());
  startBackend(config);
  mainWindow = createWindow();
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
