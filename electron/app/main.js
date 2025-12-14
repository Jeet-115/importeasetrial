import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from "electron";
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import crypto from "node:crypto";
import machineIdPkg from "node-machine-id";

const { machineIdSync } = machineIdPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// fileService.js will be imported dynamically after app is ready
// This avoids issues with app.getAppPath() not being available at module load time
let getBaseDir, ensurePreferredDataDir, setBaseDir;

const migrateOldStorageIfNeeded = async () => {
  try {
    const oldPath = path.join(
      path.dirname(process.execPath),
      "ImportEaseStorage"
    );

    const newPath = path.join(
      app.getPath("userData"),
      "ImportEaseStorage"
    );

    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      console.log("[migration] Migrating old storage to userData");
      await fs.mkdir(path.dirname(newPath), { recursive: true });
      await fs.cp(oldPath, newPath, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    }
  } catch (err) {
    console.error("[migration] Failed:", err);
  }
};


const loadFileService = async () => {
  if (app.isPackaged) {
    // ✅ Always import directly from app.asar
    return await import("./fileService.js");
  }

  // ✅ Development mode
  return await import("./fileService.js");
};


const baseEnvIsDev = !app.isPackaged;
const isDevLike = !app.isPackaged;

// Get app path - in packaged apps, this points to resources/app.asar/app or resources/app/app
const getAppPath = () => {
  if (app.isPackaged) {
    // In packaged app, app.getAppPath() returns resources/app.asar (which contains app/ folder)
    return app.getAppPath();
  }
  // In development, we're in app/ folder, so return parent (electron/)
  return path.resolve(__dirname, "..");
};

const APP_PATH = getAppPath();
const DEV_SERVER_URL =
  process.env.VITE_DEV_SERVER_URL ??
  process.env.FRONTEND_DEV_SERVER ??
  "http://localhost:5173";
const BACKEND_PORT = process.env.BACKEND_PORT ?? "5000";
const BACKEND_HEALTHCHECK = `http://localhost:${BACKEND_PORT}/health`;
const BACKEND_BASE_URL = `http://localhost:${BACKEND_PORT}`;
// DATA_DIR will be set after fileService is loaded
let DATA_DIR;
// Get renderer candidates - check both inside asar and in resources
const getRendererCandidates = () => {
  if (app.isPackaged) {
    return [
      path.join(app.getAppPath(), "app", "client", "dist", "index.html"),
    ];
  }

  return [path.resolve(__dirname, "client", "dist", "index.html")];
};

const PRODUCTION_RENDERER_CANDIDATES = getRendererCandidates();

let mainWindow = null;
let backendProcess = null;
let frontendProcess = null;
let isQuitting = false;
let ipcHandlersRegistered = false;
let autoUpdateInitialized = false;
const updaterState = {
  currentVersion: app.getVersion(),
  latestVersion: null,
  status: "Idle",
  lastError: null,
};

const buildMenuTemplate = () => {
  const helpItems = [
    {
      label: `Current version: ${updaterState.currentVersion}`,
      enabled: false,
    },
    {
      label: `Latest available: ${
        updaterState.latestVersion || "Not checked yet"
      }`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: `Status: ${updaterState.status}`,
      enabled: false,
    },
    updaterState.lastError
      ? {
          label: `Last error: ${updaterState.lastError}`,
          enabled: false,
        }
      : null,
    { type: "separator" },
    {
      label: "Check for updates now",
      click: () => {
        console.log("[updater] Manual check triggered");
        updaterState.status = "Checking for updates…";
        updaterState.lastError = null;
        refreshAppMenu();
        autoUpdater
          .checkForUpdates()
          .then(() => {
            console.log("[updater] Manual check initiated");
            updaterState.status = "Checking for updates…";
            refreshAppMenu();
          })
          .catch((error) => {
            console.error("[updater] Manual check failed:", error);
            updaterState.status = "Update check failed";
            updaterState.lastError = error?.message ?? "Unknown error";
            refreshAppMenu();
          });
      },
    },
  ].filter(Boolean);

  return [
    {
      label: "File",
      submenu: [{ role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: helpItems,
    },
  ];
};

const refreshAppMenu = () => {
  const menu = Menu.buildFromTemplate(buildMenuTemplate());
  Menu.setApplicationMenu(menu);
};

const getDevServerPort = () => {
  try {
    const { port } = new URL(DEV_SERVER_URL);
    return port || "5173";
  } catch {
    return "5173";
  }
};

const startFrontendDevServer = () => {
  if (!isDevLike || frontendProcess) {
    return frontendProcess;
  }

  const clientDir = path.resolve(__dirname, "..", "..", "client");
  const viteBin = path.resolve(
    clientDir,
    "node_modules",
    "vite",
    "bin",
    "vite.js",
  );

  if (!fs.existsSync(viteBin)) {
    console.warn(
      "[frontend] Vite binary not found. Run `cd client && npm install` first.",
    );
    return null;
  }

  const port = getDevServerPort();
  const args = [
    viteBin,
    "--host",
    "localhost",
    "--port",
    port,
    "--strictPort",
  ];

  frontendProcess = spawn(process.execPath, args, {
    cwd: clientDir,
    env: {
      ...process.env,
      BROWSER: "none",
    },
    stdio: "pipe",
  });

  const logStream = (stream, prefix) => {
    if (!stream) return;
    stream.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        console.log(`[frontend:${prefix}]`, message);
      }
    });
  };

  logStream(frontendProcess.stdout, "stdout");
  logStream(frontendProcess.stderr, "stderr");

  frontendProcess.once("exit", (code, signal) => {
    console.warn(
      `Frontend dev server exited (code: ${code ?? "unknown"}, signal: ${
        signal ?? "n/a"
      })`,
    );
    frontendProcess = null;
  });

  frontendProcess.once("error", (error) => {
    console.error("Failed to start frontend dev server:", error);
  });

  return frontendProcess;
};

