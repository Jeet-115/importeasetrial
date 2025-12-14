import {
  mutateCollection,
  readCollection,
} from "../storage/fileStore.js";

const COLLECTION_KEY = "processedFiles";

// Disallow ledger names that should be separated into a disallow sheet
// Any ledger name containing "[disallow]" (case-insensitive) will be treated as disallow

export const findById = async (id) => {
  const entries = await readCollection(COLLECTION_KEY);
  return entries.find((entry) => entry._id === id) || null;
};

export const upsert = async (payload) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    if (!payload?._id) {
      throw new Error("Processed file payload must include an _id.");
    }

    const index = entries.findIndex((entry) => entry._id === payload._id);
    const now = new Date().toISOString();
    const record = {
      ...(index >= 0 ? entries[index] : {}),
      ...payload,
      updatedAt: now,
      processedAt: payload.processedAt || now,
    };

    if (index === -1) {
      return {
        nextData: [...entries, record],
        result: record,
      };
    }

    const nextData = [...entries];
    nextData[index] = record;
    return { nextData, result: record };
  });

const normalizeLedgerName = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const normalizeAcceptCredit = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "yes" || lower === "y") return "Yes";
  if (lower === "no" || lower === "n") return "No";
  return null;
};

const normalizeAction = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "accept") return "Accept";
  if (lower === "reject") return "Reject";
  if (lower === "pending") return "Pending";
  return null;
};

const normalizeActionReason = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const normalizeNarration = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const isDisallowLedger = (ledgerName) => {
  if (!ledgerName) return false;
  const normalizedName = String(ledgerName).trim().toLowerCase();
  return normalizedName.includes("[disallow]");
};

const renumberRows = (rows = []) =>
  rows.map((row, idx) => ({
    ...row,
    slNo: idx + 1,
  }));

