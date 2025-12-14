import {
  mutateCollection,
  readCollection,
} from "../storage/fileStore.js";

const COLLECTION_KEY = "gstinNumbers";

export const findAll = async () => readCollection(COLLECTION_KEY);

export const estimatedDocumentCount = async () => {
  const entries = await readCollection(COLLECTION_KEY);
  return entries.length;
};

export const insertMany = async (records = []) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const existingByState = new Map(
      entries.map((entry) => [entry.stateName?.toLowerCase(), entry]),
    );

    const now = new Date().toISOString();
    const toInsert = records
      .filter(
        (record) =>
          record?.stateName &&
          !existingByState.has(record.stateName.toLowerCase()),
      )
      .map((record) => ({
        _id: `${record.gstCode}-${record.stateName}`.toLowerCase(),
        ...record,
        createdAt: now,
        updatedAt: now,
      }));

    if (toInsert.length === 0) {
      return { nextData: entries, result: [] , skipWrite: true };
    }

    return {
      nextData: [...entries, ...toInsert],
      result: toInsert,
    };
  });

