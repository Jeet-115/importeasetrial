import { v4 as uuidv4 } from "uuid";
import {
  mutateCollection,
  readCollection,
} from "../storage/fileStore.js";

const COLLECTION_KEY = "companyMasters";

export const findAll = async () => readCollection(COLLECTION_KEY);

export const findById = async (id) => {
  const companies = await readCollection(COLLECTION_KEY);
  return companies.find((company) => company._id === id) || null;
};

export const create = async (payload) =>
  mutateCollection(COLLECTION_KEY, (companies) => {
    const now = new Date().toISOString();
    const record = {
      _id: uuidv4(),
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
    return { nextData: [...companies, record], result: record };
  });

export const updateById = async (id, updates) =>
  mutateCollection(COLLECTION_KEY, (companies) => {
    const index = companies.findIndex((company) => company._id === id);
    if (index === -1) {
      return { nextData: companies, result: null, skipWrite: true };
    }

    const now = new Date().toISOString();
    const updated = {
      ...companies[index],
      ...updates,
      updatedAt: now,
    };

    const nextData = [...companies];
    nextData[index] = updated;
    return { nextData, result: updated };
  });

export const deleteById = async (id) =>
  mutateCollection(COLLECTION_KEY, (companies) => {
    const nextData = companies.filter((company) => company._id !== id);
    const removed = companies.length !== nextData.length;

    return {
      nextData,
      result: removed ? true : null,
      skipWrite: !removed,
    };
  });