const buildUpdateMaps = (rows = []) => {
  const bySlNo = new Map();
  const byIndex = new Map();

  rows.forEach((row) => {
    if (!row) return;
    const hasLedgerName = Object.prototype.hasOwnProperty.call(
      row,
      "ledgerName"
    );
    const hasAcceptCredit = Object.prototype.hasOwnProperty.call(
      row,
      "acceptCredit"
    );
    const hasAction = Object.prototype.hasOwnProperty.call(row, "action");
    const hasActionReason = Object.prototype.hasOwnProperty.call(
      row,
      "actionReason"
    );
    const hasNarration = Object.prototype.hasOwnProperty.call(
      row,
      "narration"
    );

    const ledgerName = hasLedgerName
      ? normalizeLedgerName(row.ledgerName)
      : undefined;
    const acceptCredit = hasAcceptCredit
      ? normalizeAcceptCredit(row.acceptCredit)
      : undefined;
    const action = hasAction ? normalizeAction(row.action) : undefined;
    const actionReason = hasActionReason
      ? normalizeActionReason(row.actionReason)
      : undefined;
    const narration = hasNarration
      ? normalizeNarration(row.narration)
      : undefined;

    if (!hasLedgerName && !hasAcceptCredit && !hasAction && !hasActionReason && !hasNarration) {
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(row, "slNo") &&
      row.slNo !== null &&
      row.slNo !== undefined
    ) {
      const slKey = Number(row.slNo);
      if (!Number.isNaN(slKey)) {
        bySlNo.set(slKey, { ledgerName, acceptCredit, action, actionReason, narration });
        return;
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(row, "index") &&
      row.index !== null &&
      row.index !== undefined
    ) {
      const idxKey = Number(row.index);
      if (!Number.isNaN(idxKey)) {
        byIndex.set(idxKey, { ledgerName, acceptCredit, action, actionReason, narration });
      }
    }
  });

  return { bySlNo, byIndex };
};

const getRowSourceKey = (row, fallbackIndex) => {
  if (
    row?._sourceRowId !== undefined &&
    row?._sourceRowId !== null
  ) {
    return `src:${row._sourceRowId}`;
  }
  if (
    Object.prototype.hasOwnProperty.call(row || {}, "slNo") &&
    row?.slNo !== null &&
    row?.slNo !== undefined
  ) {
    const slKey = Number(row.slNo);
    if (!Number.isNaN(slKey)) {
      return `sl:${slKey}`;
    }
  }
  if (fallbackIndex !== undefined && fallbackIndex !== null) {
    return `idx:${fallbackIndex}`;
  }
  return null;
};

const applyLedgerUpdatesToCollection = (
  rows = [],
  { bySlNo, byIndex } = {}
) => {
  if (!rows.length) {
    return { rows, changed: false, changedEntries: [] };
  }

  let changed = false;
  const changedEntries = [];

  const nextRows = rows.map((row, idx) => {
    const slKey = Number(row?.slNo);
    let nextValue;
    if (!Number.isNaN(slKey) && bySlNo?.has(slKey)) {
      nextValue = bySlNo.get(slKey);
    } else if (byIndex?.has(idx)) {
      nextValue = byIndex.get(idx);
    } else {
      return row;
    }

    const targetLedger =
      nextValue &&
      Object.prototype.hasOwnProperty.call(nextValue, "ledgerName")
        ? nextValue.ledgerName ?? null
        : undefined;
    const targetAccept =
      nextValue &&
      Object.prototype.hasOwnProperty.call(nextValue, "acceptCredit")
        ? nextValue.acceptCredit ?? null
        : undefined;
    const targetAction =
      nextValue && Object.prototype.hasOwnProperty.call(nextValue, "action")
        ? nextValue.action ?? null
        : undefined;
    const targetActionReason =
      nextValue &&
      Object.prototype.hasOwnProperty.call(nextValue, "actionReason")
        ? nextValue.actionReason ?? null
        : undefined;
    const targetNarration =
      nextValue &&
      Object.prototype.hasOwnProperty.call(nextValue, "narration")
        ? nextValue.narration ?? null
        : undefined;

    let rowChanged = false;
    let updatedRow = row;

    if (targetLedger !== undefined) {
      if ((row?.["Ledger Name"] ?? null) !== targetLedger) {
        updatedRow = {
          ...updatedRow,
          "Ledger Name": targetLedger,
        };
        rowChanged = true;
      }
    }

    if (targetAccept !== undefined) {
      if ((row?.["Accept Credit"] ?? null) !== targetAccept) {
        updatedRow = {
          ...updatedRow,
          "Accept Credit": targetAccept,
        };
        rowChanged = true;
      }
    }

    if (targetAction !== undefined) {
      if ((row?.Action ?? null) !== targetAction) {
        updatedRow = {
          ...updatedRow,
          Action: targetAction,
        };
        rowChanged = true;
      }
    }

    if (targetActionReason !== undefined) {
      if ((row?.["Action Reason"] ?? null) !== targetActionReason) {
        updatedRow = {
          ...updatedRow,
          "Action Reason": targetActionReason,
        };
        rowChanged = true;
      }
    }

    if (targetNarration !== undefined) {
      if ((row?.["Narration"] ?? null) !== targetNarration) {
        updatedRow = {
          ...updatedRow,
          "Narration": targetNarration,
        };
        rowChanged = true;
      }
    }

    if (!rowChanged) {
      return row;
    }

    changed = true;
    changedEntries.push({
      sourceKey: getRowSourceKey(updatedRow, idx),
      ledgerName: targetLedger,
      acceptCredit: targetAccept,
      action: targetAction,
      actionReason: targetActionReason,
      narration: targetNarration,
    });
    return updatedRow;
  });

  return { rows: nextRows, changed, changedEntries };
};

const applyChangesToProcessed = (processedRows = [], changedEntries = []) => {
  if (!changedEntries.length || !processedRows.length) {
    return { rows: processedRows, changed: false };
  }

  const indexMap = new Map();
  processedRows.forEach((row, idx) => {
    const key = getRowSourceKey(row, idx);
    if (key) {
      indexMap.set(key, idx);
    }
  });

  let changed = false;
  const nextRows = [...processedRows];

  changedEntries.forEach(
    ({ sourceKey, ledgerName, acceptCredit: acceptCreditValue, action, actionReason, narration }) => {
      if (!sourceKey || !indexMap.has(sourceKey)) return;
      const targetIdx = indexMap.get(sourceKey);
      const current = nextRows[targetIdx];
      if (!current) return;
      const normalizedLedger = normalizeLedgerName(ledgerName);
      const normalizedAccept = normalizeAcceptCredit(acceptCreditValue);
      const normalizedAction = normalizeAction(action);

      let rowChanged = false;
      let updatedRow = current;

      if (ledgerName !== undefined) {
        if (
          (current?.["Ledger Name"] ?? null) !== (normalizedLedger ?? null)
        ) {
          updatedRow = {
            ...updatedRow,
            "Ledger Name": normalizedLedger ?? null,
          };
          rowChanged = true;
        }
      }

      if (acceptCreditValue !== undefined) {
        if (
          (current?.["Accept Credit"] ?? null) !== (normalizedAccept ?? null)
        ) {
          updatedRow = {
            ...updatedRow,
            "Accept Credit": normalizedAccept ?? null,
          };
          rowChanged = true;
        }
      }

      if (action !== undefined) {
        if ((current?.Action ?? null) !== (normalizedAction ?? null)) {
          updatedRow = {
            ...updatedRow,
            Action: normalizedAction ?? null,
          };
          rowChanged = true;
        }
      }

      if (actionReason !== undefined) {
        const normalizedActionReason = normalizeActionReason(actionReason);
        if (
          (current?.["Action Reason"] ?? null) !==
          (normalizedActionReason ?? null)
        ) {
          updatedRow = {
            ...updatedRow,
            "Action Reason": normalizedActionReason ?? null,
          };
          rowChanged = true;
        }
      }

      if (narration !== undefined) {
        const normalizedNarration = normalizeNarration(narration);
        if (
          (current?.["Narration"] ?? null) !==
          (normalizedNarration ?? null)
        ) {
          updatedRow = {
            ...updatedRow,
            "Narration": normalizedNarration ?? null,
          };
          rowChanged = true;
        }
      }

      if (rowChanged) {
        nextRows[targetIdx] = updatedRow;
        changed = true;
      }
    }
  );

  return { rows: nextRows, changed };
};

const syncCollectionFromProcessed = (processedRows = [], targetRows = []) => {
  if (!Array.isArray(targetRows) || !targetRows.length) return targetRows;

  const processedMap = new Map();
  processedRows.forEach((row, idx) => {
    const key = getRowSourceKey(row, idx);
    if (key) {
      processedMap.set(key, {
        ledgerName: row?.["Ledger Name"] ?? null,
        acceptCredit: row?.["Accept Credit"] ?? null,
        action: row?.Action ?? null,
        actionReason: row?.["Action Reason"] ?? null,
        narration: row?.["Narration"] ?? null,
      });
    }
  });

  let changed = false;
  const nextRows = targetRows.map((row, idx) => {
    const key = getRowSourceKey(row, idx);
    if (!key || !processedMap.has(key)) {
      return row;
    }
    const source = processedMap.get(key);
    const currentLedger = row?.["Ledger Name"] ?? null;
    const currentAccept = row?.["Accept Credit"] ?? null;
    const currentAction = row?.Action ?? null;
    const currentActionReason = row?.["Action Reason"] ?? null;
    const currentNarration = row?.["Narration"] ?? null;
    let rowChanged = false;
    let updatedRow = row;

    if (currentLedger !== source.ledgerName) {
      updatedRow = {
        ...updatedRow,
        "Ledger Name": source.ledgerName,
      };
      rowChanged = true;
    }

    if (source.acceptCredit !== undefined) {
      if (currentAccept !== source.acceptCredit) {
        updatedRow = {
          ...updatedRow,
          "Accept Credit": source.acceptCredit,
        };
        rowChanged = true;
      }
    }

    if (source.action !== undefined) {
      if (currentAction !== source.action) {
        updatedRow = {
          ...updatedRow,
          Action: source.action,
        };
        rowChanged = true;
      }
    }

    if (source.actionReason !== undefined) {
      if (currentActionReason !== source.actionReason) {
        updatedRow = {
          ...updatedRow,
          "Action Reason": source.actionReason,
        };
        rowChanged = true;
      }
    }

    if (source.narration !== undefined) {
      if (currentNarration !== source.narration) {
        updatedRow = {
          ...updatedRow,
          "Narration": source.narration,
        };
        rowChanged = true;
      }
    }

    if (rowChanged) {
      changed = true;
      return updatedRow;
    }
    return row;
  });

  return changed ? nextRows : targetRows;
};

const buildDisallowSnapshot = (processedRows = []) =>
  renumberRows(
    processedRows
      .filter((row) =>
        isDisallowLedger(normalizeLedgerName(row?.["Ledger Name"]))
      )
      .map((row) => ({ ...row }))
  );

const syncDerivedCollections = (
  processedRows,
  target,
  overrides = {}
) => {
  const reverseSource =
    overrides.reverseChargeRows ?? target.reverseChargeRows ?? [];
  const mismatchedSource =
    overrides.mismatchedRows ?? target.mismatchedRows ?? [];

  const syncedReverseChargeRows = renumberRows(
    syncCollectionFromProcessed(processedRows, reverseSource)
  );
  const syncedMismatchedRows = renumberRows(
    syncCollectionFromProcessed(processedRows, mismatchedSource)
  );
  const disallowRows = buildDisallowSnapshot(processedRows);

  return {
    reverseChargeRows: syncedReverseChargeRows,
    mismatchedRows: syncedMismatchedRows,
    disallowRows,
  };
};

export const updateLedgerNames = async (id, rows = []) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const index = entries.findIndex((entry) => entry._id === id);
    if (index === -1) {
      return { nextData: entries, result: null, skipWrite: true };
    }

    const target = entries[index] || {};
    const processedRows = Array.isArray(target.processedRows)
      ? target.processedRows
      : [];

    const updateMaps = buildUpdateMaps(rows);
    if (!updateMaps.bySlNo.size && !updateMaps.byIndex.size) {
      return { nextData: entries, result: target, skipWrite: true };
    }

    const {
      rows: nextProcessedRows,
      changed,
    } = applyLedgerUpdatesToCollection(processedRows, updateMaps);

    if (!changed) {
      return { nextData: entries, result: target, skipWrite: true };
    }

    const normalizedProcessedRows = renumberRows(nextProcessedRows);
    const syncedCollections = syncDerivedCollections(
      normalizedProcessedRows,
      target
    );

    const updated = {
      ...target,
      processedRows: normalizedProcessedRows,
      ...syncedCollections,
      updatedAt: new Date().toISOString(),
    };

    const nextData = [...entries];
    nextData[index] = updated;
    return { nextData, result: updated };
  });

