import { v4 as uuidv4 } from "uuid";
import {
  mutateCollection,
  readCollection,
} from "../storage/fileStore.js";

const COLLECTION_KEY = "partyMasters";

export const findAll = async () => readCollection(COLLECTION_KEY);

export const findByCompany = async (companyId) => {
  const all = await readCollection(COLLECTION_KEY);
  return all.filter((party) => party.companyId === companyId);
};

export const findById = async (id) => {
  const parties = await readCollection(COLLECTION_KEY);
  return parties.find((party) => party._id === id) || null;
};

export const create = async (payload) =>
  mutateCollection(COLLECTION_KEY, (parties) => {
    const now = new Date().toISOString();
    const record = {
      _id: uuidv4(),
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
    return { nextData: [...parties, record], result: record };
  });

export const createMany = async (payloads) =>
  mutateCollection(COLLECTION_KEY, (parties) => {
    const now = new Date().toISOString();
    const newRecords = payloads.map((payload) => ({
      _id: uuidv4(),
      ...payload,
      createdAt: now,
      updatedAt: now,
    }));
    return { nextData: [...parties, ...newRecords], result: newRecords };
  });

export const updateById = async (id, updates) =>
  mutateCollection(COLLECTION_KEY, (parties) => {
    const index = parties.findIndex((party) => party._id === id);
    if (index === -1) {
      return { nextData: parties, result: null, skipWrite: true };
    }

    const now = new Date().toISOString();
    const updated = {
      ...parties[index],
      ...updates,
      updatedAt: now,
    };

    const nextData = [...parties];
    nextData[index] = updated;
    return { nextData, result: updated };
  });

export const deleteById = async (id) =>
  mutateCollection(COLLECTION_KEY, (parties) => {
    const nextData = parties.filter((party) => party._id !== id);
    const removed = parties.length !== nextData.length;

    return {
      nextData,
      result: removed ? true : null,
      skipWrite: !removed,
    };
  });

export const deleteByCompany = async (companyId) =>
  mutateCollection(COLLECTION_KEY, (parties) => {
    const nextData = parties.filter((party) => party.companyId !== companyId);
    const removed = parties.length !== nextData.length;

    return {
      nextData,
      result: removed,
      skipWrite: !removed,
    };
  });

