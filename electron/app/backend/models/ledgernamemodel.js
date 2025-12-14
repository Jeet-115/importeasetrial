import { v4 as uuidv4 } from "uuid";
import {
  mutateCollection,
  readCollection,
} from "../storage/fileStore.js";

const COLLECTION_KEY = "ledgerNames";

export const findAll = async () => readCollection(COLLECTION_KEY);

export const estimatedDocumentCount = async () => {
  const entries = await readCollection(COLLECTION_KEY);
  return Array.isArray(entries) ? entries.length : 0;
};

export const insertMany = async (names = []) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const now = new Date().toISOString();
    const records = names.map((name) => ({
      _id: uuidv4(),
      name,
      createdAt: now,
      updatedAt: now,
    }));
    return { nextData: [...entries, ...records], result: records };
  });

export const create = async ({ name }) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const now = new Date().toISOString();
    const record = {
      _id: uuidv4(),
      name,
      createdAt: now,
      updatedAt: now,
    };
    return { nextData: [...entries, record], result: record };
  });

export const updateById = async (id, updates) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const index = entries.findIndex((entry) => entry._id === id);
    if (index === -1) {
      return { nextData: entries, result: null, skipWrite: true };
    }
    const updated = {
      ...entries[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    const nextData = [...entries];
    nextData[index] = updated;
    return { nextData, result: updated };
  });

export const deleteById = async (id) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const nextData = entries.filter((entry) => entry._id !== id);
    const removed = nextData.length !== entries.length;
    return {
      nextData,
      result: removed ? true : null,
      skipWrite: !removed,
    };
  });