const stopFrontendDevServer = () => {
  if (frontendProcess && !frontendProcess.killed) {
    frontendProcess.kill();
  }
  frontendProcess = null;
};

const waitForDevServer = async (attempts = 40, delayMs = 250) => {
  if (isDevLike) {
    startFrontendDevServer();
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(DEV_SERVER_URL, {
        method: "HEAD",
        cache: "no-store",
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // swallow and retry
    }
    await delay(delayMs);
  }
  return false;
};

const findProductionRenderer = () => {
  const candidates = getRendererCandidates();
  // Electron's loadFile() can load from asar, so we just return the first likely candidate
  // The most common location is app.asar/client/dist/index.html
  for (const candidate of candidates) {
    console.log("[renderer] Candidate:", candidate);
    // For asar files, we can't reliably check existence, so we'll try to load it
    // Return the first candidate that looks reasonable (inside app.asar)
    if (candidate.includes("app.asar") || candidate.includes("client/dist")) {
      console.log("[renderer] Using:", candidate);
      return candidate;
    }
  }
  // Fallback: return first candidate anyway, let loadFile() handle the error
  if (candidates.length > 0) {
    console.log("[renderer] Using first candidate:", candidates[0]);
    return candidates[0];
  }
  return null;
};

const resolveRendererTarget = async () => {
  const devServerAvailable = await waitForDevServer();
  const shouldUseDevServer = (baseEnvIsDev || devServerAvailable) && devServerAvailable;

  if (shouldUseDevServer) {
    return { type: "url", value: DEV_SERVER_URL };
  }

  const productionHtml = findProductionRenderer();
  if (productionHtml) {
    return { type: "file", value: productionHtml };
  }

  throw new Error(
    `No renderer entry found. Checked dev server at ${DEV_SERVER_URL} and build artifacts at ${PRODUCTION_RENDERER_CANDIDATES.join(
      ", ",
    )}.`,
  );
};

const loadRenderer = async (windowInstance) => {
  const target = await resolveRendererTarget();
  if (target.type === "url") {
    await windowInstance.loadURL(target.value);
  } else {
    try {
      // loadFile can load from asar archives, so just try it
      await windowInstance.loadFile(target.value);
    } catch (error) {
      console.error("[renderer] Failed to load file:", target.value, error);
      throw new Error(`Failed to load renderer from ${target.value}: ${error.message}`);
    }
  }
};

const createMainWindow = async () => {
  const preloadPath = app.isPackaged
    ? path.join(__dirname, "preload.js")
    : path.resolve(__dirname, "preload.js");

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#0C0C0C",
    title: "ImportEase",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const label = ["log", "warn", "error"][level] || "log";
    console[label](
      `[renderer] ${message}${sourceId ? ` (${sourceId}:${line ?? "?"})` : ""}`,
    );
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(
      "[renderer] Failed to load URL",
      validatedURL,
      errorCode,
      errorDescription,
    );
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  try {
    await loadRenderer(mainWindow);
  } catch (error) {
    console.error("Unable to load renderer:", error);
    const guidance = isDevLike
      ? "Ensure the client dev server is running (npm run dev:client)."
      : "Build the client (npm run dist) before launching.";
    dialog.showErrorBox(
      "Renderer Failed To Load",
      `${error.message ?? String(error)}\n\n${guidance}`,
    );
  }
};

const startBackend = async () => {
  try {
    if (app.isPackaged) {
      console.log("[backend] Starting from app.asar via import");

      const backendModule = await import("./backend/server.js");

      if (backendModule?.default) {
        await backendModule.default(); // must be async export
      }

      console.log("[backend] ✔ Backend started from app.asar");
      return;
    }

    // ✅ Dev mode
    const backendEntry = path.join(__dirname, "backend", "server.js");

    backendProcess = spawn(process.execPath, [backendEntry], {
      env: {
        ...process.env,
        PORT: BACKEND_PORT
      },
      stdio: "pipe",
    });

    backendProcess.stdout.on("data", d =>
      console.log("[backend]", d.toString())
    );
    backendProcess.stderr.on("data", d =>
      console.error("[backend]", d.toString())
    );

  } catch (err) {
    console.error("[backend] Failed to start:", err);
    dialog.showErrorBox(
      "Backend Startup Error",
      `Backend failed to start:\n\n${err.message}`
    );
    app.quit();
  }
};



const stopBackend = () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  backendProcess = null;
};