export const updateReverseChargeLedgerNames = async (id, rows = []) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const index = entries.findIndex((entry) => entry._id === id);
    if (index === -1) {
      return { nextData: entries, result: null, skipWrite: true };
    }

    const target = entries[index] || {};
    const reverseChargeRows = Array.isArray(target.reverseChargeRows)
      ? target.reverseChargeRows
      : [];
    const processedRows = Array.isArray(target.processedRows)
      ? target.processedRows
      : [];

    if (!reverseChargeRows.length) {
      console.warn(
        `No reverse charge rows found for document ${id}. Cannot update ledger names.`
      );
      return { nextData: entries, result: target, skipWrite: true };
    }

    const updateMaps = buildUpdateMaps(rows);
    if (!updateMaps.bySlNo.size && !updateMaps.byIndex.size) {
      console.warn(
        `No matching rows found for reverse charge ledger name update. Payload rows:`,
        rows
      );
      return { nextData: entries, result: target, skipWrite: true };
    }

    const {
      rows: nextReverseChargeRows,
      changed: reverseChanged,
      changedEntries,
    } = applyLedgerUpdatesToCollection(reverseChargeRows, updateMaps);

    if (!reverseChanged && !changedEntries.length) {
      console.warn(
        "No changes detected in reverse charge rows after update attempt."
      );
      return { nextData: entries, result: target, skipWrite: true };
    }

    const {
      rows: processedWithMirrors,
      changed: processedChanged,
    } = applyChangesToProcessed(processedRows, changedEntries);

    const normalizedProcessedRows = renumberRows(
      processedChanged ? processedWithMirrors : processedRows
    );

    const syncedCollections = syncDerivedCollections(
      normalizedProcessedRows,
      target,
      { reverseChargeRows: nextReverseChargeRows }
    );

    const updated = {
      ...target,
      processedRows: normalizedProcessedRows,
      ...syncedCollections,
      updatedAt: new Date().toISOString(),
    };

    const nextData = [...entries];
    nextData[index] = updated;
    return { nextData, result: updated };
  });

