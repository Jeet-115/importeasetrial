import { v4 as uuidv4 } from "uuid";
import {
  mutateCollection,
  readCollection,
} from "../storage/fileStore.js";

const COLLECTION_KEY = "gstr2aImports";

export const findAll = () => readCollection(COLLECTION_KEY);

export const findById = async (id) => {
  const entries = await readCollection(COLLECTION_KEY);
  return entries.find((entry) => entry._id === id) || null;
};

export const findByCompany = async (companyId) => {
  const entries = await readCollection(COLLECTION_KEY);
  return entries
    .filter((entry) => entry.company === companyId)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
};

export const create = async (payload) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const now = new Date().toISOString();
    const record = {
      _id: uuidv4(),
      ...payload,
      uploadedAt: payload.uploadedAt || now,
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

    const now = new Date().toISOString();
    const updated = {
      ...entries[index],
      ...updates,
      updatedAt: now,
    };

    const nextData = [...entries];
    nextData[index] = updated;
    return { nextData, result: updated };
  });

export const deleteById = async (id) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const index = entries.findIndex((entry) => entry._id === id);
    if (index === -1) {
      return { nextData: entries, result: null, skipWrite: true };
    }

    const deleted = entries[index];
    const nextData = entries.filter((_, idx) => idx !== index);
    return { nextData, result: deleted };
  });