const waitForBackend = async (attempts = 40, delayMs = 500) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(BACKEND_HEALTHCHECK, { cache: "no-store" });
      if (response.ok) {
        return true;
      }
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }
    }
    await delay(delayMs);
  }
  throw new Error("Backend health check timed out");
};

const registerIpcHandlers = () => {
  if (ipcHandlersRegistered) {
    return;
  }

  ipcMain.handle("ping", () => "pong");

  ipcMain.handle("get-device-id", async () => {
    // Wait for updater locks to release
    await delay(1500);
  
    try {
      const deviceFile = path.join(DATA_DIR, "auth", "device.json");
  
      let deviceId = null;
  
      // Attempt to read existing ID safely
      try {
        if (fs.existsSync(deviceFile)) {
          const raw = fs.readFileSync(deviceFile, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed?.deviceId) return parsed.deviceId;
        }
      } catch {
        console.warn("[ipc] device.json corrupted — regenerating");
      }
  
      // Generate new one
      const baseId = machineIdSync(true);
      const hash = crypto.createHash("sha256").update(baseId).digest("hex");
      deviceId = `DEV-${hash}`;
  
      fs.mkdirSync(path.dirname(deviceFile), { recursive: true });
      fs.writeFileSync(deviceFile, JSON.stringify({ deviceId }, null, 2), "utf8");
  
      return deviceId;
    } catch (error) {
      console.error("[ipc] get-device-id failed:", error);
      return "ERROR_DEVICE_ID";
    }
  });
  

  ipcMain.handle("read-json", async (_, filename) => {
    try {
      if (!filename) {
        return null;
      }

      const filePath = path.join(DATA_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const raw = fs.readFileSync(filePath, "utf8");
      if (!raw.trim()) {
        return null;
      }

      return JSON.parse(raw);
    } catch (error) {
      console.error("[ipc] read-json failed:", error);
      return {
        error: "READ_JSON_FAILED",
        message: error.message,
      };
    }
  });

  ipcMain.handle("write-json", async (_, filename, data) => {
    try {
      if (!filename) {
        throw new Error("A filename is required.");
      }

      const filePath = path.join(DATA_DIR, filename);
      const directory = path.dirname(filePath);
      fs.mkdirSync(directory, { recursive: true });

      fs.writeFileSync(filePath, JSON.stringify(data ?? {}, null, 2), "utf8");
      return { ok: true };
    } catch (error) {
      console.error("[ipc] write-json failed:", error);
      return {
        error: "WRITE_JSON_FAILED",
        message: error.message,
      };
    }
  });

  ipcMain.handle("proxy-api", async (_, payload = {}) => {
    const apiPath = payload.path ?? "/";
    const options = payload.options ?? {};

    try {
      const targetUrl = new URL(apiPath, `${BACKEND_BASE_URL}/`).toString();

      const fetchOptions = {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        body: options.body,
      };

      if (
        fetchOptions.body &&
        typeof fetchOptions.body === "object" &&
        !(fetchOptions.body instanceof Buffer)
      ) {
        fetchOptions.body = JSON.stringify(fetchOptions.body);
        fetchOptions.headers = {
          "Content-Type": "application/json",
          ...fetchOptions.headers,
        };
      }

      const response = await fetch(targetUrl, fetchOptions);
      const text = await response.text();
      let json = null;

      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }

      return {
        status: response.status,
        ok: response.ok,
        json,
      };
    } catch (error) {
      console.error("[ipc] proxy-api failed:", error);
      return {
        error: "PROXY_API_FAILED",
        message: error.message,
      };
    }
  });

  ipcHandlersRegistered = true;
};

