import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx-js-style";
import {
  FiAlertCircle,
  FiDownload,
  FiFilePlus,
  FiPlayCircle,
  FiRefreshCw,
  FiUploadCloud,
  FiPlus,
  FiSave,
  FiX,
} from "react-icons/fi";
import { fetchGSTINNumbers } from "../services/gstinnumberservices";
import {
  uploadB2BSheet,
  processGstr2bImport,
  fetchProcessedFile,
  updateReverseChargeLedgerNames,
  updateMismatchedLedgerNames,
  updateDisallowLedgerNames,
  fetchImportById,
  tallyWithGstr2a,
} from "../services/gstr2bservice";
import {
  createLedgerName as createLedgerNameApi,
  fetchLedgerNames,
} from "../services/ledgernameservice";
import { fetchPartyMasters, createPartyMaster } from "../services/partymasterservice";
import {
  fetchImportsByCompany as fetchGstr2AImportsByCompany,
} from "../services/gstr2aservice";
import { gstr2bHeaders } from "../utils/gstr2bHeaders";
import { sanitizeFileName } from "../utils/fileUtils";
import { buildCombinedWorkbook } from "../utils/buildCombinedWorkbook";
import {
  buildActionJsonPayload,
  downloadJsonFile,
} from "../utils/actionJsonBuilder";
import BackButton from "../components/BackButton";
import LedgerNameDropdown from "../components/LedgerNameDropdown";
import useLedgerNameEditing from "../hooks/useLedgerNameEditing";
import { useAuth } from "../context/AuthContext.jsx";
import PlanRestrictionBanner from "../components/PlanRestrictionBanner.jsx";
import { getPlanRestrictionMessage } from "../utils/planAccess.js";

const columnMap = {
  gstin: "gstin",
  tradeName: "tradeName",
  invoiceNumber: "invoiceNumber",
  invoiceType: "invoiceType",
  invoiceDate: "invoiceDate",
  invoiceValue: "invoiceValue",
  placeOfSupply: "placeOfSupply",
  reverseCharge: "reverseCharge",
  taxableValue: "taxableValue",
  integratedTax: "igst",
  centralTax: "cgst",
  stateTax: "sgst",
  cess: "cess",
  gstrPeriod: "gstrPeriod",
  gstrFilingDate: "gstrFilingDate",
  itcAvailability: "itcAvailability",
  reason: "reason",
  taxRatePercent: "taxRatePercent",
  source: "source",
  irn: "irn",
  irnDate: "irnDate",
};

const slabConfig = [
  { slab: "5%", igst: 5, cgst: 2.5, sgst: 2.5 },
  { slab: "12%", igst: 12, cgst: 6, sgst: 6 },
  { slab: "18%", igst: 18, cgst: 9, sgst: 9 },
  { slab: "28%", igst: 28, cgst: 14, sgst: 14 },
];


const outputColumns = [
  "Sr no.",
  "Date",
  "Vch No",
  "VCH Type",
  "Reference No.",
  "Reference Date",
  "Supplier Name",
  "GST Registration Type",
  "GSTIN/UIN",
  "State",
  "Supplier State",
  "Supplier Amount",
  "Supplier Dr/Cr",
  "Ledger Name",
  "Ledger Amount 5%",
  "Ledger amount cr/dr 5%",
  "Ledger Amount 12%",
  "Ledger amount Cr/Dr 12%",
  "Ledger Amount 18%",
  "Ledger amount cr/dr 18%",
  "Ledger Amount 28%",
  "Ledger amount cr/dr 28%",
  "IGST Rate 5%",
  "CGST Rate 5%",
  "SGST/UTGST Rate 5%",
  "IGST Rate 12%",
  "CGST Rate 12%",
  "SGST/UTGST Rate 12%",
  "IGST Rate 18%",
  "CGST Rate 18%",
  "SGST/UTGST Rate 18%",
  "IGST Rate 28%",
  "CGST Rate 28%",
  "SGST/UTGST Rate 28%",
  "GRO Amount",
  "Round Off Dr",
  "Round Off Cr",
  "Invoice Amount",
  "Change Mode",
];

const ledgerKeyMap = {
  "5%": {
    ledgerAmount: "Ledger Amount 5%",
    ledgerCrDr: "Ledger amount cr/dr 5%",
    igst: "IGST Rate 5%",
    cgst: "CGST Rate 5%",
    sgst: "SGST/UTGST Rate 5%",
  },
  "12%": {
    ledgerAmount: "Ledger Amount 12%",
    ledgerCrDr: "Ledger amount Cr/Dr 12%",
    igst: "IGST Rate 12%",
    cgst: "CGST Rate 12%",
    sgst: "SGST/UTGST Rate 12%",
  },
  "18%": {
    ledgerAmount: "Ledger Amount 18%",
    ledgerCrDr: "Ledger amount cr/dr 18%",
    igst: "IGST Rate 18%",
    cgst: "CGST Rate 18%",
    sgst: "SGST/UTGST Rate 18%",
  },
  "28%": {
    ledgerAmount: "Ledger Amount 28%",
    ledgerCrDr: "Ledger amount cr/dr 28%",
    igst: "IGST Rate 28%",
    cgst: "CGST Rate 28%",
    sgst: "SGST/UTGST Rate 28%",
  },
};

const taxKeys = [
  "IGST Rate 5%",
  "CGST Rate 5%",
  "SGST/UTGST Rate 5%",
  "IGST Rate 12%",
  "CGST Rate 12%",
  "SGST/UTGST Rate 12%",
  "IGST Rate 18%",
  "CGST Rate 18%",
  "SGST/UTGST Rate 18%",
  "IGST Rate 28%",
  "CGST Rate 28%",
  "SGST/UTGST Rate 28%",
];

const shouldHideColumn = (key = "") => key.startsWith("_");
const extractVisibleColumns = (row = {}) =>
  Object.keys(row || {}).filter((key) => !shouldHideColumn(key));
const stripMetaFields = (rows = []) =>
  rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => !shouldHideColumn(key))
    );
  });

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
};

const pick = (row, label) => {
  if (!row || !label) return "";
  if (Array.isArray(label)) {
    for (const key of label) {
      if (row[key] !== undefined && row[key] !== null) return row[key];
    }
    return "";
  }
  return row[label] ?? "";
};

const SUPPLIER_NAME_KEYS = [
  "Supplier Name",
  "supplierName",
  "supplier name",
  "Supplier",
  "Supplier/Customer Name",
  "Party Name",
  "Party",
  "Vendor Name",
  "Trade Name",
  "tradeName",
];

const getNormalizedSupplierName = (row = {}) => {
  for (const key of SUPPLIER_NAME_KEYS) {
    if (!row || typeof row !== "object") continue;
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;
    const trimmed = String(value).trim();
    if (!trimmed) continue;
    return {
      normalized: trimmed.toLowerCase(),
      original: trimmed,
    };
  }
  return {
    normalized: "",
    original: "",
  };
};

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toISOString().split("T")[0];
};

const toDisplayValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return String(value);
};

// Disallow ledger names that should be separated into a disallow sheet
// Any ledger name containing "[disallow]" (case-insensitive) will be treated as disallow
// Function to filter rows with disallow ledger names
const filterDisallowRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    const ledgerName = String(row?.["Ledger Name"] || "").trim().toLowerCase();
    return ledgerName.includes("[disallow]");
  });
};

const ACTION_OPTIONS = ["Accept", "Reject", "Pending"];

function normalizeAcceptCreditValue(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "yes" || lower === "y") return "Yes";
  if (lower === "no" || lower === "n") return "No";
  return null;
}

function normalizeActionValue(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "accept") return "Accept";
  if (lower === "reject") return "Reject";
  if (lower === "pending") return "Pending";
  return null;
}

