import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateProcessedLedgerNames } from "../services/gstr2bservice";

const defaultRowKeyFn = (row, index) =>
  String(row?._id ?? row?.slNo ?? index ?? 0);

const normalizeValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") return value;
  return String(value);
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const useLedgerNameEditing = ({
  rows = [],
  importId,
  getRowKey = defaultRowKeyFn,
  onUpdated,
  updateFunction, // Optional custom update function
  rowsKey = "processedRows", // Key to get rows from updated response
  getRowPayload,
}) => {
  const [inputs, setInputs] = useState({});
  const [dirtyRows, setDirtyRows] = useState(new Set());
  const [extraDirtyRows, setExtraDirtyRows] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [savedMap, setSavedMap] = useState({});
  const savedMapRef = useRef(savedMap);

  const rowMeta = useMemo(() => {
    const meta = {};
    rows.forEach((row, idx) => {
      meta[getRowKey(row, idx)] = {
        slNo:
          row?.slNo !== undefined && row?.slNo !== null ? row.slNo : undefined,
        index: idx,
        row,
      };
    });
    return meta;
  }, [rows, getRowKey]);

  useEffect(() => {
    const initialInputs = {};
    rows.forEach((row, idx) => {
      initialInputs[getRowKey(row, idx)] = normalizeValue(row?.["Ledger Name"] ?? "");
    });
    setInputs(initialInputs);
    setSavedMap(initialInputs);
    savedMapRef.current = initialInputs;
    setDirtyRows(new Set());
    setExtraDirtyRows(new Set());
  }, [rows, getRowKey]);

  useEffect(() => {
    savedMapRef.current = savedMap;
  }, [savedMap]);

  const handleChange = useCallback((rowKey, value) => {
    setInputs((prev) => ({
      ...prev,
      [rowKey]: value,
    }));
    setDirtyRows((prev) => {
      const next = new Set(prev);
      const savedValue = normalizeValue(savedMapRef.current[rowKey] ?? "");
      if (normalizeValue(value ?? "") === savedValue) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }, []);

  const setExtraRowDirtyState = useCallback((rowKey, isDirty) => {
    setExtraDirtyRows((prev) => {
      const next = new Set(prev);
      if (isDirty) {
        next.add(rowKey);
      } else {
        next.delete(rowKey);
      }
      return next;
    });
  }, []);

  const combinedDirtyRows = useMemo(() => {
    const combined = new Set(dirtyRows);
    extraDirtyRows.forEach((key) => combined.add(key));
    return combined;
  }, [dirtyRows, extraDirtyRows]);

  const persistChanges = useCallback(async () => {
    if (!combinedDirtyRows.size || !importId) {
      return null;
    }
    const payloadRows = Array.from(combinedDirtyRows)
      .map((rowKey) => {
        const meta = rowMeta[rowKey];
        if (!meta) return null;
        const extraPayload =
          typeof getRowPayload === "function"
            ? getRowPayload(meta.row, rowKey)
            : {};
        return {
          slNo: meta.slNo,
          index: meta.index,
          ledgerName: trimOrNull(inputs[rowKey]),
          ...extraPayload,
        };
      })
      .filter(Boolean);

    if (!payloadRows.length) {
      setDirtyRows(new Set());
      return null;
    }

    setSaving(true);
    try {
      const updateFn = updateFunction || updateProcessedLedgerNames;
      const response = await updateFn(importId, {
        rows: payloadRows,
      });
      
      if (!response || !response.data) {
        throw new Error("Invalid response from server");
      }
      
      const { data } = response;
      const processed = data?.processed || null;
      
      if (!processed) {
        throw new Error("No processed data returned from server");
      }
      
      if (processed) {
        onUpdated?.(processed);
      }
      
      // Get the correct rows from the response based on rowsKey
      const nextRows = processed?.[rowsKey] || rows;
      
      if (!Array.isArray(nextRows)) {
        console.error("nextRows is not an array:", nextRows, "rowsKey:", rowsKey, "processed:", processed);
        throw new Error(`Invalid rows data returned for ${rowsKey}`);
      }
      
      const refreshedInputs = {};
      nextRows.forEach((row, idx) => {
        refreshedInputs[getRowKey(row, idx)] = normalizeValue(
          row?.["Ledger Name"] ?? ""
        );
      });
      setInputs(refreshedInputs);
      setSavedMap(refreshedInputs);
      savedMapRef.current = refreshedInputs;
      setDirtyRows(new Set());
      setExtraDirtyRows(new Set());
      return processed;
    } catch (error) {
      console.error("Failed to persist ledger changes:", error);
      console.error("Error details:", {
        importId,
        payloadRows,
        rowsKey,
        updateFunction: updateFunction?.name || "default",
        errorMessage: error?.message,
        errorResponse: error?.response?.data,
      });
      throw error; // Re-throw so component can handle it
    } finally {
      setSaving(false);
    }
  }, [
    combinedDirtyRows,
    importId,
    inputs,
    onUpdated,
    rowMeta,
    rows,
    getRowKey,
    updateFunction,
    rowsKey,
    getRowPayload,
  ]);

  return {
    ledgerInputs: inputs,
    handleLedgerInputChange: handleChange,
    dirtyCount: combinedDirtyRows.size,
    persistLedgerChanges: persistChanges,
    savingLedgerChanges: saving,
    setExtraRowDirtyState,
  };
};

export default useLedgerNameEditing;

