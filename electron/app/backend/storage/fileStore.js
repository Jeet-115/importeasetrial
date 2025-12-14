import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import {
  ensureDataDir as ensureElectronDataDir,
  getFullPath as electronGetFullPath,
} from "../../fileService.js";

const DATA_DIR =
  process.env.TALLY_HELPER_DATA_DIR ||
  path.resolve(process.cwd(), "storage", "data");

const COLLECTIONS = {
  invoices: { filename: "invoices.json", defaultValue: [] },
  settings: { filename: "settings.json", defaultValue: {} },
  ledgerNames: { filename: "ledgerNames.json", defaultValue: [] },
  companyMasters: { filename: "companyMasters.json", defaultValue: [] },
  partyMasters: { filename: "partyMasters.json", defaultValue: [] },
  gstinNumbers: { filename: "gstinNumbers.json", defaultValue: [] },
  gstr2bImports: { filename: "gstr2bImports.json", defaultValue: [] },
  processedFiles: { filename: "processedFiles.json", defaultValue: [] },
  gstr2aImports: { filename: "gstr2aImports.json", defaultValue: [] },
  processedFiles2A: { filename: "processedFiles2A.json", defaultValue: [] },
};

const locks = new Map();

const withLock = (key, task) => {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(() => task());
  locks.set(
    key,
    run.catch((error) => {
      console.error(`[fileStore] Task failed for ${key}:`, error);
    }),
  );
  return run.finally(() => {
    if (locks.get(key) === run) {
      locks.delete(key);
    }
  });
};

const ensureFileExists = async (filename, defaultValue) => {
  await ensureElectronDataDir(DATA_DIR);
  const fullPath = electronGetFullPath(filename, DATA_DIR);

  try {
    await fsPromises.access(fullPath, fs.constants.F_OK);
    return fullPath;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const payload =
    defaultValue && typeof defaultValue === "object"
      ? JSON.parse(JSON.stringify(defaultValue))
      : defaultValue;

  fs.writeFileSync(fullPath, JSON.stringify(payload ?? null, null, 2), "utf8");
  return fullPath;
};

const readFromDisk = async (collectionKey) => {
  const meta = COLLECTIONS[collectionKey];
  if (!meta) {
    throw new Error(`Unknown collection: ${collectionKey}`);
  }
  const fullPath = await ensureFileExists(meta.filename, meta.defaultValue);
  try {
    const raw = await fsPromises.readFile(fullPath, "utf8");
    if (!raw.trim()) {
      return cloneDefault(meta.defaultValue);
    }
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return cloneDefault(meta.defaultValue);
    }
    throw error;
  }
};

const writeToDisk = async (collectionKey, data) => {
  const meta = COLLECTIONS[collectionKey];
  if (!meta) {
    throw new Error(`Unknown collection: ${collectionKey}`);
  }
  const fullPath = await ensureFileExists(meta.filename, meta.defaultValue);
  const payload =
    data && typeof data === "object"
      ? JSON.parse(JSON.stringify(data))
      : data ?? meta.defaultValue;
  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
};

const cloneDefault = (value) =>
  Array.isArray(value) ? [...value] : { ...value };

export const initFileStore = async () => {
  await ensureElectronDataDir(DATA_DIR);
  await Promise.all(
    Object.values(COLLECTIONS).map(({ filename, defaultValue }) =>
      ensureFileExists(filename, defaultValue),
    ),
  );
};

export const readCollection = (collectionKey) => readFromDisk(collectionKey);

export const writeCollection = (collectionKey, data) =>
  withLock(collectionKey, () => writeToDisk(collectionKey, data));

export const mutateCollection = (collectionKey, mutator) =>
  withLock(collectionKey, async () => {
    const current = await readFromDisk(collectionKey);
    const outcome = (await mutator(current)) || {};
    if (outcome.skipWrite) {
      return outcome.result;
    }
    const nextData =
      outcome.nextData !== undefined ? outcome.nextData : current;
    await writeToDisk(collectionKey, nextData);
    return outcome.result ?? nextData;
  });

export const getInvoices = () => readCollection("invoices");

export const saveInvoices = (invoices) =>
  writeCollection("invoices", invoices ?? []);

export const appendInvoice = (invoice) =>
  mutateCollection("invoices", (list) => {
    const now = new Date().toISOString();
    const record = {
      _id: invoice?._id ?? uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...invoice,
    };
    const nextData = [...list, record];
    return { nextData, result: record };
  });

export const updateInvoice = (id, updates = {}) =>
  mutateCollection("invoices", (list) => {
    const idx = list.findIndex((entry) => entry._id === id);
    if (idx === -1) {
      return { nextData: list, result: null, skipWrite: true };
    }
    const updated = {
      ...list[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    const nextData = [...list];
    nextData[idx] = updated;
    return { nextData, result: updated };
  });

export const deleteInvoice = (id) =>
  mutateCollection("invoices", (list) => {
    const filtered = list.filter((entry) => entry._id !== id);
    const removed = list.length !== filtered.length;
    return {
      nextData: filtered,
      result: removed,
      skipWrite: !removed,
    };
  });

export const getSettings = () => readCollection("settings");

export const saveSettings = (settings) =>
  writeCollection("settings", settings ?? {});

export const DATA_COLLECTIONS = { ...COLLECTIONS };
export const DATA_DIRECTORY = DATA_DIR;