const initAutoUpdater = () => {
  if (autoUpdateInitialized) return;
  autoUpdateInitialized = true;

  if (!app.isPackaged || isDevLike) {
    console.log("[updater] Skipping auto-update in development.");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on("error", (error) => {
    console.error("[updater] Error:", error);
    updaterState.status = `Error: ${error?.message ?? "Update failed"}`;
    updaterState.lastError = error?.message ?? "Update failed";
    refreshAppMenu();
  });

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for updates…");
    updaterState.status = "Checking for updates…";
    updaterState.lastError = null;
    refreshAppMenu();
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] Update available:", info?.version ?? "unknown version");
    updaterState.latestVersion = info?.version ?? null;
    updaterState.status = "Update available – downloading";
    updaterState.lastError = null;
    refreshAppMenu();
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] No updates available.");
    updaterState.latestVersion = updaterState.currentVersion;
    updaterState.status = "Up to date";
    updaterState.lastError = null;
    refreshAppMenu();
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = progress?.percent
      ? progress.percent.toFixed(1)
      : "0";
    console.log(
      "[updater] Download progress:",
      `${percent}%`,
      `${progress?.transferred ?? 0}/${progress?.total ?? "?"} bytes`,
    );
    updaterState.status = `Downloading… ${percent}%`;
    refreshAppMenu();
  });

  autoUpdater.on("update-downloaded", async (_event, _notes, releaseName) => {
    try {
      updaterState.latestVersion = releaseName || updaterState.latestVersion;
      updaterState.status = "Ready to install";
      updaterState.lastError = null;
      refreshAppMenu();
      if (!mainWindow) return;
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: ["Install now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update available",
        message: `A new version of Tally Helper (${releaseName}) has been downloaded.`,
        detail:
          "Install now to update to the latest version. The application will restart during the update.",
      });

      if (response === 0) {
        isQuitting = true;
        setImmediate(() => {
          autoUpdater.quitAndInstall();
        });
      }
    } catch (error) {
      console.error("[updater] Failed to prompt for update:", error);
      updaterState.lastError = error?.message ?? "Failed to prompt for update";
      refreshAppMenu();
    }
  });

  // Check for updates a few seconds after startup to allow network to come up.
  setTimeout(() => {
    updaterState.status = "Checking for updates…";
    updaterState.lastError = null;
    refreshAppMenu();
    autoUpdater
      .checkForUpdates()
      .then(() => {
        console.log("[updater] Update check initiated.");
        updaterState.status = "Checking for updates…";
        refreshAppMenu();
      })
      .catch((error) => {
        console.error("[updater] Failed to check for updates:", error);
        updaterState.status = "Update check failed";
        updaterState.lastError = error?.message ?? "Update check failed";
        refreshAppMenu();
      });
  }, 8000);
};

const bootstrap = async () => {
  // Set initial menu
  refreshAppMenu();

  await migrateOldStorageIfNeeded();

  // Load fileService.js first
  const fileServiceModule = await loadFileService();
  getBaseDir = fileServiceModule.getBaseDir;
  ensurePreferredDataDir = fileServiceModule.ensurePreferredDataDir;
  setBaseDir = fileServiceModule.setBaseDir;

  // Ensure DATA_DIR points to fixed storage folder in production
  try {
    DATA_DIR = await ensurePreferredDataDir(); // Creates folder if missing
    setBaseDir(DATA_DIR);
    process.env.TALLY_HELPER_DATA_DIR = DATA_DIR;
    console.log("[main] DATA_DIR set to:", DATA_DIR);
  } catch (error) {
    console.error("[main] Failed to set DATA_DIR:", error);
    dialog.showErrorBox(
      "Initialization Error",
      `Failed to initialize application data folder.\n\n${error.message}`
    );
    app.quit();
    return;
  }

  // Run data migrations before backend startup
  try {
    const { runMigrations } = await import("./migrations/index.js");
    const { readJson, writeJson } = fileServiceModule;
    await runMigrations(readJson, writeJson);
  } catch (error) {
    console.error("[main] Migration failed (continuing anyway):", error);
    // Don't block app startup if migrations fail
  }

  // Register IPC handlers
  registerIpcHandlers();

  // Start backend process
  await startBackend();
  try {
    await waitForBackend();
  } catch (error) {
    console.error("Backend health check failed:", error);
    dialog.showErrorBox(
      "Backend Not Reachable",
      `The backend did not respond at ${BACKEND_HEALTHCHECK}.\n\n${error.message}`
    );
  }

  // Create main window
  await createMainWindow();

  // Initialize auto-updater
  initAutoUpdater();

  // macOS behavior: re-create window when app icon is clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
};


app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});


app.on("before-quit", () => {
  isQuitting = true;
  stopBackend();
  stopFrontendDevServer();
});