const CompanyProcessor = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const company = location.state?.company;
  const { user, isPlanRestricted } = useAuth();
  const readOnly = !user?.isMaster && isPlanRestricted;
  const readOnlyMessage = readOnly
    ? getPlanRestrictionMessage(user?.planStatus)
    : "";

  const [sheetRows, setSheetRows] = useState([]);
  const [generatedRows, setGeneratedRows] = useState([]);
  const [fileMeta, setFileMeta] = useState({ name: "" });
  const [status, setStatus] = useState({ type: "", message: "" });
  const [gstStateMap, setGstStateMap] = useState({});
  const [loadingGST, setLoadingGST] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [importId, setImportId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processedDoc, setProcessedDoc] = useState(null);
  const [downloadsUnlocked, setDownloadsUnlocked] = useState(false);
  const [ledgerNames, setLedgerNames] = useState([]);
  const [ledgerNamesLoading, setLedgerNamesLoading] = useState(false);
  const [addLedgerModal, setAddLedgerModal] = useState({
    open: false,
    value: "",
    submitting: false,
  });
  const [partyMasters, setPartyMasters] = useState([]);
  const [partyMastersLoading, setPartyMastersLoading] = useState(false);
  const [missingSuppliers, setMissingSuppliers] = useState([]);
  const [missingSelection, setMissingSelection] = useState(new Set());
  const [ledgerPropagationSelections, setLedgerPropagationSelections] = useState(
    {}
  );
  const [actionPropagationSelections, setActionPropagationSelections] = useState(
    {}
  );
  const [acceptCreditDrafts, setAcceptCreditDrafts] = useState({});
  const [actionDrafts, setActionDrafts] = useState({});
  const [actionReasonDrafts, setActionReasonDrafts] = useState({});
  const [narrationDrafts, setNarrationDrafts] = useState({});
  const [tallyModal, setTallyModal] = useState({
    open: false,
    loading: false,
    options: [],
    selectedId: "",
    submitting: false,
    error: "",
  });
  const getRowKey = useCallback(
    (row, index) => String(row?._id ?? row?.slNo ?? index),
    []
  );

  const originalRowsCache = useRef({});
  const importDocCache = useRef({});

  const [activeTab, setActiveTab] = useState("processed"); // "processed" or "reverseCharge"

  const buildDownloadFilename = useCallback(
    (type, overrideName) => {
      const baseName = sanitizeFileName(
        overrideName ||
          processedDoc?.company ||
          company?.companyName ||
          "company"
      );
      const now = new Date();
      const month = now.toLocaleString("en-US", { month: "short" });
      const year = now.getFullYear();
      return `${baseName}-${type}-${month}-${year}`;
    },
    [company, processedDoc]
  );

  const getMissingKey = useCallback(
    (supplier, index) =>
      (supplier?.gstin || "").trim().toUpperCase() || `${supplier?.supplierName || "supplier"}-${index}`,
    [],
  );

  const toggleMissingSelection = (key) => {
    setMissingSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleMissingSelectAll = (checked) => {
    if (!missingSuppliers.length) {
      setMissingSelection(new Set());
      return;
    }
    if (!checked) {
      setMissingSelection(new Set());
      return;
    }
    const allKeys = missingSuppliers.map((supplier, idx) =>
      getMissingKey(supplier, idx),
    );
    setMissingSelection(new Set(allKeys));
  };

  const allMissingSelected =
    missingSuppliers.length > 0 &&
    missingSelection.size === missingSuppliers.length;

  const handleSaveMissingSuppliers = async () => {
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    if (!company?._id) {
      setStatus({ type: "error", message: "Company information missing." });
      return;
    }
    if (!missingSuppliers.length) {
      setStatus({
        type: "error",
        message: "No missing suppliers to save.",
      });
      return;
    }
    const selected = missingSuppliers.filter((supplier, idx) =>
      missingSelection.has(getMissingKey(supplier, idx)),
    );
    if (!selected.length) {
      setStatus({
        type: "error",
        message: "Select at least one supplier to save to Party Master.",
      });
      return;
    }
    try {
      for (const supplier of selected) {
        await createPartyMaster({
          companyId: company._id,
          partyName: supplier.supplierName,
          gstin: supplier.gstin,
        });
      }
      setStatus({
        type: "success",
        message: `Saved ${selected.length} supplier(s) to Party Master.`,
      });
      await loadPartyMasters();
    } catch (error) {
      console.error("Failed to save missing suppliers:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to save suppliers to Party Master.",
      });
    }
  };

  const handleDownloadMissingSuppliers = () => {
    if (!missingSuppliers.length) {
      setStatus({
        type: "error",
        message: "No missing suppliers to download.",
      });
      return;
    }
    const rows = missingSuppliers.map((s) => ({
      Supplier: s.supplierName,
      GSTIN: s.gstin,
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Missing Suppliers");
    const filename = `${buildDownloadFilename(
      "MissingSuppliers",
      company?.companyName,
    )}.xlsx`;
    XLSX.writeFile(workbook, filename);
    setStatus({
      type: "success",
      message: "Missing suppliers list downloaded.",
    });
  };

  const processedRows = useMemo(
    () => processedDoc?.processedRows || [],
    [processedDoc]
  );
  const reverseChargeRows = useMemo(
    () => processedDoc?.reverseChargeRows || [],
    [processedDoc]
  );
  const mismatchedRows = useMemo(
    () => processedDoc?.mismatchedRows || [],
    [processedDoc]
  );
  const disallowRows = useMemo(() => {
    if (!processedDoc) return [];
    if (processedDoc.disallowRows?.length) return processedDoc.disallowRows;
    return filterDisallowRows(processedDoc.processedRows || []);
  }, [processedDoc]);
  const processedColumns = useMemo(
    () => (processedRows[0] ? extractVisibleColumns(processedRows[0]) : []),
    [processedRows]
  );
  const reverseChargeColumns = useMemo(
    () =>
      reverseChargeRows[0]
        ? extractVisibleColumns(reverseChargeRows[0])
        : [],
    [reverseChargeRows]
  );
  const mismatchedColumns = useMemo(
    () =>
      mismatchedRows[0] ? extractVisibleColumns(mismatchedRows[0]) : [],
    [mismatchedRows]
  );
  const mismatchedColumnsWithAccept = useMemo(() => {
    const base = [...mismatchedColumns];
    if (!base.includes("Accept Credit")) {
      base.push("Accept Credit");
    }
    return base;
  }, [mismatchedColumns]);
  const disallowColumns = useMemo(
    () =>
      disallowRows[0] ? extractVisibleColumns(disallowRows[0]) : [],
    [disallowRows]
  );
  const hasProcessedRows = processedRows.length > 0;
  const hasReverseChargeRows = reverseChargeRows.length > 0;
  const hasMismatchedRows = mismatchedRows.length > 0;
  const hasDisallowRows = disallowRows.length > 0;

  const buildRowMap = useCallback(
    (rows = []) => {
      const map = new Map();
      rows.forEach((row, idx) => {
        map.set(getRowKey(row, idx), row);
      });
      return map;
    },
    [getRowKey]
  );

  const processedRowMap = useMemo(
    () => buildRowMap(processedRows),
    [buildRowMap, processedRows]
  );
  const reverseChargeRowMap = useMemo(
    () => buildRowMap(reverseChargeRows),
    [buildRowMap, reverseChargeRows]
  );
  const mismatchedRowMap = useMemo(
    () => buildRowMap(mismatchedRows),
    [buildRowMap, mismatchedRows]
  );
  const disallowRowMap = useMemo(
    () => buildRowMap(disallowRows),
    [buildRowMap, disallowRows]
  );

  const getActionValueForRow = useCallback(
    (row, rowKey) => {
      const hasDraft = Object.prototype.hasOwnProperty.call(
        actionDrafts,
        rowKey
      );
      const draftValue = hasDraft ? actionDrafts[rowKey] : undefined;
      const sourceValue =
        draftValue !== undefined ? draftValue : row?.Action ?? "";
      return normalizeActionValue(sourceValue);
    },
    [actionDrafts]
  );

  const isActionDirtyForRow = useCallback(
    (rowKey, rowMap) => {
      const baseRow = rowMap?.get(rowKey);
      const baseValue = normalizeActionValue(baseRow?.Action ?? "");
      const hasDraft = Object.prototype.hasOwnProperty.call(
        actionDrafts,
        rowKey
      );
      if (!hasDraft) {
        return false;
      }
      const draftValue = actionDrafts[rowKey];
      return draftValue !== baseValue;
    },
    [actionDrafts]
  );


  const isAcceptDirtyForRow = useCallback(
    (rowKey) => {
      const baseRow = mismatchedRowMap.get(rowKey);
      const baseValue = normalizeAcceptCreditValue(
        baseRow?.["Accept Credit"] ?? ""
      );
      const hasDraft = Object.prototype.hasOwnProperty.call(
        acceptCreditDrafts,
        rowKey
      );
      if (!hasDraft) {
        return false;
      }
      const draftValue = acceptCreditDrafts[rowKey];
      return draftValue !== baseValue;
    },
    [mismatchedRowMap, acceptCreditDrafts, normalizeAcceptCreditValue]
  );

  const clearActionDraftsForRows = useCallback(
    (rows = []) => {
      setActionDrafts((prev) => {
        if (!rows.length) return prev;
        const next = { ...prev };
        rows.forEach((row, idx) => {
          const key = getRowKey(row, idx);
          if (Object.prototype.hasOwnProperty.call(next, key)) {
            delete next[key];
          }
        });
        return next;
      });
    },
    [getRowKey]
  );

  const handleLedgerPropagationToggle = useCallback(
    ({
      checked,
      rowIdx,
      rows,
      sourceRow,
      ledgerValue,
      handleChange,
      tabKey,
      rowKey,
    }) => {
      const stateKey = `${tabKey}-${rowKey}`;

      if (!checked) {
        setLedgerPropagationSelections((prev) => {
          if (!prev[stateKey]) return prev;
          const next = { ...prev };
          delete next[stateKey];
          return next;
        });
        return;
      }

      const trimmedLedger = String(ledgerValue ?? "").trim();
      if (!trimmedLedger) {
        setStatus({
          type: "error",
          message: "Select a ledger name before applying it to other rows.",
        });
        return;
      }

      const { normalized: sourceSupplierNormalized, original: sourceSupplier } =
        getNormalizedSupplierName(sourceRow);
      if (!sourceSupplierNormalized) {
        setStatus({
          type: "error",
          message:
            "Supplier name missing for this row, nothing to match against.",
        });
        return;
      }

      let appliedCount = 0;
      for (let idx = rowIdx + 1; idx < rows.length; idx += 1) {
        const targetRow = rows[idx];
        const {
          normalized: candidateSupplierNormalized,
        } = getNormalizedSupplierName(targetRow);
        if (
          candidateSupplierNormalized &&
          candidateSupplierNormalized === sourceSupplierNormalized
        ) {
          const targetRowKey = getRowKey(targetRow, idx);
          handleChange(targetRowKey, trimmedLedger);
          appliedCount += 1;
        }
      }

      setLedgerPropagationSelections((prev) => ({
        ...prev,
        [stateKey]: {
          ledger: trimmedLedger,
          supplier: sourceSupplier,
          matches: appliedCount,
          appliedAt: Date.now(),
        },
      }));

      setStatus({
        type: appliedCount ? "success" : "info",
        message: appliedCount
          ? `Applied ledger to ${appliedCount} matching row${
              appliedCount > 1 ? "s" : ""
            }.`
          : "No later rows found with the same supplier name.",
      });
    },
    [getRowKey, setStatus, setLedgerPropagationSelections]
  );

  const {
    ledgerInputs: processedLedgerInputs,
    handleLedgerInputChange: handleProcessedLedgerInputChange,
    dirtyCount: processedLedgerDirtyCount,
    persistLedgerChanges: persistProcessedLedgerChanges,
    savingLedgerChanges: savingProcessedLedgerChanges,
    setExtraRowDirtyState: setProcessedExtraDirtyState,
  } = useLedgerNameEditing({
    rows: processedRows,
    importId,
    getRowKey,
    getRowPayload: (row, rowKey) => {
      const payload = {
        action: getActionValueForRow(row, rowKey),
      };
      // Add Action Reason if Action is Reject or Pending
      const actionValue = getActionValueForRow(row, rowKey);
      if (actionValue === "Reject" || actionValue === "Pending") {
        const hasDraft = Object.prototype.hasOwnProperty.call(
          actionReasonDrafts,
          rowKey
        );
        const draftValue = hasDraft ? actionReasonDrafts[rowKey] : undefined;
        const sourceValue =
          draftValue !== undefined ? draftValue : row?.["Action Reason"] ?? "";
        payload.actionReason = sourceValue || null;
      }
      // Add Narration
      const hasNarrationDraft = Object.prototype.hasOwnProperty.call(
        narrationDrafts,
        rowKey
      );
      const narrationDraftValue = hasNarrationDraft ? narrationDrafts[rowKey] : undefined;
      const narrationSourceValue =
        narrationDraftValue !== undefined ? narrationDraftValue : row?.["Narration"] ?? "";
      payload.narration = narrationSourceValue || null;
      return payload;
    },
    onUpdated: (updated) => {
      if (updated) {
        setProcessedDoc(updated);
      }
    },
  });

  const {
    ledgerInputs: reverseChargeLedgerInputs,
    handleLedgerInputChange: handleReverseChargeLedgerInputChange,
    dirtyCount: reverseChargeLedgerDirtyCount,
    persistLedgerChanges: persistReverseChargeLedgerChanges,
    savingLedgerChanges: savingReverseChargeLedgerChanges,
    setExtraRowDirtyState: setReverseChargeExtraDirtyState,
  } = useLedgerNameEditing({
    rows: reverseChargeRows,
    importId,
    getRowKey,
    updateFunction: updateReverseChargeLedgerNames,
    rowsKey: "reverseChargeRows",
    getRowPayload: (row, rowKey) => {
      const payload = {
        action: getActionValueForRow(row, rowKey),
      };
      // Add Action Reason if Action is Reject or Pending
      const actionValue = getActionValueForRow(row, rowKey);
      if (actionValue === "Reject" || actionValue === "Pending") {
        const hasDraft = Object.prototype.hasOwnProperty.call(
          actionReasonDrafts,
          rowKey
        );
        const draftValue = hasDraft ? actionReasonDrafts[rowKey] : undefined;
        const sourceValue =
          draftValue !== undefined ? draftValue : row?.["Action Reason"] ?? "";
        payload.actionReason = sourceValue || null;
      }
      // Add Narration
      const hasNarrationDraft = Object.prototype.hasOwnProperty.call(
        narrationDrafts,
        rowKey
      );
      const narrationDraftValue = hasNarrationDraft ? narrationDrafts[rowKey] : undefined;
      const narrationSourceValue =
        narrationDraftValue !== undefined ? narrationDraftValue : row?.["Narration"] ?? "";
      payload.narration = narrationSourceValue || null;
      return payload;
    },
    onUpdated: (updated) => {
      if (updated) {
        setProcessedDoc(updated);
      }
    },
  });

  const {
    ledgerInputs: mismatchedLedgerInputs,
    handleLedgerInputChange: handleMismatchedLedgerInputChange,
    dirtyCount: mismatchedLedgerDirtyCount,
    persistLedgerChanges: persistMismatchedLedgerChanges,
    savingLedgerChanges: savingMismatchedLedgerChanges,
    setExtraRowDirtyState: setMismatchedAcceptDirtyState,
  } = useLedgerNameEditing({
    rows: mismatchedRows,
    importId,
    getRowKey,
    updateFunction: updateMismatchedLedgerNames,
    rowsKey: "mismatchedRows",
    getRowPayload: (row, rowKey) => {
      if (!row) return {};
      const payload = {
        action: getActionValueForRow(row, rowKey),
      };
      // Add Action Reason if Action is Reject or Pending
      const actionValue = getActionValueForRow(row, rowKey);
      if (actionValue === "Reject" || actionValue === "Pending") {
        const hasDraft = Object.prototype.hasOwnProperty.call(
          actionReasonDrafts,
          rowKey
        );
        const draftValue = hasDraft ? actionReasonDrafts[rowKey] : undefined;
        const sourceValue =
          draftValue !== undefined ? draftValue : row?.["Action Reason"] ?? "";
        payload.actionReason = sourceValue || null;
      }
      const draftValue =
        Object.prototype.hasOwnProperty.call(acceptCreditDrafts, rowKey)
          ? acceptCreditDrafts[rowKey]
          : undefined;
      const sourceValue =
        draftValue !== undefined ? draftValue : row?.["Accept Credit"] ?? "";
      payload.acceptCredit = normalizeAcceptCreditValue(sourceValue);
      // Add Narration
      const hasNarrationDraft = Object.prototype.hasOwnProperty.call(
        narrationDrafts,
        rowKey
      );
      const narrationDraftValue = hasNarrationDraft ? narrationDrafts[rowKey] : undefined;
      const narrationSourceValue =
        narrationDraftValue !== undefined ? narrationDraftValue : row?.["Narration"] ?? "";
      payload.narration = narrationSourceValue || null;
      return payload;
    },
    onUpdated: (updated) => {
      if (updated) {
        setProcessedDoc(updated);
      }
    },
  });

  const {
    ledgerInputs: disallowLedgerInputs,
    handleLedgerInputChange: handleDisallowLedgerInputChange,
    dirtyCount: disallowLedgerDirtyCount,
    persistLedgerChanges: persistDisallowLedgerChanges,
    savingLedgerChanges: savingDisallowLedgerChanges,
    setExtraRowDirtyState: setDisallowExtraDirtyState,
  } = useLedgerNameEditing({
    rows: disallowRows,
    importId,
    getRowKey,
    updateFunction: updateDisallowLedgerNames,
    rowsKey: "disallowRows",
    getRowPayload: (row, rowKey) => {
      const payload = {
        action: getActionValueForRow(row, rowKey),
      };
      // Add Action Reason if Action is Reject or Pending
      const actionValue = getActionValueForRow(row, rowKey);
      if (actionValue === "Reject" || actionValue === "Pending") {
        const hasDraft = Object.prototype.hasOwnProperty.call(
          actionReasonDrafts,
          rowKey
        );
        const draftValue = hasDraft ? actionReasonDrafts[rowKey] : undefined;
        const sourceValue =
          draftValue !== undefined ? draftValue : row?.["Action Reason"] ?? "";
        payload.actionReason = sourceValue || null;
      }
      // Add Narration
      const hasNarrationDraft = Object.prototype.hasOwnProperty.call(
        narrationDrafts,
        rowKey
      );
      const narrationDraftValue = hasNarrationDraft ? narrationDrafts[rowKey] : undefined;
      const narrationSourceValue =
        narrationDraftValue !== undefined ? narrationDraftValue : row?.["Narration"] ?? "";
      payload.narration = narrationSourceValue || null;
      return payload;
    },
    onUpdated: (updated) => {
      if (updated) {
        setProcessedDoc(updated);
      }
    },
  });

  const handleAcceptCreditChange = useCallback(
    (rowKey, value) => {
      const normalized = normalizeAcceptCreditValue(value);
      const baseRow = mismatchedRowMap.get(rowKey);
      const baseValue = normalizeAcceptCreditValue(
        baseRow?.["Accept Credit"] ?? ""
      );
      setAcceptCreditDrafts((prev) => {
        const next = { ...prev };
        if (normalized === baseValue) {
          if (Object.prototype.hasOwnProperty.call(next, rowKey)) {
            delete next[rowKey];
            return next;
          }
          return prev;
        }
        next[rowKey] = normalized;
        return next;
      });
      const actionDirty = isActionDirtyForRow(rowKey, mismatchedRowMap);
      setMismatchedAcceptDirtyState(
        rowKey,
        (normalized ?? null) !== (baseValue ?? null) || actionDirty
      );
    },
    [
      mismatchedRowMap,
      normalizeAcceptCreditValue,
      setMismatchedAcceptDirtyState,
      isActionDirtyForRow,
    ]
  );

  const handleActionChange = useCallback(
    (tabKey, rowKey, value) => {
      const rowMaps = {
        processed: processedRowMap,
        reverseCharge: reverseChargeRowMap,
        mismatched: mismatchedRowMap,
        disallow: disallowRowMap,
      };
      const dirtySetters = {
        processed: setProcessedExtraDirtyState,
        reverseCharge: setReverseChargeExtraDirtyState,
        mismatched: setMismatchedAcceptDirtyState,
        disallow: setDisallowExtraDirtyState,
      };
      const targetMap = rowMaps[tabKey];
      const baseRow = targetMap?.get(rowKey);
      const normalized = normalizeActionValue(value);
      const baseValue = normalizeActionValue(baseRow?.Action ?? "");
      setActionDrafts((prev) => {
        const next = { ...prev };
        if (normalized === baseValue) {
          if (Object.prototype.hasOwnProperty.call(next, rowKey)) {
            delete next[rowKey];
            return next;
          }
          return prev;
        }
        next[rowKey] = normalized;
        return next;
      });
      // Clear Action Reason if Action is changed to Accept
      if (normalized === "Accept") {
        setActionReasonDrafts((prev) => {
          const next = { ...prev };
          if (Object.prototype.hasOwnProperty.call(next, rowKey)) {
            delete next[rowKey];
            return next;
          }
          return prev;
        });
      } else if (normalized === "Reject" || normalized === "Pending") {
        // Clear Action Reason when changing to Reject/Pending to make it fresh/empty
        setActionReasonDrafts((prev) => {
          const next = { ...prev };
          next[rowKey] = ""; // Set to empty string for fresh input
          return next;
        });
      }
      const setter = dirtySetters[tabKey];
      if (setter) {
        const acceptDirty =
          tabKey === "mismatched" ? isAcceptDirtyForRow(rowKey) : false;
        setter(rowKey, (normalized ?? null) !== (baseValue ?? null) || acceptDirty);
      }
    },
    [
      processedRowMap,
      reverseChargeRowMap,
      mismatchedRowMap,
      disallowRowMap,
      setProcessedExtraDirtyState,
      setReverseChargeExtraDirtyState,
      setMismatchedAcceptDirtyState,
      setDisallowExtraDirtyState,
      isAcceptDirtyForRow,
      normalizeActionValue,
    ]
  );

  const handleActionReasonChange = useCallback(
    (tabKey, rowKey, value) => {
      const rowMaps = {
        processed: processedRowMap,
        reverseCharge: reverseChargeRowMap,
        mismatched: mismatchedRowMap,
        disallow: disallowRowMap,
      };
      const dirtySetters = {
        processed: setProcessedExtraDirtyState,
        reverseCharge: setReverseChargeExtraDirtyState,
        mismatched: setMismatchedAcceptDirtyState,
        disallow: setDisallowExtraDirtyState,
      };
      const targetMap = rowMaps[tabKey];
      const baseRow = targetMap?.get(rowKey);
      const rawValue = value ?? "";
      const baseValue = baseRow?.["Action Reason"] ?? "";
      
      setActionReasonDrafts((prev) => {
        const next = { ...prev };
        if (rawValue === baseValue) {
          if (Object.prototype.hasOwnProperty.call(next, rowKey)) {
            delete next[rowKey];
            return next;
          }
          return prev;
        }
        next[rowKey] = rawValue;
        return next;
      });
      
      const setter = dirtySetters[tabKey];
      if (setter) {
        const actionDirty = isActionDirtyForRow(rowKey, targetMap);
        const acceptDirty =
          tabKey === "mismatched" ? isAcceptDirtyForRow(rowKey) : false;
        setter(rowKey, (rawValue !== baseValue) || actionDirty || acceptDirty);
      }
    },
    [
      processedRowMap,
      reverseChargeRowMap,
      mismatchedRowMap,
      disallowRowMap,
      setProcessedExtraDirtyState,
      setReverseChargeExtraDirtyState,
      setMismatchedAcceptDirtyState,
      setDisallowExtraDirtyState,
      isActionDirtyForRow,
      isAcceptDirtyForRow,
    ]
  );

  const handleNarrationChange = useCallback(
    (tabKey, rowKey, value) => {
      const rowMaps = {
        processed: processedRowMap,
        reverseCharge: reverseChargeRowMap,
        mismatched: mismatchedRowMap,
        disallow: disallowRowMap,
      };
      const dirtySetters = {
        processed: setProcessedExtraDirtyState,
        reverseCharge: setReverseChargeExtraDirtyState,
        mismatched: setMismatchedAcceptDirtyState,
        disallow: setDisallowExtraDirtyState,
      };
      const targetMap = rowMaps[tabKey];
      const baseRow = targetMap?.get(rowKey);
      const rawValue = value ?? "";
      const baseValue = baseRow?.["Narration"] ?? "";
      
      setNarrationDrafts((prev) => {
        const next = { ...prev };
        if (rawValue === baseValue) {
          if (Object.prototype.hasOwnProperty.call(next, rowKey)) {
            delete next[rowKey];
            return next;
          }
          return prev;
        }
        next[rowKey] = rawValue;
        return next;
      });
      
      const setter = dirtySetters[tabKey];
      if (setter) {
        const actionDirty = isActionDirtyForRow(rowKey, targetMap);
        const acceptDirty =
          tabKey === "mismatched" ? isAcceptDirtyForRow(rowKey) : false;
        setter(rowKey, (rawValue !== baseValue) || actionDirty || acceptDirty);
      }
    },
    [
      processedRowMap,
      reverseChargeRowMap,
      mismatchedRowMap,
      disallowRowMap,
      setProcessedExtraDirtyState,
      setReverseChargeExtraDirtyState,
      setMismatchedAcceptDirtyState,
      setDisallowExtraDirtyState,
      isActionDirtyForRow,
      isAcceptDirtyForRow,
    ]
  );

  const handleActionPropagationToggle = useCallback(
    ({ checked, rowIdx, rows, sourceRow, tabKey, rowKey }) => {
      const stateKey = `${tabKey}-${rowKey}`;

      if (!checked) {
        setActionPropagationSelections((prev) => {
          if (!prev[stateKey]) return prev;
          const next = { ...prev };
          delete next[stateKey];
          return next;
        });
        return;
      }

      const { normalized: sourceSupplierNormalized, original: sourceSupplier } =
        getNormalizedSupplierName(sourceRow);
      if (!sourceSupplierNormalized) {
        setStatus({
          type: "error",
          message:
            "Supplier name missing for this row, nothing to match against.",
        });
        return;
      }

      const sourceAction = getActionValueForRow(sourceRow, rowKey);
      const hasReason =
        sourceAction === "Reject" || sourceAction === "Pending";
      const sourceReasonRaw = hasReason
        ? (() => {
            const hasDraft = Object.prototype.hasOwnProperty.call(
              actionReasonDrafts,
              rowKey
            );
            const draftValue = hasDraft
              ? actionReasonDrafts[rowKey]
              : undefined;
            const sourceValue =
              draftValue !== undefined
                ? draftValue
                : sourceRow?.["Action Reason"] ?? "";
            return String(sourceValue ?? "").trim();
          })()
        : "";

      if (!sourceAction) {
        setStatus({
          type: "error",
          message: "Select an action before applying it to other rows.",
        });
        return;
      }

      let appliedCount = 0;
      for (let idx = rowIdx + 1; idx < rows.length; idx += 1) {
        const targetRow = rows[idx];
        const {
          normalized: candidateSupplierNormalized,
        } = getNormalizedSupplierName(targetRow);
        if (
          candidateSupplierNormalized &&
          candidateSupplierNormalized === sourceSupplierNormalized
        ) {
          const targetRowKey = getRowKey(targetRow, idx);
          handleActionChange(tabKey, targetRowKey, sourceAction);
          if (hasReason) {
            handleActionReasonChange(tabKey, targetRowKey, sourceReasonRaw);
          }
          appliedCount += 1;
        }
      }

      setActionPropagationSelections((prev) => ({
        ...prev,
        [stateKey]: {
          action: sourceAction,
          reason: hasReason ? sourceReasonRaw : "",
          supplier: sourceSupplier,
          matches: appliedCount,
          appliedAt: Date.now(),
        },
      }));

      setStatus({
        type: appliedCount ? "success" : "info",
        message: appliedCount
          ? `Applied action to ${appliedCount} matching row${
              appliedCount > 1 ? "s" : ""
            }.`
          : "No later rows found with the same supplier name.",
      });
    },
    [
      getRowKey,
      setStatus,
      setActionPropagationSelections,
      getActionValueForRow,
      actionReasonDrafts,
      handleActionChange,
      handleActionReasonChange,
      narrationDrafts,
    ]
  );

  const appendActionColumn = useCallback((columns = [], tabKey) => {
    const columnsToMove = [
      'gstRegistrationType',
      'state',
      'supplierState',
      'GSTR-1/1A/IFF/GSTR-5 Filing Date',
      'GSTR-2B Taxable Value'
    ];
    
    // Create a set of columns to move for faster lookup
    const columnsToMoveSet = new Set(columnsToMove);
    
    // Filter out the columns we want to move from their original positions
    const filteredColumns = columns.filter(col => !columnsToMoveSet.has(col));
    
    // Find the index where we want to insert the columns (after the 4 editing columns)
    const ledgerNameIndex = filteredColumns.indexOf('Ledger Name');
    const insertIndex = ledgerNameIndex !== -1 ? ledgerNameIndex + 4 : 4;
    
    // Insert the columns at the desired position
    filteredColumns.splice(insertIndex, 0, ...columnsToMove);
    
    // Start with the filtered columns
    const result = [...filteredColumns];
    
    // Only add Accept Credit for mismatched tab
    if (tabKey === 'mismatched' && !result.includes("Accept Credit")) {
      result.push("Accept Credit");
    }
    
    // Always ensure Action, Action Reason, and Narration are present
    if (!result.includes("Action")) {
      result.push("Action");
    }
    if (!result.includes("Action Reason")) {
      result.push("Action Reason");
    }
    if (!result.includes("Narration")) {
      result.push("Narration");
    }
    
    return result;
  }, []);

  const tabConfigs = {
    processed: {
      key: "processed",
      label: "Processed Rows",
      rows: processedRows,
      columns: appendActionColumn(processedColumns, 'processed'),
      ledgerInputs: processedLedgerInputs,
      handleChange: handleProcessedLedgerInputChange,
      dirtyCount: processedLedgerDirtyCount,
      persist: persistProcessedLedgerChanges,
      saving: savingProcessedLedgerChanges,
      hasRows: hasProcessedRows,
      count: processedRows.length,
      accent: "amber",
    },
    reverseCharge: {
      key: "reverseCharge",
      label: "Reverse Charge Rows",
      rows: reverseChargeRows,
      columns: appendActionColumn(reverseChargeColumns, 'reverseCharge'),
      ledgerInputs: reverseChargeLedgerInputs,
      handleChange: handleReverseChargeLedgerInputChange,
      dirtyCount: reverseChargeLedgerDirtyCount,
      persist: persistReverseChargeLedgerChanges,
      saving: savingReverseChargeLedgerChanges,
      hasRows: hasReverseChargeRows,
      count: reverseChargeRows.length,
      accent: "purple",
    },
    mismatched: {
      key: "mismatched",
      label: "Mismatched Rows",
      rows: mismatchedRows,
      columns: appendActionColumn(mismatchedColumnsWithAccept, 'mismatched'),
      ledgerInputs: mismatchedLedgerInputs,
      handleChange: handleMismatchedLedgerInputChange,
      dirtyCount: mismatchedLedgerDirtyCount,
      persist: persistMismatchedLedgerChanges,
      saving: savingMismatchedLedgerChanges,
      hasRows: hasMismatchedRows,
      count: mismatchedRows.length,
      accent: "orange",
    },
    disallow: {
      key: "disallow",
      label: "Disallow Rows",
      rows: disallowRows,
      columns: appendActionColumn(disallowColumns, 'disallow'),
      ledgerInputs: disallowLedgerInputs,
      handleChange: handleDisallowLedgerInputChange,
      dirtyCount: disallowLedgerDirtyCount,
      persist: persistDisallowLedgerChanges,
      saving: savingDisallowLedgerChanges,
      hasRows: hasDisallowRows,
      count: disallowRows.length,
      accent: "red",
    },
  };

  const tabOrder = ["processed", "reverseCharge", "mismatched", "disallow"];
  const tabActiveClasses = {
    processed: "border-amber-500 text-amber-700",
    reverseCharge: "border-purple-500 text-purple-700",
    mismatched: "border-orange-500 text-orange-700",
    disallow: "border-red-500 text-red-700",
  };
  const activeConfig = tabConfigs[activeTab] || tabConfigs.processed;
  const activeRows = activeConfig?.rows || [];
  const activeColumns = activeConfig?.columns || [];
  const activeLedgerInputs = activeConfig?.ledgerInputs || {};
  const activeHandleChange = activeConfig?.handleChange || (() => {});
  const activeDirtyCount = activeConfig?.dirtyCount || 0;
  const activeSaving = Boolean(activeConfig?.saving);
  const activePersistFn = activeConfig?.persist;
  const activeHasRows = activeConfig?.hasRows;
  const activeLabel = activeConfig?.label || "Ledger Rows";
  const isMismatchedTab = activeConfig?.key === "mismatched";
  const renderAcceptCreditBadge = useCallback((value) => {
    if (!value) {
      return <span className="text-slate-400">—</span>;
    }
    const normalized = String(value).trim().toLowerCase();
    const isYes = normalized === "yes";
    const badgeClasses = isYes
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-rose-50 text-rose-700 border-rose-200";
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClasses}`}
      >
        {value}
      </span>
    );
  }, []);

  const loadLedgerNames = useCallback(async () => {
    setLedgerNamesLoading(true);
    try {
      const { data } = await fetchLedgerNames();
      setLedgerNames(data || []);
    } catch (error) {
      console.error("Failed to load ledger names:", error);
      setStatus((prev) =>
        prev.type === "error"
          ? prev
          : {
              type: "error",
              message:
                "Unable to load ledger names. You can still type custom names.",
            }
      );
    } finally {
      setLedgerNamesLoading(false);
    }
  }, [setStatus]);

  const getOriginalRows = useCallback(async () => {
    if (sheetRows.length) {
      return sheetRows;
    }
    if (!importId) {
      return [];
    }
    if (originalRowsCache.current[importId]) {
      return originalRowsCache.current[importId];
    }
    try {
      const { data } = await fetchImportById(importId);
      const rows = data?.rows || [];
      originalRowsCache.current[importId] = rows;
      importDocCache.current[importId] = data || {};
      return rows;
    } catch (error) {
      console.error("Failed to load original GSTR-2B rows:", error);
      setStatus({
        type: "error",
        message: "Unable to load GSTR-2B data for combined download.",
      });
      return [];
    }
  }, [sheetRows, importId, setStatus]);

  useEffect(() => {
    setAcceptCreditDrafts({});
    setActionDrafts({});
  }, [importId]);

  useEffect(() => {
    if (processedDoc) {
      setAcceptCreditDrafts({});
      setActionDrafts({});
    }
  }, [processedDoc?.updatedAt]);

  const persistAllLedgerChanges = useCallback(async () => {
    let latestDoc = null;
    const persistFns = [
      persistProcessedLedgerChanges,
      persistReverseChargeLedgerChanges,
      persistMismatchedLedgerChanges,
      persistDisallowLedgerChanges,
    ];
    let mismatchedSaved = false;

    for (const persistFn of persistFns) {
      if (typeof persistFn !== "function") continue;
      const result = await persistFn();
      if (result) {
        latestDoc = result;
        if (persistFn === persistMismatchedLedgerChanges) {
          mismatchedSaved = true;
        }
        setActionDrafts({});
      }
    }

    if (mismatchedSaved) {
      setAcceptCreditDrafts({});
    }

    return latestDoc;
  }, [
    persistProcessedLedgerChanges,
    persistReverseChargeLedgerChanges,
    persistMismatchedLedgerChanges,
    persistDisallowLedgerChanges,
    setAcceptCreditDrafts,
  ]);

  useEffect(() => {
    loadLedgerNames();
  }, [loadLedgerNames]);

  const loadPartyMasters = useCallback(async () => {
    if (!company?._id) return;
    setPartyMastersLoading(true);
    try {
      const { data } = await fetchPartyMasters(company._id);
      setPartyMasters(data || []);
    } catch (error) {
      console.error("Failed to load party masters:", error);
    } finally {
      setPartyMastersLoading(false);
    }
  }, [company]);

  useEffect(() => {
    if (hasProcessedRows && company?._id) {
      loadPartyMasters();
    }
  }, [hasProcessedRows, company, loadPartyMasters]);

  // Compare GSTINs and find missing suppliers
  useEffect(() => {
    if (!hasProcessedRows) {
      setMissingSuppliers([]);
      setMissingSelection(new Set());
      return;
    }

    // If party masters are still loading, wait
    if (partyMastersLoading) {
      return;
    }

    // Create a set of GSTINs from party masters (normalized to uppercase)
    // If partyMasters is empty, all suppliers will be considered missing
    const partyMasterGstinSet = new Set(
      partyMasters.map((party) => party.gstin?.trim().toUpperCase() || "")
    );

    // Find the actual column names from processedColumns
    // They could be camelCase (from backend) or display names
    const gstinColumn = processedColumns.find(
      (col) =>
        col.toLowerCase().includes("gstin") ||
        col.toLowerCase().includes("uin") ||
        col === "gstinUin" ||
        col === "gstin"
    );
    const supplierColumn = processedColumns.find(
      (col) =>
        col.toLowerCase().includes("supplier") ||
        col === "supplierName" ||
        col === "supplier"
    );

    if (!gstinColumn || !supplierColumn) {
      console.warn("Could not find GSTIN or Supplier column in processed rows");
      setMissingSuppliers([]);
      return;
    }

    // Extract unique suppliers from processed rows
    const supplierMap = new Map();
    processedRows.forEach((row) => {
      const gstinRaw = String(row[gstinColumn] || "").trim();
      const gstin = gstinRaw.toUpperCase();
      const supplierName = String(row[supplierColumn] || "").trim();
      
      // If GSTIN and supplier name exist, and GSTIN is not in party masters
      if (gstin && supplierName && !partyMasterGstinSet.has(gstin)) {
        // Use GSTIN as key to avoid duplicates
        if (!supplierMap.has(gstin)) {
          supplierMap.set(gstin, {
            supplierName,
            gstin: gstinRaw, // Keep original case for display
          });
        }
      }
    });

    const missingList = Array.from(supplierMap.values());
    setMissingSuppliers(missingList);
    setMissingSelection(
      new Set(missingList.map((supplier) => supplier.gstin?.trim().toUpperCase() || supplier.gstin)),
    );
  }, [processedRows, partyMasters, hasProcessedRows, partyMastersLoading]);

  const openAddLedgerModal = () =>
    setAddLedgerModal({ open: true, value: "", submitting: false });

  const closeAddLedgerModal = () =>
    setAddLedgerModal({ open: false, value: "", submitting: false });

  const handleAddLedgerSubmit = async (event) => {
    event.preventDefault();
    const trimmed = addLedgerModal.value.trim();
    if (!trimmed) {
      setStatus({
        type: "error",
        message: "Ledger name cannot be empty.",
      });
      return;
    }
    setAddLedgerModal((prev) => ({ ...prev, submitting: true }));
    try {
      await createLedgerNameApi({ name: trimmed });
      setStatus({ type: "success", message: "Ledger name added." });
      await loadLedgerNames();
      setAddLedgerModal({ open: false, value: "", submitting: false });
    } catch (error) {
      console.error("Failed to add ledger name:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to add ledger name. Please try again.",
      });
      setAddLedgerModal((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleSaveLedgerNames = async () => {
    const config = tabConfigs[activeTab];
    if (!config?.persist) {
      setStatus({
        type: "error",
        message: "Unable to save ledger names for this tab.",
      });
      return;
    }

    if (!config.dirtyCount) {
      setStatus({
        type: "success",
        message: "No ledger changes to save.",
      });
      return;
    }

    try {
      const updated = await config.persist();
      if (updated) {
        setStatus({
          type: "success",
          message: `${config.label} ledger names saved.`,
        });
        if (config.key === "mismatched") {
          setAcceptCreditDrafts({});
        }
        const rowsByKey = {
          processed: processedRows,
          reverseCharge: reverseChargeRows,
          mismatched: mismatchedRows,
          disallow: disallowRows,
        };
        clearActionDraftsForRows(rowsByKey[config.key] || []);
      } else {
        setStatus({
          type: "success",
          message: "No ledger changes to save.",
        });
      }
    } catch (error) {
      console.error("Failed to save ledger names:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to save ledger names. Please try again.",
      });
    }
  };

  useEffect(() => {
    if (!company) return;
    const loadGST = async () => {
      setLoadingGST(true);
      try {
        const { data } = await fetchGSTINNumbers();
        const map = (data || []).reduce((acc, item) => {
          acc[item.gstCode.padStart(2, "0")] = item.stateName;
          return acc;
        }, {});
        setGstStateMap(map);
      } catch (error) {
        console.error("Failed to load GST state codes:", error);
        setStatus({
          type: "error",
          message: "Unable to load GST codes. State mapping may be empty.",
        });
      } finally {
        setLoadingGST(false);
      }
    };
    loadGST();
  }, [company]);

  useEffect(() => {
    if (!company) {
      const timer = setTimeout(() => navigate("/company-selector"), 2000);
      return () => clearTimeout(timer);
    }
  }, [company, navigate]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatus({ type: "", message: "" });
    const snapshot = {
      _id: company._id,
      companyName: company.companyName,
      mailingName: company.mailingName,
      address: company.address,
      state: company.state,
      country: company.country,
      pincode: company.pincode,
      gstin: company.gstin,
      email: company.email,
      telephone: company.telephone,
    };

    uploadB2BSheet(file, {
      companyId: company._id,
      companySnapshot: snapshot,
    })
      .then(({ data }) => {
        setFileMeta({ name: file.name });
        setSheetRows(data.rows || []);
        setGeneratedRows([]);
        setImportId(data._id || null);
        if (data?._id) {
          importDocCache.current[data._id] = data;
        }
        setProcessedDoc(null);
        setStatus({
          type: "success",
          message: `Imported ${data.rows?.length || 0} rows from B2B sheet.`,
        });
        setDownloadsUnlocked(false);
      })
      .catch((error) => {
        console.error("Failed to upload B2B sheet:", error);
        setStatus({
          type: "error",
          message:
            error?.response?.data?.message ||
            "Unable to process the B2B sheet. Please try again.",
        });
      })
      .finally(() => setUploading(false));
  };

  const determineSlab = (taxableValue, igst, cgst) => {
    if (!taxableValue) return null;
    const tolerance = 0.05; // percent tolerance

    if (igst > 0) {
      const percent = (igst / taxableValue) * 100;
      const match = slabConfig.find(
        (slab) => Math.abs(percent - slab.igst) <= tolerance
      );
      if (match) {
        return { ...match, mode: "IGST" };
      }
    } else if (cgst > 0) {
      const percent = (cgst / taxableValue) * 100;
      const match = slabConfig.find(
        (slab) => Math.abs(percent - slab.cgst) <= tolerance
      );
      if (match) {
        return { ...match, mode: "CGST_SGST" };
      }
    }

    return null;
  };

  const buildRow = (row, index) => {
    const invoiceDate = pick(row, columnMap.invoiceDate);
    const invoiceNumber = pick(row, columnMap.invoiceNumber);
    const taxableValue = toNumber(pick(row, columnMap.taxableValue));
    const invoiceValue = toNumber(pick(row, columnMap.invoiceValue));
    const integratedTax = toNumber(pick(row, columnMap.integratedTax));
    const centralTax = toNumber(pick(row, columnMap.centralTax));
    const stateTax = toNumber(pick(row, columnMap.stateTax));
    const gstin = String(pick(row, columnMap.gstin) || "").trim();
    const stateCode = gstin.slice(0, 2);
    const mappedState = gstStateMap[stateCode] || "";

    const supplierState = pick(row, columnMap.placeOfSupply);
    const slab = determineSlab(taxableValue, integratedTax, centralTax);

    const base = {
      "Sr no.": index + 1,
      Date: formatDate(invoiceDate),
      "Vch No": invoiceNumber,
      "VCH Type": "PURCHASE",
      "Reference No.": invoiceNumber,
      "Reference Date": formatDate(invoiceDate),
      "Supplier Name": pick(row, columnMap.tradeName),
      "GST Registration Type": pick(row, columnMap.invoiceType),
      "GSTIN/UIN": gstin,
      State: mappedState,
      "Supplier State": supplierState,
      "Supplier Amount": invoiceValue || taxableValue,
      "Supplier Dr/Cr": "CR",
    "Ledger Name": "",
      "Ledger Amount 5%": "",
      "Ledger amount cr/dr 5%": "",
      "Ledger Amount 12%": "",
      "Ledger amount Cr/Dr 12%": "",
      "Ledger Amount 18%": "",
      "Ledger amount cr/dr 18%": "",
      "Ledger Amount 28%": "",
      "Ledger amount cr/dr 28%": "",
      "IGST Rate 5%": "",
      "CGST Rate 5%": "",
      "SGST/UTGST Rate 5%": "",
      "IGST Rate 12%": "",
      "CGST Rate 12%": "",
      "SGST/UTGST Rate 12%": "",
      "IGST Rate 18%": "",
      "CGST Rate 18%": "",
      "SGST/UTGST Rate 18%": "",
      "IGST Rate 28%": "",
      "CGST Rate 28%": "",
      "SGST/UTGST Rate 28%": "",
      "GRO Amount": "",
      "Round Off Dr": "",
      "Round Off Cr": "",
      "Invoice Amount": "",
      "Change Mode": "Accounting Inovice",
    };

    if (slab) {
      const mapping = ledgerKeyMap[slab.slab];
      if (mapping) {
        base[mapping.ledgerAmount] = taxableValue;
        base[mapping.ledgerCrDr] = "DR";

        if (slab.mode === "IGST") {
          base[mapping.igst] = integratedTax;
        } else {
          base[mapping.cgst] = centralTax;
          base[mapping.sgst] = stateTax;
        }
      }
    }

    const parsedTaxes = taxKeys.reduce(
      (sum, key) => sum + toNumber(base[key]),
      0
    );
    const fallbackTaxes =
      parsedTaxes > 0 ? parsedTaxes : integratedTax + centralTax + stateTax;

    const ledgerAmount = taxableValue;
    const groAmount = parseFloat((ledgerAmount + fallbackTaxes).toFixed(2));
    const decimalPart = groAmount - Math.floor(groAmount);
    let roundOffDr = 0;
    let roundOffCr = 0;
    let invoiceAmount = groAmount;

    if (decimalPart > 0) {
      if (decimalPart >= 0.5) {
        roundOffCr = parseFloat((Math.ceil(groAmount) - groAmount).toFixed(2));
        invoiceAmount = groAmount + roundOffCr;
      } else {
        roundOffDr = parseFloat((groAmount - Math.floor(groAmount)).toFixed(2));
        invoiceAmount = groAmount - roundOffDr;
      }
    }

    base["GRO Amount"] = groAmount;
    base["Round Off Dr"] = roundOffDr || "";
    base["Round Off Cr"] = roundOffCr || "";
    base["Invoice Amount"] = invoiceAmount;
    base["Supplier Amount"] = invoiceAmount;

    return base;
  };

  const handleGenerate = () => {
    if (!sheetRows.length) {
      setStatus({ type: "error", message: "Upload a B2B sheet with data first." });
      return;
    }
    if (!company) {
      setStatus({ type: "error", message: "Company information missing." });
      return;
    }
    const rows = sheetRows.map((row, index) => buildRow(row, index));
    setGeneratedRows(rows);
    setStatus({
      type: "success",
      message: `Generated ${rows.length} rows. Download when ready.`,
    });
  };

  const handleDownloadGstr2BExcel = () => {
    if (!sheetRows.length) {
      setStatus({
        type: "error",
        message: "Upload a B2B sheet before downloading.",
      });
      return;
    }

    const worksheetRows = sheetRows.map((row) => {
      const entry = {};
      gstr2bHeaders.forEach(({ key, label }) => {
        entry[label] = row?.[key] ?? "";
      });
      return entry;
    });

    const worksheet = XLSX.utils.json_to_sheet(worksheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "GSTR-2B");
    const filename = `${buildDownloadFilename(
      "GSTR2BExcel",
      company?.companyName
    )}.xlsx`;
    XLSX.writeFile(workbook, filename);
    setStatus({ type: "success", message: "GSTR-2B Excel downloaded." });
  };

  const ensureProcessedDoc = async () => {
    if (!importId) {
      setStatus({
        type: "error",
        message: "Import a sheet before downloading processed data.",
      });
      return null;
    }

    if (processedDoc) return processedDoc;

    try {
      const { data } = await fetchProcessedFile(importId);
      setProcessedDoc(data);
      return data;
    } catch (error) {
      console.error("Failed to fetch processed file:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to fetch processed data. Please process the sheet first.",
      });
      return null;
    }
  };

  const guardDownloads = () => {
    if (!downloadsUnlocked) {
      setStatus({
        type: "error",
        message: "Please run Process Sheet first to unlock these downloads.",
      });
      return false;
    }
    return true;
  };

  const handleDownloadProcessedExcel = async () => {
    if (!guardDownloads()) return;
    try {
      const savedDoc = await persistProcessedLedgerChanges();
      const doc = savedDoc || (await ensureProcessedDoc());
      if (!doc) return;

      const matchedRows = doc.processedRows || [];
      if (!matchedRows.length) {
        setStatus({
          type: "error",
          message: "No processed rows available. Process the sheet first.",
        });
        return;
      }

      const workbook = XLSX.utils.book_new();
      const processedSheet = XLSX.utils.json_to_sheet(
        stripMetaFields(matchedRows)
      );
      XLSX.utils.book_append_sheet(workbook, processedSheet, "Processed");
      const filename = `${buildDownloadFilename(
        "TallyProcessedExcel",
        doc.company || company?.companyName
      )}.xlsx`;
      XLSX.writeFile(workbook, filename);
      setStatus({
        type: "success",
        message: "TallyProcessedExcel downloaded.",
      });
    } catch (error) {
      console.error("Failed to download processed excel:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to download processed data. Please try again.",
      });
    }
  };

  const handleDownloadMismatchedExcel = async () => {
    if (!guardDownloads()) return;
    try {
      await persistMismatchedLedgerChanges();
      const doc = await ensureProcessedDoc();
      if (!doc) return;

      const mismatchedRows = doc.mismatchedRows || [];
      if (!mismatchedRows.length) {
        setStatus({
          type: "error",
          message: "No mismatched rows available.",
        });
        return;
      }

      const workbook = XLSX.utils.book_new();
      const cleanedMismatchedRows = stripMetaFields(mismatchedRows);
      const sanitizedRows = cleanedMismatchedRows.map(
        ({
          "Ledger Amount 5%": _la5,
          "Ledger DR/CR 5%": _ldr5,
          "IGST Rate 5%": _ir5,
          "CGST Rate 5%": _cr5,
          "SGST/UTGST Rate 5%": _sr5,
          "Ledger Amount 12%": _la12,
          "Ledger DR/CR 12%": _ldr12,
          "IGST Rate 12%": _ir12,
          "CGST Rate 12%": _cr12,
          "SGST/UTGST Rate 12%": _sr12,
          "Ledger Amount 18%": _la18,
          "Ledger DR/CR 18%": _ldr18,
          "IGST Rate 18%": _ir18,
          "CGST Rate 18%": _cr18,
          "SGST/UTGST Rate 18%": _sr18,
          "Ledger Amount 28%": _la28,
          "Ledger DR/CR 28%": _ldr28,
          "IGST Rate 28%": _ir28,
          "CGST Rate 28%": _cr28,
          "SGST/UTGST Rate 28%": _sr28,
          ...rest
        },
        idx
      ) => ({
        ...rest,
        "Accept Credit":
          mismatchedRows?.[idx]?.["Accept Credit"] ??
          rest["Accept Credit"] ??
          "",
      }));
      const mismatchedSheet = XLSX.utils.json_to_sheet(sanitizedRows);
      XLSX.utils.book_append_sheet(workbook, mismatchedSheet, "Mismatched");
      const filename = `${buildDownloadFilename(
        "MismatchedExcel",
        doc.company || company?.companyName
      )}.xlsx`;
      XLSX.writeFile(workbook, filename);
      setStatus({
        type: "success",
        message: "Mismatched data Excel downloaded.",
      });
    } catch (error) {
      console.error("Failed to download mismatched excel:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to download mismatched data. Please try again.",
      });
    }
  };

  const handleDownloadReverseChargeExcel = async () => {
    if (!guardDownloads()) return;
    try {
      const savedDoc = await persistReverseChargeLedgerChanges();
      const doc = savedDoc || (await ensureProcessedDoc());
      if (!doc) return;

      const reverseChargeRows = doc.reverseChargeRows || [];
      if (!reverseChargeRows.length) {
        setStatus({
          type: "error",
          message: "No reverse charge rows available.",
        });
        return;
      }

      const workbook = XLSX.utils.book_new();
      const reverseChargeSheet = XLSX.utils.json_to_sheet(
        stripMetaFields(reverseChargeRows)
      );
      XLSX.utils.book_append_sheet(workbook, reverseChargeSheet, "Reverse Charge");
      const filename = `${buildDownloadFilename(
        "ReverseChargeExcel",
        doc.company || company?.companyName
      )}.xlsx`;
      XLSX.writeFile(workbook, filename);
      setStatus({
        type: "success",
        message: "Reverse charge Excel downloaded.",
      });
    } catch (error) {
      console.error("Failed to download reverse charge excel:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to download reverse charge data. Please try again.",
      });
    }
  };

  const handleDownloadDisallowExcel = async () => {
    if (!guardDownloads()) return;
    try {
      await persistDisallowLedgerChanges();
      await persistProcessedLedgerChanges();

      const doc = await ensureProcessedDoc();
      if (!doc) return;

      const disallowRows =
        doc.disallowRows?.length > 0
          ? doc.disallowRows
          : filterDisallowRows(doc.processedRows || []);
      if (!disallowRows.length) {
        setStatus({
          type: "error",
          message: "No rows with disallow ledger names found. Add '[disallow]' to ledger names (e.g., 'xyz [disallow]') to mark them as disallow.",
        });
        return;
      }

      const workbook = XLSX.utils.book_new();
      const disallowSheet = XLSX.utils.json_to_sheet(
        stripMetaFields(disallowRows)
      );
      XLSX.utils.book_append_sheet(workbook, disallowSheet, "Disallow");
      const filename = `${buildDownloadFilename(
        "DisallowExcel",
        doc.company || company?.companyName
      )}.xlsx`;
      XLSX.writeFile(workbook, filename);
      setStatus({
        type: "success",
        message: "Disallow Excel downloaded.",
      });
    } catch (error) {
      console.error("Failed to download disallow excel:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to download disallow data. Please try again.",
      });
    }
  };
  

  const handleDownloadCombinedExcel = async () => {
    if (!guardDownloads()) return;
    try {
      const savedDoc = await persistAllLedgerChanges();
      const doc = savedDoc || (await ensureProcessedDoc());
      if (!doc) return;

      const originalRows = await getOriginalRows();
      const restSheets =
        importDocCache.current[importId]?.restSheets || [];
      const processedRowsClean = stripMetaFields(doc.processedRows || []);
      const mismatchedRowsClean = stripMetaFields(doc.mismatchedRows || []);
      const reverseChargeRowsClean = stripMetaFields(doc.reverseChargeRows || []);
      const disallowSource =
        doc.disallowRows?.length > 0
          ? doc.disallowRows
          : filterDisallowRows(doc.processedRows || []);
      const disallowRowsClean = stripMetaFields(disallowSource);

      const workbook = buildCombinedWorkbook({
        originalRows,
        processedRows: processedRowsClean,
        processedHeaders: processedColumns,
        mismatchedRows: mismatchedRowsClean,
        reverseChargeRows: reverseChargeRowsClean,
        disallowRows: disallowRowsClean,
        restSheets,
        normalizeAcceptCreditValue,
      });

      const filename = `${buildDownloadFilename(
        "CombinedExcel",
        doc.company || company?.companyName
      )}.xlsx`;
      XLSX.writeFile(workbook, filename);
      setStatus({
        type: "success",
        message: "Combined Excel file downloaded with all sheets.",
      });
    } catch (error) {
      console.error("Failed to download combined excel:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to download combined data. Please try again.",
      });
    }
  };

  const handleDownloadActionJson = useCallback(async () => {
    if (!processedDoc) {
      setStatus({
        type: "error",
        message: "Process the sheet before downloading the action JSON.",
      });
      return;
    }
    try {
      const originalRows = await getOriginalRows();
      const rowGroups = [
        { rows: processedDoc.processedRows || [] },
        { rows: processedDoc.reverseChargeRows || [] },
        { rows: processedDoc.mismatchedRows || [] },
        {
          rows:
            processedDoc.disallowRows?.length > 0
              ? processedDoc.disallowRows
              : filterDisallowRows(processedDoc.processedRows || []),
        },
      ];

      const payload = buildActionJsonPayload({
        rowGroups,
        getRowKey,
        getActionValue: (row, rowKey) => getActionValueForRow(row, rowKey),
        originalRows,
        companyGstin:
          processedDoc.companySnapshot?.gstin ||
          company?.gstin ||
          processedDoc.company ||
          "",
      });

      if (!payload.invdata.b2b.length) {
        setStatus({
          type: "error",
          message: "No rows with Accept/Reject/Pending actions to export.",
        });
        return;
      }

      const filename = `${sanitizeFileName(
        processedDoc.company || company?.companyName || "company"
      )}-actions.json`;
      downloadJsonFile(payload, filename);
      setStatus({
        type: "success",
        message: "Action JSON downloaded.",
      });
    } catch (error) {
      console.error("Failed to download action JSON:", error);
      setStatus({
        type: "error",
        message:
          error?.message || "Unable to download action JSON. Please try again.",
      });
    }
  }, [
    company?.companyName,
    company?.gstin,
    getActionValueForRow,
    getOriginalRows,
    getRowKey,
    processedDoc,
    setStatus,
  ]);

  const handleProcessSheet = () => {
    if (!importId) {
      setStatus({
        type: "error",
        message: "Upload and import the sheet before processing.",
      });
      return;
    }
    setProcessing(true);
    processGstr2bImport(importId)
      .then(({ data }) => {
        setProcessedDoc(data.processed || null);
        setDownloadsUnlocked(true);
        setStatus({
          type: "success",
          message: `Processed ${data.processedCount || 0} rows successfully.`,
        });
      })
      .catch((error) => {
        console.error("Failed to process sheet:", error);
        setStatus({
          type: "error",
          message:
            error?.response?.data?.message ||
            "Unable to process the sheet. Please try again.",
        });
      })
      .finally(() => setProcessing(false));
  };

  const openTallyModal = async () => {
    if (!company?._id || !processedDoc) return;
    setTallyModal((prev) => ({ ...prev, open: true, loading: true, error: "" }));
    try {
      const { data } = await fetchGstr2AImportsByCompany(company._id);
      const options = (data || []).map((doc) => ({
        id: doc._id,
        label: `${doc.sheetName || "GSTR-2A"} - ${new Date(doc.uploadedAt || doc.processedAt || doc.createdAt || Date.now()).toLocaleString()}`,
      }));
      setTallyModal((prev) => ({
        ...prev,
        loading: false,
        options,
        selectedId: options[0]?.id || "",
      }));
    } catch (error) {
      console.error("Failed to load GSTR-2A imports:", error);
      setTallyModal((prev) => ({
        ...prev,
        loading: false,
        error:
          error?.response?.data?.message ||
          "Unable to fetch GSTR-2A processed files.",
      }));
    }
  };

  const handleTallySubmit = async () => {
    if (!importId || !tallyModal.selectedId) return;
    setTallyModal((prev) => ({ ...prev, submitting: true, error: "" }));
    try {
      const { data } = await tallyWithGstr2a(importId, {
        gstr2aId: tallyModal.selectedId,
      });
      const updated = data?.processed;
      if (updated) {
        setProcessedDoc(updated);
        setStatus({
          type: "success",
          message: "GSTR-2B sheet updated after tallying with GSTR-2A.",
        });
      }
      setTallyModal((prev) => ({
        ...prev,
        open: false,
        submitting: false,
      }));
    } catch (error) {
      console.error("Failed to tally with GSTR-2A:", error);
      setTallyModal((prev) => ({
        ...prev,
        submitting: false,
        error:
          error?.response?.data?.message ||
          "Unable to tally with GSTR-2A. Please try again.",
      }));
    }
  };

  if (!company) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-center p-6 space-y-3">
        <p className="text-lg text-slate-700">
          No company selected. Redirecting you to selector...
        </p>
        <button
          onClick={() => navigate("/company-selector")}
          className="px-4 py-2 rounded bg-indigo-600 text-white"
        >
          Go now
        </button>
      </main>
    );
  }

  if (readOnly) {
    return (
      <motion.main
        className="min-h-screen bg-linear-to-br from-amber-50 via-rose-50 to-white p-4 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <section className="w-full px-6 space-y-6">
          <BackButton label="Back to selector" fallback="/company-selector" />
          <motion.header
            className="rounded-3xl border border-amber-100 bg-white/90 p-6 sm:p-8 shadow-lg backdrop-blur flex flex-col gap-2"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">
              Step 2
            </p>
            <h1 className="text-3xl font-bold text-slate-900">
              Step 2: Prepare the purchase register for Tally
            </h1>
            <div className="text-sm text-slate-600 space-y-1">
              <p>Client: {company.companyName}</p>
              <p>GSTIN: {company.gstin || "—"}</p>
              <p>State: {company.state}</p>
            </div>
          </motion.header>
          <PlanRestrictionBanner />
          <div className="rounded-3xl border border-amber-100 bg-white/95 p-6 shadow-lg backdrop-blur space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">
              Processing is locked for this account
            </h2>
            <p className="text-sm text-slate-600">{readOnlyMessage}</p>
            <p className="text-sm text-slate-600">
              You can still open Review History to download past Excel/JSON
              files for this company. Renew your plan to upload new GSTR-2B
              files or edit ledger mappings.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/b2b-history")}
                className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-amber-600"
              >
                Go to Review History
              </button>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back to dashboard
              </button>
            </div>
          </div>
        </section>
      </motion.main>
    );
  }

  return (
    <motion.main
      className="min-h-screen bg-linear-to-br from-amber-50 via-rose-50 to-white p-4 sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <section className="w-full px-6 space-y-6">
        <BackButton label="Back to selector" fallback="/company-selector" />

        <motion.header
          className="rounded-3xl border border-amber-100 bg-white/90 p-6 sm:p-8 shadow-lg backdrop-blur flex flex-col gap-2"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">
            Step 2
          </p>
          <h1 className="text-3xl font-bold text-slate-900">
            Step 2: Prepare the purchase register for Tally
          </h1>
          <div className="text-sm text-slate-600 space-y-1">
            <p>Client: {company.companyName}</p>
            <p>GSTIN: {company.gstin || "—"}</p>
            <p>State: {company.state}</p>
            {loadingGST ? (
              <p className="text-xs text-amber-500 mt-1 flex items-center gap-2">
                <FiRefreshCw className="animate-spin" /> Loading GST state mapping...
              </p>
            ) : null}
          </div>
          <p className="text-sm text-slate-600 mt-2">
            Upload the GSTR-2B Excel for this client, then use the tabs below to
            map &quot;Ledger Name&quot;, mark Accept/Reject/Pending actions, and finally
            download a ready-to-import Excel for Tally.
          </p>
        </motion.header>

        {status.message ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow ${
              status.type === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {status.message}
          </div>
        ) : null}

        <motion.section
          className="rounded-3xl border border-dashed border-amber-200 bg-white/90 p-6 shadow-lg backdrop-blur space-y-3"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <FiUploadCloud className="text-amber-500" />
            Step A – Upload GSTR-2B Excel
          </h2>
          <p className="text-sm text-slate-600">
            Start by selecting the exact GSTR-2B Excel you downloaded from the
            portal for this client. ImportEase will read only the required
            sheets.
          </p>
          <ul className="list-disc list-inside text-xs text-slate-500 space-y-1">
            <li>Accepted formats: .xlsx, .xls</li>
            <li>Use one file per month / return period</li>
            <li>If you picked the wrong file, simply upload again to replace it</li>
          </ul>
          <label className="mt-4 flex h-36 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/50 text-amber-700 transition hover:bg-amber-50">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            <span className="text-sm font-semibold flex items-center gap-2">
              <FiFilePlus />
              {uploading ? "Uploading..." : fileMeta.name || "Click to choose file"}
            </span>
            <span className="text-xs text-amber-500 mt-1">
              {fileMeta.name ? "Replace file" : "Max 10 MB"}
            </span>
          </label>
        </motion.section>

        {sheetRows.length ? (
          <motion.section
            className="rounded-3xl border border-amber-100 bg-white/95 p-6 shadow-lg backdrop-blur flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">
                Step 3
              </p>
              <h3 className="text-xl font-semibold text-slate-900">
                Step B – Check the imported B2B sheet
              </h3>
              <p className="text-sm text-slate-500">
                {sheetRows.length} rows imported from {fileMeta.name}. If the
                count looks wrong, go back and check the GSTR-2B file.
              </p>
            </div>
            <button
              onClick={handleGenerate}
              className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2 text-white text-sm font-semibold shadow hover:bg-amber-600"
            >
              <FiPlayCircle />
              Generate working sheet
            </button>
          </motion.section>
        ) : null}

        {generatedRows.length ? (
          <motion.section
            className="rounded-3xl border border-amber-100 bg-white/95 p-6 shadow-lg backdrop-blur space-y-4"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">
                  Step C – Map ledgers & actions, then download
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  Use the tabs below (Processed, Reverse Charge, Mismatched,
                  Disallow) to fill &quot;Ledger Name&quot;, mark whether input tax
                  credit is accepted, and set the final action for each invoice.
                </p>
                <ul className="list-disc list-inside text-xs text-slate-500 space-y-1 mt-2">
                  <li>
                    Start with <strong>Processed</strong> – normal invoices
                    where GSTR-2B and your books agree
                  </li>
                  <li>
                    Use <strong>Mismatched</strong> to decide Accept / Reject /
                    Pending and capture reasons
                  </li>
                  <li>
                    Download the final Excel only after you have set ledger
                    names and actions as required
                  </li>
                </ul>
              </div>

              <div className="flex flex-wrap gap-3">
              <button
                onClick={handleDownloadGstr2BExcel}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-slate-800"
              >
                <FiDownload />
                Download GSTR-2B Excel
              </button>
              <button
              onClick={handleDownloadProcessedExcel}
              disabled={!downloadsUnlocked}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiDownload />
              TallyProcessedExcel
            </button>
              <button
                onClick={handleDownloadMismatchedExcel}
                disabled={!downloadsUnlocked}
                className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiDownload />
                Mismatched Excel
              </button>
              <button
                onClick={handleDownloadReverseChargeExcel}
                disabled={!downloadsUnlocked}
                className="inline-flex items-center gap-2 rounded-full bg-purple-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiDownload />
                Reverse Charge Excel
              </button>
              <button
                onClick={handleDownloadDisallowExcel}
                disabled={!downloadsUnlocked}
                className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiDownload />
                Disallow Excel
              </button>
              <button
                onClick={handleDownloadCombinedExcel}
                disabled={!downloadsUnlocked}
                className="inline-flex items-center gap-2 rounded-full bg-indigo-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiDownload />
                Combined Excel (All Sheets)
              </button>
              <button
                onClick={handleDownloadActionJson}
                disabled={!downloadsUnlocked}
                className="inline-flex items-center gap-2 rounded-full bg-slate-600 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiDownload />
                Action JSON
              </button>
              <button
                onClick={handleProcessSheet}
                disabled={processing}
                className="inline-flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
              >
                <FiPlayCircle />
                {processing ? "Processing..." : "Process Sheet"}
              </button>
              <button
                onClick={openTallyModal}
                disabled={processing || !processedDoc}
                className="inline-flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
              >
                <FiRefreshCw />
                Tally with GSTR-2A
              </button>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 flex flex-col gap-2">
              <span className="inline-flex items-center gap-2 font-semibold">
                <FiAlertCircle />
                Unlock downloads in two steps
              </span>
              <ol className="list-decimal list-inside text-xs text-slate-600 space-y-1">
                <li>Click “Process Sheet” once your file is uploaded.</li>
                <li>
                  When processing finishes, TallyProcessedExcel & Mismatched buttons will
                  turn solid and become clickable.
                </li>
              </ol>
            </div>

            {processedDoc ? (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
                Stored {processedDoc.processedRows?.length || 0} matched rows,{" "}
                {processedDoc.mismatchedRows?.length || 0} mismatched rows,{" "}
                {processedDoc.reverseChargeRows?.length || 0} reverse charge rows, and{" "}
                {(processedDoc.disallowRows?.length ||
                  filterDisallowRows(processedDoc.processedRows || []).length) || 0}{" "}
                disallow rows for {processedDoc.company || "company"}.
              </div>
            ) : null}
            </div>
          </motion.section>
        ) : null}

        {(hasProcessedRows || hasReverseChargeRows || hasMismatchedRows || hasDisallowRows) ? (
          <motion.section
            className="rounded-3xl border border-amber-100 bg-white/95 p-6 shadow-lg backdrop-blur space-y-4"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            {missingSuppliers.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <FiAlertCircle className="text-amber-600 mt-0.5 shrink-0" size={18} />
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-amber-900 mb-1">
                          Missing from Party Master
                        </h4>
                        <p className="text-xs text-amber-700">
                          The following suppliers with their GSTIN numbers are not present in the party master for this company:
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-amber-500"
                          checked={allMissingSelected}
                          onChange={(e) => toggleMissingSelectAll(e.target.checked)}
                        />
                        Select all
                      </label>
                    </div>

                    <div className="max-h-56 overflow-y-auto space-y-2">
                      {missingSuppliers.map((supplier, idx) => {
                        const key = getMissingKey(supplier, idx);
                        return (
                          <div
                            key={`${key}-${idx}`}
                            className="flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-amber-500"
                              checked={missingSelection.has(key)}
                              onChange={() => toggleMissingSelection(key)}
                            />
                            <span className="font-medium text-slate-900 min-w-[200px]">
                              {supplier.supplierName}
                            </span>
                            <span className="text-slate-600 font-mono">
                              {supplier.gstin}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-col gap-2 text-xs text-amber-700">
                      <p className="font-semibold">
                        Please download the Excel before saving to Party Master if you need a copy. After saving, this list will no longer be downloadable.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleSaveMissingSuppliers}
                        disabled={readOnly}
                        className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-white text-xs font-semibold shadow hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <FiSave />
                        Save to Party Master
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadMissingSuppliers}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-white text-xs font-semibold shadow hover:bg-slate-800"
                      >
                        <FiDownload />
                        Download Excel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {/* Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-amber-200">
              {tabOrder.map((key) => {
                const config = tabConfigs[key];
                if (!config) return null;
                const isActive = activeTab === key;
                const activeClass =
                  tabActiveClasses[key] ||
                  "border-amber-500 text-amber-700";
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                      isActive
                        ? activeClass
                        : "border-transparent text-slate-500 hover:text-slate-700"
                    } ${config.hasRows ? "" : "opacity-50 cursor-not-allowed"}`}
                    disabled={!config.hasRows}
                  >
                    {config.label} ({config.count})
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-xl font-semibold text-slate-900">
                  {`Review ${activeLabel}`}
                </h3>
                <p className="text-sm text-slate-600">
                  Click the Ledger Name column to pick from saved ledgers or type to
                  search. Filling these is optional and only affects your download.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadLedgerNames}
                  disabled={ledgerNamesLoading}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FiRefreshCw
                    className={ledgerNamesLoading ? "animate-spin" : ""}
                  />
                  {ledgerNamesLoading ? "Refreshing..." : "Refresh names"}
                </button>
                <button
                  type="button"
                  onClick={openAddLedgerModal}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-amber-600"
                >
                  <FiPlus />
                  New ledger name
                </button>
                <button
                  type="button"
                  onClick={handleSaveLedgerNames}
                  disabled={!activeHasRows || !activeDirtyCount || activeSaving}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {activeSaving ? (
                    <>
                      <FiRefreshCw className="animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <FiSave />
                      {activeDirtyCount
                        ? `Save ${activeDirtyCount} change${
                            activeDirtyCount > 1 ? "s" : ""
                          }`
                        : "Save ledger names"}
                    </>
                  )}
                </button>
              </div>
            </div>
            {ledgerNames.length === 0 ? (
              <p className="text-xs text-rose-500">
                No saved ledger names yet. Add one to reuse it in every row.
              </p>
            ) : null}
            <div className="rounded-2xl border border-amber-100 overflow-auto max-h-[60vh] shadow-inner">
              <table className="min-w-full text-xs text-slate-700">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    {activeColumns.map((column) => {
                      // Skip the columns we're moving next to Ledger Name
                      if (['Accept Credit', 'Action', 'Action Reason', 'Narration'].includes(column)) {
                        return null;
                      }
                      return (
                        <th
                          key={column}
                          className={`px-2 py-2 text-left font-semibold border-b border-amber-100 ${
                            column === 'Ledger Name' ? 'pr-4 border-r-2 border-amber-200' : ''
                          }`}
                        >
                          {column}
                        </th>
                      );
                    })}
                    {/* Add grouped header for the ledger editing fields */}
                    {activeColumns.some(col => ['Accept Credit', 'Action', 'Action Reason', 'Narration'].includes(col)) && (
                      <th 
                        colSpan={
                          activeColumns.filter(col =>
                            ['Accept Credit', 'Action', 'Action Reason', 'Narration'].includes(col)
                          ).length + 2 // apply-below columns for ledger & action
                        }
                        className="px-2 py-2 text-left font-semibold border-b border-amber-100 bg-amber-50"
                      >
                        Ledger Actions
                      </th>
                    )}
                  </tr>
                  <tr className="bg-amber-50">
                    {activeColumns.map((column) => {
                      // Skip the columns we're moving next to Ledger Name in the main header
                      if (['Accept Credit', 'Action', 'Action Reason'].includes(column)) {
                        return null;
                      }
                      return <th key={`sub-${column}`} className="invisible"></th>;
                    })}
                    {/* Add sub-headers for the grouped fields */}
                    <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 border-b border-amber-100">
                      Apply Below
                    </th>
                    {activeColumns.includes('Accept Credit') && (
                      <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 border-b border-amber-100">
                        Accept Credit
                      </th>
                    )}
                    {activeColumns.includes('Action') && (
                      <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 border-b border-amber-100">
                        Action
                      </th>
                    )}
                    <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 border-b border-amber-100">
                      Apply Below
                    </th>
                    {activeColumns.includes('Action Reason') && (
                      <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 border-b border-amber-100">
                        Reason
                      </th>
                    )}
                    {activeColumns.includes('Narration') && (
                      <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 border-b border-amber-100">
                        Narration
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-50">
                  {activeRows.map((row, rowIdx) => {
                    const rowKey = getRowKey(row, rowIdx);
                    const ledgerValue = activeLedgerInputs[rowKey] ?? "";
                    const handleChange = activeHandleChange;
                    const columns = activeColumns;
                    const propagationState =
                      ledgerPropagationSelections[`${activeTab}-${rowKey}`];
                    const propagationTitle = propagationState
                      ? propagationState.matches
                        ? `Applied to ${propagationState.matches} matching row${
                            propagationState.matches === 1 ? "" : "s"
                          }`
                        : "No matching rows were found the last time you applied."
                      : "Apply this ledger to matching suppliers in later rows.";
                    
                    return (
                      <tr
                        key={rowKey}
                        className="hover:bg-amber-50/30 transition-colors"
                      >
                        {columns.map((column) => {
                          const cellKey = `${rowKey}-${column}`;
                          
                          // Skip the columns we're moving next to Ledger Name in the main cells
                          if (['Accept Credit', 'Action', 'Action Reason'].includes(column)) {
                            return null;
                          }
                          
                          return (
                            <td
                              key={cellKey}
                              className={`px-2 py-2 align-top text-[11px] ${
                                column === 'Ledger Name' ? 'pr-4 border-r-2 border-amber-200' : ''
                              }`}
                            >
                              {column === "Ledger Name" ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <LedgerNameDropdown
                                      value={ledgerValue}
                                      options={ledgerNames}
                                      onChange={(newValue) =>
                                        handleChange(rowKey, newValue)
                                      }
                                      onAddNew={async (newName) => {
                                        try {
                                          await createLedgerNameApi({ name: newName });
                                          await loadLedgerNames();
                                          handleChange(rowKey, newName);
                                          setStatus({
                                            type: "success",
                                            message: "Ledger name added.",
                                          });
                                        } catch (error) {
                                          console.error("Failed to add ledger name:", error);
                                          setStatus({
                                            type: "error",
                                            message:
                                              error?.response?.data?.message ||
                                              "Unable to add ledger name.",
                                          });
                                        }
                                      }}
                                    />
                                  </div>
                                  <div
                                    className="flex items-center gap-1 pr-1"
                                    title={propagationTitle}
                                  >
                                    {(() => {
                                      const checkboxId = `apply-ledger-${activeTab}-${rowKey}`;
                                      return (
                                        <>
                                          <input
                                            id={checkboxId}
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-amber-300 text-amber-500 focus:ring-amber-400"
                                            checked={Boolean(propagationState)}
                                            onChange={(event) =>
                                              handleLedgerPropagationToggle({
                                                checked: event.target.checked,
                                                rowIdx,
                                                rows: activeRows,
                                                sourceRow: row,
                                                ledgerValue,
                                                handleChange,
                                                tabKey: activeTab,
                                                rowKey,
                                              })
                                            }
                                          />
                                          <label
                                            htmlFor={checkboxId}
                                            className="text-[10px] text-slate-500 whitespace-nowrap cursor-pointer select-none"
                                          >
                                            Apply below
                                          </label>
                                        </>
                                      );
                                    })()}
                                  </div>
                                  
                                  {/* Accept Credit Field */}
                                  {activeColumns.includes('Accept Credit') && (
                                    <div className="w-28">
                                      {isMismatchedTab ? (
                                        <select
                                          value={
                                            Object.prototype.hasOwnProperty.call(
                                              acceptCreditDrafts,
                                              rowKey
                                            )
                                              ? acceptCreditDrafts[rowKey] ?? ""
                                              : row?.["Accept Credit"] ?? ""
                                          }
                                          onChange={(event) =>
                                            handleAcceptCreditChange(
                                              rowKey,
                                              event.target.value
                                            )
                                          }
                                          className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-amber-300"
                                        >
                                          <option value="">Credit?</option>
                                          <option value="Yes">Yes</option>
                                          <option value="No">No</option>
                                        </select>
                                      ) : (
                                        <div className="px-2 py-1 text-[11px]">
                                          {renderAcceptCreditBadge(
                                            Object.prototype.hasOwnProperty.call(
                                              acceptCreditDrafts,
                                              rowKey
                                            )
                                              ? acceptCreditDrafts[rowKey]
                                              : row?.["Accept Credit"]
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* Action Field */}
                                  {activeColumns.includes('Action') && (
                                    <div className="w-36 flex items-center gap-1">
                                      <select
                                        value={
                                          Object.prototype.hasOwnProperty.call(
                                            actionDrafts,
                                            rowKey
                                          )
                                            ? actionDrafts[rowKey] ?? ""
                                            : row?.["Action"] ?? ""
                                        }
                                        onChange={(event) =>
                                          handleActionChange(
                                            activeTab,
                                            rowKey,
                                            event.target.value
                                          )
                                        }
                                        className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-amber-300"
                                      >
                                        <option value="">Action</option>
                                        {ACTION_OPTIONS.map((option) => (
                                          <option key={option} value={option}>
                                            {option}
                                          </option>
                                        ))}
                                      </select>
                                      {(() => {
                                        const actionState =
                                          actionPropagationSelections[
                                            `${activeTab}-${rowKey}`
                                          ];
                                        const actionTitle = actionState
                                          ? actionState.matches
                                            ? `Applied to ${actionState.matches} matching row${
                                                actionState.matches === 1
                                                  ? ""
                                                  : "s"
                                              }`
                                            : "No matching rows were found the last time you applied."
                                          : "Apply this action (and reason, if any) to matching suppliers in later rows.";
                                        const checkboxId = `apply-action-${activeTab}-${rowKey}`;
                                        return (
                                          <div
                                            className="flex items-center gap-1"
                                            title={actionTitle}
                                          >
                                            <input
                                              id={checkboxId}
                                              type="checkbox"
                                              className="h-4 w-4 rounded border-amber-300 text-amber-500 focus:ring-amber-400"
                                              checked={Boolean(actionState)}
                                              onChange={(event) =>
                                                handleActionPropagationToggle({
                                                  checked: event.target.checked,
                                                  rowIdx,
                                                  rows: activeRows,
                                                  sourceRow: row,
                                                  tabKey: activeTab,
                                                  rowKey,
                                                })
                                              }
                                            />
                                            <label
                                              htmlFor={checkboxId}
                                              className="text-[10px] text-slate-500 whitespace-nowrap cursor-pointer select-none"
                                            >
                                              Apply below
                                            </label>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  )}
                                  
                                  {/* Action Reason Field */}
                                  {activeColumns.includes('Action Reason') && (
                                    <div className="w-36">
                                      {(() => {
                                        const actionValue = Object.prototype.hasOwnProperty.call(
                                          actionDrafts,
                                          rowKey
                                        )
                                          ? actionDrafts[rowKey]
                                          : row?.["Action"];
                                        const shouldShow = actionValue === "Reject" || actionValue === "Pending";
                                        if (!shouldShow) {
                                          return <div className="h-6"></div>; // Maintain consistent height
                                        }
                                        return (
                                          <input
                                            type="text"
                                            value={
                                              Object.prototype.hasOwnProperty.call(
                                                actionReasonDrafts,
                                                rowKey
                                              )
                                                ? actionReasonDrafts[rowKey] ?? ""
                                                : row?.["Action Reason"] ?? ""
                                            }
                                            onChange={(event) =>
                                              handleActionReasonChange(
                                                activeTab,
                                                rowKey,
                                                event.target.value
                                              )
                                            }
                                            placeholder="Reason..."
                                            className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-amber-300"
                                          />
                                        );
                                      })()}
                                    </div>
                                  )}
                                  
                                  {/* Narration Field */}
                                  {activeColumns.includes('Narration') && (
                                    <div className="w-48">
                                      <input
                                        type="text"
                                        value={
                                          Object.prototype.hasOwnProperty.call(
                                            narrationDrafts,
                                            rowKey
                                          )
                                            ? narrationDrafts[rowKey] ?? ""
                                            : row?.["Narration"] ?? ""
                                        }
                                        onChange={(event) =>
                                          handleNarrationChange(
                                            activeTab,
                                            rowKey,
                                            event.target.value
                                          )
                                        }
                                        placeholder="Narration..."
                                        className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-amber-300"
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span>{toDisplayValue(row?.[column])}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.section>
        ) : null}
      </section>

      {tallyModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Tally with GSTR-2A</h3>
                <p className="text-sm text-slate-600">
                  Select a processed GSTR-2A file. Matching Vch No rows will be removed from this GSTR-2B sheet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTallyModal((prev) => ({ ...prev, open: false }))}
                className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                aria-label="Close"
              >
                <FiX />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">
                Processed GSTR-2A file
              </label>
              <select
                value={tallyModal.selectedId}
                onChange={(e) =>
                  setTallyModal((prev) => ({ ...prev, selectedId: e.target.value }))
                }
                disabled={tallyModal.loading || tallyModal.options.length === 0}
                className="w-full rounded-lg border border-amber-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
              >
                {tallyModal.options.length === 0 ? (
                  <option value="">No processed GSTR-2A files</option>
                ) : (
                  tallyModal.options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
              {tallyModal.loading ? (
                <p className="text-xs text-slate-500">Loading files...</p>
              ) : null}
              {tallyModal.error ? (
                <p className="text-xs text-rose-600">{tallyModal.error}</p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTallyModal((prev) => ({ ...prev, open: false }))}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                disabled={tallyModal.submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTallySubmit}
                disabled={
                  tallyModal.submitting ||
                  tallyModal.loading ||
                  !tallyModal.selectedId
                }
                className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-amber-600 disabled:opacity-60"
              >
                {tallyModal.submitting ? (
                  <>
                    <FiRefreshCw className="animate-spin" />
                    Applying...
                  </>
                ) : (
                  "Apply"
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addLedgerModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[98vw] max-w-[98vw] p-6 bg-white rounded-2xl shadow-2xl space-y-4 max-h-[90vh] overflow-hidden">
            <div>
              <h3 className="text-2xl font-semibold text-slate-900">
                Add ledger name
              </h3>
              <p className="text-sm text-slate-600">
                Newly added names appear instantly in the dropdown list.
              </p>
            </div>
            <form onSubmit={handleAddLedgerSubmit} className="space-y-4">
              <input
                type="text"
                value={addLedgerModal.value}
                onChange={(event) =>
                  setAddLedgerModal((prev) => ({
                    ...prev,
                    value: event.target.value,
                  }))
                }
                className="w-full rounded-2xl border border-amber-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                placeholder="Enter ledger name"
                autoFocus
                disabled={addLedgerModal.submitting}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeAddLedgerModal}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  disabled={addLedgerModal.submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLedgerModal.submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-amber-600 disabled:opacity-60"
                >
                  {addLedgerModal.submitting ? "Adding..." : "Add ledger"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </motion.main>
  );
};

export default CompanyProcessor;