export const updateMismatchedLedgerNames = async (id, rows = []) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const index = entries.findIndex((entry) => entry._id === id);
    if (index === -1) {
      return { nextData: entries, result: null, skipWrite: true };
    }

    const target = entries[index] || {};
    const mismatchedRows = Array.isArray(target.mismatchedRows)
      ? target.mismatchedRows
      : [];
    const processedRows = Array.isArray(target.processedRows)
      ? target.processedRows
      : [];

    if (!mismatchedRows.length) {
      console.warn(
        `No mismatched rows found for document ${id}. Cannot update ledger names.`
      );
      return { nextData: entries, result: target, skipWrite: true };
    }

    const updateMaps = buildUpdateMaps(rows);
    if (!updateMaps.bySlNo.size && !updateMaps.byIndex.size) {
      return { nextData: entries, result: target, skipWrite: true };
    }

    const {
      rows: nextMismatchedRows,
      changed,
      changedEntries,
    } = applyLedgerUpdatesToCollection(mismatchedRows, updateMaps);

    if (!changed && !changedEntries.length) {
      return { nextData: entries, result: target, skipWrite: true };
    }

    const {
      rows: processedWithMirrors,
      changed: processedChanged,
    } = applyChangesToProcessed(processedRows, changedEntries);

    const normalizedProcessedRows = renumberRows(
      processedChanged ? processedWithMirrors : processedRows
    );

    const syncedCollections = syncDerivedCollections(
      normalizedProcessedRows,
      target,
      { mismatchedRows: nextMismatchedRows }
    );

    const updated = {
      ...target,
      processedRows: normalizedProcessedRows,
      ...syncedCollections,
      updatedAt: new Date().toISOString(),
    };

    const nextData = [...entries];
    nextData[index] = updated;
    return { nextData, result: updated };
  });

