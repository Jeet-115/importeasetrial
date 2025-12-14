import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const STORAGE_SUBDIR = "ImportEaseStorage";
const DEFAULT_ROOT =
  process.platform === "win32"
    ? path.join("C:", STORAGE_SUBDIR)
    : path.join(process.cwd(), "storage", "data");
let cachedElectronApp = null;
let cachedDataDir = process.env.TALLY_HELPER_DATA_DIR || null;

const getElectronApp = () => {
  if (cachedElectronApp !== null) {
    return cachedElectronApp;
  }

  try {
    const { app } = require("electron");
    cachedElectronApp = app ?? undefined;
  } catch {
    cachedElectronApp = undefined;
  }

  return cachedElectronApp;
};

export const setBaseDir = (dir) => {
  if (dir) {
    cachedDataDir = dir;
    process.env.TALLY_HELPER_DATA_DIR = dir;
  }
};

export const ensurePreferredDataDir = async () => {
  if (cachedDataDir) {
    await fs.mkdir(cachedDataDir, { recursive: true });
    return cachedDataDir;
  }

  const electronApp = getElectronApp();
  let preferred;

  if (electronApp?.isPackaged) {
    const exeFolder = path.dirname(process.execPath); // folder where exe is
    preferred = path.join(exeFolder, STORAGE_SUBDIR);
  } else {
    // dev fallback
    preferred = path.join(process.cwd(), "storage", "data");
  }

  await fs.mkdir(preferred, { recursive: true });
  setBaseDir(preferred);
  return preferred;
};

export const getBaseDir = (customBasePath) => {
  if (customBasePath) {
    return customBasePath;
  }

  if (cachedDataDir) {
    return cachedDataDir;
  }

  if (process.env.TALLY_HELPER_DATA_DIR) {
    cachedDataDir = process.env.TALLY_HELPER_DATA_DIR;
    return cachedDataDir;
  }

  return DEFAULT_ROOT;
};

export const getFullPath = (filename, basePath) => {
  if (!filename || typeof filename !== "string") {
    throw new Error("A filename string is required.");
  }
  return path.join(getBaseDir(basePath), filename);
};

export const ensureDataDir = async (basePath) => {
  const dir = getBaseDir(basePath);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

export const readJson = async (
  filename,
  { basePath, defaultToObject = false } = {},
) => {
  const fullPath = getFullPath(filename, basePath);
  try {
    const raw = await fs.readFile(fullPath, "utf8");
    if (!raw.trim()) {
      return defaultToObject ? {} : [];
    }
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return defaultToObject ? {} : [];
    }

    console.error(`[fileService] Failed to read ${fullPath}:`, error);
    throw error;
  }
};

export const writeJson = async (filename, data, { basePath } = {}) => {
  const fullPath = getFullPath(filename, basePath);
  await ensureDataDir(basePath);
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf8");
  return true;
};