export const updateDisallowLedgerNames = async (id, rows = []) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const index = entries.findIndex((entry) => entry._id === id);
    if (index === -1) {
      return { nextData: entries, result: null, skipWrite: true };
    }

    const target = entries[index] || {};
    const processedRows = Array.isArray(target.processedRows)
      ? target.processedRows
      : [];
    const storedDisallowRows = Array.isArray(target.disallowRows)
      ? target.disallowRows
      : [];
    const effectiveDisallowRows =
      storedDisallowRows.length > 0
        ? storedDisallowRows
        : buildDisallowSnapshot(processedRows);

    if (!effectiveDisallowRows.length) {
      console.warn(
        `No disallow rows found for document ${id}. Cannot update ledger names.`
      );
      return { nextData: entries, result: target, skipWrite: true };
    }

    const updateMaps = buildUpdateMaps(rows);
    if (!updateMaps.bySlNo.size && !updateMaps.byIndex.size) {
      return { nextData: entries, result: target, skipWrite: true };
    }

    const {
      rows: nextDisallowRows,
      changed,
      changedEntries,
    } = applyLedgerUpdatesToCollection(effectiveDisallowRows, updateMaps);

    if (!changed && !changedEntries.length) {
      return { nextData: entries, result: target, skipWrite: true };
    }

    const {
      rows: processedWithMirrors,
      changed: processedChanged,
    } = applyChangesToProcessed(processedRows, changedEntries);

    const normalizedProcessedRows = renumberRows(
      processedChanged ? processedWithMirrors : processedRows
    );

    const syncedCollections = syncDerivedCollections(
      normalizedProcessedRows,
      target
    );

    const updated = {
      ...target,
      processedRows: normalizedProcessedRows,
      ...syncedCollections,
      updatedAt: new Date().toISOString(),
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

export const tallyWithGstr2A = async (id, gstr2aProcessedRows = []) =>
  mutateCollection(COLLECTION_KEY, (entries) => {
    const index = entries.findIndex((entry) => entry._id === id);
    if (index === -1) {
      return { nextData: entries, result: null, skipWrite: true };
    }

    const target = entries[index] || {};
    const processedRows = Array.isArray(target.processedRows)
      ? target.processedRows
      : [];
    const reverseChargeRows = Array.isArray(target.reverseChargeRows)
      ? target.reverseChargeRows
      : [];
    const mismatchedRows = Array.isArray(target.mismatchedRows)
      ? target.mismatchedRows
      : [];
    const disallowRows = Array.isArray(target.disallowRows)
      ? target.disallowRows
      : [];

    // Build normalized vchNo set from GSTR-2A
    const vchSet = new Set(
      (gstr2aProcessedRows || [])
        .map((row) => String(row?.vchNo || "").trim().toUpperCase())
        .filter((v) => v)
    );

    if (!vchSet.size) {
      return { nextData: entries, result: target, skipWrite: true };
    }

    const shouldKeep = (row) => {
      const key = String(row?.vchNo || "").trim().toUpperCase();
      if (!key) return true;
      return !vchSet.has(key);
    };

    const filtered = processedRows.filter(shouldKeep);
    const filteredReverse = reverseChargeRows.filter(shouldKeep);
    const filteredMismatched = mismatchedRows.filter(shouldKeep);
    const filteredDisallow = disallowRows.filter(shouldKeep);

    const normalizedProcessedRows = renumberRows(filtered);
    const syncedCollections = syncDerivedCollections(normalizedProcessedRows, target, {
      reverseChargeRows: renumberRows(filteredReverse),
      mismatchedRows: renumberRows(filteredMismatched),
      disallowRows: renumberRows(filteredDisallow),
    });

    const updated = {
      ...target,
      processedRows: normalizedProcessedRows,
      ...syncedCollections,
      updatedAt: new Date().toISOString(),
    };

    const nextData = [...entries];
    nextData[index] = updated;
    return { nextData, result: updated };
  });

