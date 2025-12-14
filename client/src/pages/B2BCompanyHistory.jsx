import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiDownload,
  FiEye,
  FiFileText,
  FiInfo,
  FiLayers,
  FiPlus,
  FiRefreshCw,
  FiEdit2,
  FiX,
  FiSave,
  FiTrash2,
} from "react-icons/fi";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import * as XLSX from "xlsx-js-style";
import BackButton from "../components/BackButton";
import ExcelPreviewModal from "../components/ExcelPreviewModal.jsx";
import LedgerNameDropdown from "../components/LedgerNameDropdown";
import ConfirmDialog from "../components/ConfirmDialog";
import PlanRestrictionBanner from "../components/PlanRestrictionBanner.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { getPlanRestrictionMessage } from "../utils/planAccess.js";
import { fetchCompanyMasterById } from "../services/companymasterservices";
import {
  fetchImportById,
  fetchImportsByCompany,
  fetchProcessedFile,
  updateReverseChargeLedgerNames,
  updateMismatchedLedgerNames,
  updateDisallowLedgerNames,
  deleteImport,
} from "../services/gstr2bservice";
import {
  createLedgerName as createLedgerNameApi,
  fetchLedgerNames,
} from "../services/ledgernameservice";
import { gstr2bHeaders } from "../utils/gstr2bHeaders";
import { sanitizeFileName } from "../utils/fileUtils";
import { buildCombinedWorkbook } from "../utils/buildCombinedWorkbook";
import {
  buildActionJsonPayload,
  downloadJsonFile,
} from "../utils/actionJsonBuilder";
import useLedgerNameEditing from "../hooks/useLedgerNameEditing";

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

const toDisplayValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return String(value);
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

const normalizeActionValue = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "accept") return "Accept";
  if (lower === "reject") return "Reject";
  if (lower === "pending") return "Pending";
  return null;
};

const normalizeAcceptCreditValue = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "yes" || lower === "y") return "Yes";
  if (lower === "no" || lower === "n") return "No";
  return null;
};

const B2BCompanyHistory = () => {
  const { companyId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isPlanRestricted } = useAuth();
  const readOnly = !user?.isMaster && isPlanRestricted;
  const readOnlyMessage = readOnly
    ? getPlanRestrictionMessage(user?.planStatus)
    : "";

  const [company, setCompany] = useState(location.state?.company || null);
  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [preview, setPreview] = useState({
    open: false,
    title: "",
    columns: [],
    rows: [],
  });
  const [importCache, setImportCache] = useState({});
  const [processedCache, setProcessedCache] = useState({});
  const [ledgerNames, setLedgerNames] = useState([]);
  const [ledgerNamesLoading, setLedgerNamesLoading] = useState(false);
  const [addLedgerModal, setAddLedgerModal] = useState({
    open: false,
    value: "",
    submitting: false,
  });
  const [ledgerModal, setLedgerModal] = useState({
    open: false,
    processed: null,
    importId: null,
    activeTab: "processed", // "processed" or "reverseCharge"
  });
  const [modalAcceptCreditDrafts, setModalAcceptCreditDrafts] = useState({});
  const [modalActionDrafts, setModalActionDrafts] = useState({});
  const [modalActionReasonDrafts, setModalActionReasonDrafts] = useState({});
  const [modalNarrationDrafts, setModalNarrationDrafts] = useState({});
  const [
    modalLedgerPropagationSelections,
    setModalLedgerPropagationSelections,
  ] = useState({});
  const [
    modalActionPropagationSelections,
    setModalActionPropagationSelections,
  ] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const buildDownloadFilename = useCallback(
    (type, overrideName) => {
      const baseName = sanitizeFileName(
        overrideName || company?.companyName || "company"
      );
      const now = new Date();
      const month = now.toLocaleString("en-US", { month: "short" });
      const year = now.getFullYear();
      return `${baseName}-${type}-${month}-${year}`;
    },
    [company]
  );

  useEffect(() => {
    if (!company) {
      fetchCompanyMasterById(companyId)
        .then(({ data }) => setCompany(data))
        .catch((err) => {
          console.error("Failed to load company:", err);
          setPageError("Unable to load company details.");
        });
    }
  }, [company, companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    fetchImportsByCompany(companyId)
      .then(({ data }) => setImports(data || []))
      .catch((err) => {
        console.error("Failed to load imports:", err);
        setPageError("Unable to load import history.");
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!status.message) return;
    const timer = setTimeout(() => setStatus({ type: "", message: "" }), 4000);
    return () => clearTimeout(timer);
  }, [status]);

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
  }, []);

  useEffect(() => {
    loadLedgerNames();
  }, [loadLedgerNames]);

  useEffect(() => {
    if (!ledgerModal.open || !ledgerModal.importId) {
      setModalAcceptCreditDrafts({});
      setModalActionDrafts({});
      setModalActionReasonDrafts({});
      setModalNarrationDrafts({});
    }
  }, [ledgerModal.open, ledgerModal.importId]);

  const ensureImportDoc = async (importId) => {
    if (importCache[importId]) return importCache[importId];
    const { data } = await fetchImportById(importId);
    setImportCache((prev) => ({ ...prev, [importId]: data }));
    return data;
  };

  const ensureProcessedDoc = async (importId) => {
    if (processedCache[importId]) return processedCache[importId];
    try {
      const { data } = await fetchProcessedFile(importId);
      setProcessedCache((prev) => ({ ...prev, [importId]: data }));
      return data;
    } catch (error) {
      if (error.response?.status === 404) {
        setStatus({
          type: "error",
          message: "No processed data found. Please process this sheet first.",
        });
        return null;
      }
      throw error;
    }
  };

  const getProcessedRowKey = useCallback(
    (row, index) => String(row?._id ?? row?.slNo ?? index),
    []
  );

  const ledgerModalProcessedRows = useMemo(
    () => ledgerModal.processed?.processedRows || [],
    [ledgerModal.processed]
  );
  const ledgerModalReverseChargeRows = useMemo(
    () => ledgerModal.processed?.reverseChargeRows || [],
    [ledgerModal.processed]
  );
  const ledgerModalMismatchedRows = useMemo(
    () => ledgerModal.processed?.mismatchedRows || [],
    [ledgerModal.processed]
  );
  const ledgerModalDisallowRows = useMemo(
    () =>
      ledgerModal.processed?.disallowRows?.length
        ? ledgerModal.processed.disallowRows
        : filterDisallowRows(ledgerModal.processed?.processedRows || []),
    [ledgerModal.processed]
  );
  const ledgerModalRows = useMemo(
    () => {
      switch (ledgerModal.activeTab) {
        case "reverseCharge":
          return ledgerModalReverseChargeRows;
        case "mismatched":
          return ledgerModalMismatchedRows;
        case "disallow":
          return ledgerModalDisallowRows;
        default:
          return ledgerModalProcessedRows;
      }
    },
    [
      ledgerModal.activeTab,
      ledgerModalProcessedRows,
      ledgerModalReverseChargeRows,
      ledgerModalMismatchedRows,
      ledgerModalDisallowRows,
    ]
  );
  const ledgerModalUpdateMap = {
    processed: undefined,
    reverseCharge: updateReverseChargeLedgerNames,
    mismatched: updateMismatchedLedgerNames,
    disallow: updateDisallowLedgerNames,
  };
  const ledgerModalRowsKeyMap = {
    processed: "processedRows",
    reverseCharge: "reverseChargeRows",
    mismatched: "mismatchedRows",
    disallow: "disallowRows",
  };
  const hasLedgerModalRows = ledgerModalRows.length > 0;
  const hasReverseChargeRows = ledgerModalReverseChargeRows.length > 0;
  const hasMismatchedRows = ledgerModalMismatchedRows.length > 0;
  const hasDisallowRows = ledgerModalDisallowRows.length > 0;
  const isMismatchedModal = ledgerModal.activeTab === "mismatched";
  const ledgerModalRowMap = useMemo(() => {
    const map = new Map();
    ledgerModalRows.forEach((row, idx) => {
      map.set(getProcessedRowKey(row, idx), row);
    });
    return map;
  }, [ledgerModalRows, getProcessedRowKey]);

  const getModalActionValueForRow = useCallback(
    (row, rowKey) => {
      const hasDraft = Object.prototype.hasOwnProperty.call(
        modalActionDrafts,
        rowKey
      );
      const draftValue = hasDraft ? modalActionDrafts[rowKey] : undefined;
      const sourceValue =
        draftValue !== undefined ? draftValue : row?.Action ?? "";
      return normalizeActionValue(sourceValue);
    },
    [modalActionDrafts]
  );
  const renderModalAcceptCreditBadge = useCallback((value) => {
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

  const ledgerModalTabConfigs = [
    {
      key: "processed",
      label: `Processed Rows (${ledgerModalProcessedRows.length})`,
      enabled: ledgerModalProcessedRows.length > 0,
      activeClass: "border-amber-500 text-amber-700",
    },
    {
      key: "reverseCharge",
      label: `Reverse Charge Rows (${ledgerModalReverseChargeRows.length})`,
      enabled: hasReverseChargeRows,
      activeClass: "border-purple-500 text-purple-700",
    },
    {
      key: "mismatched",
      label: `Mismatched Rows (${ledgerModalMismatchedRows.length})`,
      enabled: hasMismatchedRows,
      activeClass: "border-orange-500 text-orange-700",
    },
    {
      key: "disallow",
      label: `Disallow Rows (${ledgerModalDisallowRows.length})`,
      enabled: hasDisallowRows,
      activeClass: "border-red-500 text-red-700",
    },
  ];
  const ledgerModalColumns = useMemo(() => {
    const columnsToMove = [
      'gstRegistrationType',
      'state',
      'supplierState',
      'GSTR-1/1A/IFF/GSTR-5 Filing Date',
      'GSTR-2B Taxable Value'
    ];
    
    // Get base columns from the first row
    const base = ledgerModalRows[0]
      ? extractVisibleColumns(ledgerModalRows[0])
      : [];
    
    // Create a set of columns to move for faster lookup
    const columnsToMoveSet = new Set(columnsToMove);
    
    // Filter out the columns we want to move from their original positions
    const filteredColumns = base.filter(col => !columnsToMoveSet.has(col));
    
    // Find the index where we want to insert the columns (after the 4 editing columns)
    const ledgerNameIndex = filteredColumns.indexOf('Ledger Name');
    const insertIndex = ledgerNameIndex !== -1 ? ledgerNameIndex + 4 : 4;
    
    // Insert the columns at the desired position
    filteredColumns.splice(insertIndex, 0, ...columnsToMove);
    
    // Ensure Action, Action Reason, and Accept Credit are present
    const result = [...filteredColumns];
    
    // Add Accept Credit for mismatched tab if not already present
    if (
      ledgerModal.activeTab === "mismatched" &&
      !result.includes("Accept Credit")
    ) {
      result.push("Accept Credit");
    }
    
    // Add Action, Action Reason, and Narration if not already present
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
  }, [ledgerModalRows, ledgerModal.activeTab]);
  
  const {
    ledgerInputs: modalLedgerInputs,
    handleLedgerInputChange: modalHandleLedgerInputChange,
    dirtyCount: modalDirtyCount,
    persistLedgerChanges: persistLedgerChangesModal,
    savingLedgerChanges: modalSavingLedgerChanges,
    setExtraRowDirtyState: setModalAcceptDirtyState,
  } = useLedgerNameEditing({
    rows: ledgerModalRows,
    importId: ledgerModal.importId,
    getRowKey: getProcessedRowKey,
    updateFunction: ledgerModalUpdateMap[ledgerModal.activeTab],
    rowsKey: ledgerModalRowsKeyMap[ledgerModal.activeTab] || "processedRows",
    getRowPayload: (row, rowKey) => {
      if (!row) return {};
      const payload = {
        action: getModalActionValueForRow(row, rowKey),
      };
      // Add Action Reason if Action is Reject or Pending
      const actionValue = getModalActionValueForRow(row, rowKey);
      if (actionValue === "Reject" || actionValue === "Pending") {
        const hasDraft = Object.prototype.hasOwnProperty.call(
          modalActionReasonDrafts,
          rowKey
        );
        const draftValue = hasDraft ? modalActionReasonDrafts[rowKey] : undefined;
        const sourceValue =
          draftValue !== undefined ? draftValue : row?.["Action Reason"] ?? "";
        payload.actionReason = sourceValue || null;
      }
      // Add Narration
      const hasNarrationDraft = Object.prototype.hasOwnProperty.call(
        modalNarrationDrafts,
        rowKey
      );
      const narrationDraftValue = hasNarrationDraft ? modalNarrationDrafts[rowKey] : undefined;
      const narrationSourceValue =
        narrationDraftValue !== undefined ? narrationDraftValue : row?.["Narration"] ?? "";
      payload.narration = narrationSourceValue || null;
      if (ledgerModal.activeTab === "mismatched") {
        const hasDraft = Object.prototype.hasOwnProperty.call(
          modalAcceptCreditDrafts,
          rowKey
        );
        const draftValue = hasDraft ? modalAcceptCreditDrafts[rowKey] : undefined;
        const sourceValue =
          draftValue !== undefined ? draftValue : row?.["Accept Credit"] ?? "";
        payload.acceptCredit = normalizeAcceptCreditValue(sourceValue);
      }
      return payload;
    },
    onUpdated: (updated) => {
      if (!updated || !ledgerModal.importId) return;
      setProcessedCache((prev) => ({
        ...prev,
        [ledgerModal.importId]: updated,
      }));
      setLedgerModal((prev) => ({ ...prev, processed: updated }));
      setModalAcceptCreditDrafts({});
      setModalActionDrafts({});
      setModalActionReasonDrafts({});
      setModalNarrationDrafts({});
    },
  });

  const isModalActionDirtyForRow = useCallback(
    (rowKey) => {
      const baseRow = ledgerModalRowMap.get(rowKey);
      const baseValue = normalizeActionValue(baseRow?.Action ?? "");
      if (!Object.prototype.hasOwnProperty.call(modalActionDrafts, rowKey)) {
        return false;
      }
      const draftValue = modalActionDrafts[rowKey];
      return (draftValue ?? null) !== (baseValue ?? null);
    },
    [ledgerModalRowMap, modalActionDrafts]
  );

  const isModalAcceptDirtyForRow = useCallback(
    (rowKey) => {
      const baseRow = ledgerModalRowMap.get(rowKey);
      const baseValue = normalizeAcceptCreditValue(
        baseRow?.["Accept Credit"] ?? ""
      );
      if (!Object.prototype.hasOwnProperty.call(modalAcceptCreditDrafts, rowKey)) {
        return false;
      }
      const draftValue = modalAcceptCreditDrafts[rowKey];
      return (draftValue ?? null) !== (baseValue ?? null);
    },
    [ledgerModalRowMap, modalAcceptCreditDrafts, normalizeAcceptCreditValue]
  );

  const handleLedgerModalAcceptCreditChange = useCallback(
    (rowKey, value) => {
      const baseRow = ledgerModalRowMap.get(rowKey);
      const normalized = normalizeAcceptCreditValue(value);
      const baseValue = normalizeAcceptCreditValue(
        baseRow?.["Accept Credit"] ?? ""
      );
      setModalAcceptCreditDrafts((prev) => {
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
      const actionDirty = isModalActionDirtyForRow(rowKey);
      setModalAcceptDirtyState(
        rowKey,
        (normalized ?? null) !== (baseValue ?? null) || actionDirty
      );
    },
    [
      ledgerModalRowMap,
      normalizeAcceptCreditValue,
      isModalActionDirtyForRow,
      setModalAcceptDirtyState,
    ]
  );

  const handleLedgerModalActionChange = useCallback(
    (rowKey, value) => {
      const baseRow = ledgerModalRowMap.get(rowKey);
      const normalized = normalizeActionValue(value);
      const baseValue = normalizeActionValue(baseRow?.Action ?? "");
      setModalActionDrafts((prev) => {
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
        setModalActionReasonDrafts((prev) => {
          const next = { ...prev };
          if (Object.prototype.hasOwnProperty.call(next, rowKey)) {
            delete next[rowKey];
            return next;
          }
          return prev;
        });
      } else if (normalized === "Reject" || normalized === "Pending") {
        // Clear Action Reason when changing to Reject/Pending to make it fresh/empty
        setModalActionReasonDrafts((prev) => {
          const next = { ...prev };
          next[rowKey] = ""; // Set to empty string for fresh input
          return next;
        });
      }
      const acceptDirty = isMismatchedModal
        ? isModalAcceptDirtyForRow(rowKey)
        : false;
      setModalAcceptDirtyState(
        rowKey,
        (normalized ?? null) !== (baseValue ?? null) || acceptDirty
      );
    },
    [
      ledgerModalRowMap,
      setModalAcceptDirtyState,
      isModalAcceptDirtyForRow,
      isMismatchedModal,
    ]
  );

  const handleLedgerModalActionReasonChange = useCallback(
    (rowKey, value) => {
      const baseRow = ledgerModalRowMap.get(rowKey);
      const rawValue = value ?? "";
      const baseValue = baseRow?.["Action Reason"] ?? "";
      setModalActionReasonDrafts((prev) => {
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
      // Mark as dirty if Action Reason changed
      const actionDirty = isModalActionDirtyForRow(rowKey);
      const acceptDirty = isMismatchedModal
        ? isModalAcceptDirtyForRow(rowKey)
        : false;
      setModalAcceptDirtyState(
        rowKey,
        (rawValue !== baseValue) || actionDirty || acceptDirty
      );
    },
    [
      ledgerModalRowMap,
      setModalAcceptDirtyState,
      isModalActionDirtyForRow,
      isMismatchedModal,
    ]
  );

  const handleLedgerModalNarrationChange = useCallback(
    (rowKey, value) => {
      const baseRow = ledgerModalRowMap.get(rowKey);
      const rawValue = value ?? "";
      const baseValue = baseRow?.["Narration"] ?? "";
      setModalNarrationDrafts((prev) => {
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
      // Mark as dirty if Narration changed
      const actionDirty = isModalActionDirtyForRow(rowKey);
      const acceptDirty = isMismatchedModal
        ? isModalAcceptDirtyForRow(rowKey)
        : false;
      setModalAcceptDirtyState(
        rowKey,
        (rawValue !== baseValue) || actionDirty || acceptDirty
      );
    },
    [
      ledgerModalRowMap,
      setModalAcceptDirtyState,
      isModalActionDirtyForRow,
      isMismatchedModal,
    ]
  );

  const downloadRawExcel = async (importId) => {
    try {
      const doc = await ensureImportDoc(importId);
      const rows = doc.rows || [];
      if (!rows.length) {
        setStatus({ type: "error", message: "No rows available in this import." });
        return;
      }
      const worksheetRows = rows.map((row) => {
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
        doc.companySnapshot?.companyName || company?.companyName
      )}.xlsx`;
      XLSX.writeFile(workbook, filename);
    } catch (err) {
      console.error("Failed to download raw excel:", err);
      setStatus({ type: "error", message: "Unable to download raw excel." });
    }
  };

  const openRawPreview = async (importId) => {
    try {
      const doc = await ensureImportDoc(importId);
      const rows = doc.rows || [];
      const columns = gstr2bHeaders.map(({ label }) => label);
      const formattedRows = rows.map((row) => {
        const entry = {};
        gstr2bHeaders.forEach(({ key, label }) => {
          entry[label] = row?.[key] ?? "";
        });
        return entry;
      });
      setPreview({
        open: true,
        title: "GSTR-2B Data",
        columns,
        rows: formattedRows,
      });
    } catch (err) {
      console.error("Failed to preview raw data:", err);
      setStatus({ type: "error", message: "Unable to preview raw data." });
    }
  };

  const downloadProcessedExcel = async (importId, mismatched = false) => {
    try {
      const doc = await ensureProcessedDoc(importId);
      if (!doc) {
        setStatus({
          type: "error",
          message: "No processed data found for this import.",
        });
        return;
      }
      const rows = mismatched ? doc.mismatchedRows : doc.processedRows;
      if (!rows?.length) {
        setStatus({
          type: "error",
          message: mismatched
            ? "No mismatched rows available."
            : "No processed rows available.",
        });
        return;
      }

      const workbook = XLSX.utils.book_new();
      const sanitizedSourceRows = stripMetaFields(rows);
      let exportRows = sanitizedSourceRows;
      if (mismatched) {
        exportRows = sanitizedSourceRows.map(
          (
            {
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
              rows?.[idx]?.["Accept Credit"] ?? rest["Accept Credit"] ?? "",
          })
        );
      }
      const sheet = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        mismatched ? "Mismatched" : "Processed"
      );
      const filename = `${buildDownloadFilename(
        mismatched ? "MismatchedExcel" : "TallyProcessedExcel",
        doc.company || company?.companyName
      )}.xlsx`;
      XLSX.writeFile(workbook, filename);
    } catch (err) {
      console.error("Failed to download processed excel:", err);
      setStatus({ type: "error", message: "Unable to download processed data." });
    }
  };

  const downloadReverseChargeExcel = async (importId) => {
    try {
      const doc = await ensureProcessedDoc(importId);
      if (!doc) {
        setStatus({
          type: "error",
          message: "No processed data found for this import.",
        });
        return;
      }
      const rows = doc.reverseChargeRows || [];
      if (!rows?.length) {
        setStatus({
          type: "error",
          message: "No reverse charge rows available.",
        });
        return;
      }

      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(stripMetaFields(rows));
      XLSX.utils.book_append_sheet(workbook, sheet, "Reverse Charge");
      const filename = `${buildDownloadFilename(
        "ReverseChargeExcel",
        doc.company || company?.companyName
      )}.xlsx`;
      XLSX.writeFile(workbook, filename);
      setStatus({
        type: "success",
        message: "Reverse charge Excel downloaded.",
      });
    } catch (err) {
      console.error("Failed to download reverse charge excel:", err);
      setStatus({ type: "error", message: "Unable to download reverse charge data." });
    }
  };

  const downloadDisallowExcel = async (importId) => {
    try {
      const doc = await ensureProcessedDoc(importId);
      if (!doc) {
        setStatus({
          type: "error",
          message: "No processed data found for this import.",
        });
        return;
      }
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
    } catch (err) {
      console.error("Failed to download disallow excel:", err);
      setStatus({ type: "error", message: "Unable to download disallow data." });
    }
  };

  const downloadCombinedExcel = async (importId) => {
    try {
      const doc = await ensureProcessedDoc(importId);
      if (!doc) {
        setStatus({
          type: "error",
          message: "No processed data found for this import.",
        });
        return;
      }
      const importDoc = await ensureImportDoc(importId);
      const originalRows = importDoc?.rows || [];
      const restSheets = importDoc?.restSheets || [];
      const processedRowsClean = stripMetaFields(doc.processedRows || []);
      const processedHeaders = processedRowsClean[0]
        ? extractVisibleColumns(processedRowsClean[0])
        : [];
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
        processedHeaders,
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
    } catch (err) {
      console.error("Failed to download combined excel:", err);
      setStatus({ type: "error", message: "Unable to download combined data." });
    }
  };

  const downloadActionJson = async (importId) => {
    try {
      const processed = await ensureProcessedDoc(importId);
      if (!processed) {
        setStatus({
          type: "error",
          message: "No processed data found for this import.",
        });
        return;
      }
      const importDoc = await ensureImportDoc(importId);
      const originalRows = importDoc?.rows || [];
      const rowGroups = [
        { rows: processed.processedRows || [] },
        { rows: processed.reverseChargeRows || [] },
        { rows: processed.mismatchedRows || [] },
        {
          rows:
            processed.disallowRows?.length > 0
              ? processed.disallowRows
              : filterDisallowRows(processed.processedRows || []),
        },
      ];

      const payload = buildActionJsonPayload({
        rowGroups,
        getRowKey: getProcessedRowKey,
        getActionValue: (row) => normalizeActionValue(row?.Action ?? ""),
        originalRows,
        companyGstin:
          processed.companySnapshot?.gstin ||
          processed.company ||
          company?.gstin ||
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
        processed.company || company?.companyName || "company"
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
        message: error?.message || "Unable to download action JSON.",
      });
    }
  };

  const openProcessedPreview = async (
    importId,
    mismatched = false,
    reverseCharge = false,
    disallow = false
  ) => {
    try {
      const doc = await ensureProcessedDoc(importId);
      if (!doc) return;
      let rows;
      let previewTitle = "Processed Rows Preview";

      if (disallow) {
        rows =
          doc.disallowRows?.length > 0
            ? doc.disallowRows
            : filterDisallowRows(doc.processedRows || []);
        previewTitle = "Disallow Rows Preview";
      } else if (reverseCharge) {
        rows = doc.reverseChargeRows || [];
        previewTitle = "Reverse Charge Rows Preview";
      } else if (mismatched) {
        rows = doc.mismatchedRows || [];
        previewTitle = "Mismatched Rows Preview";
      } else {
        rows = doc.processedRows || [];
      }

      if (!rows?.length) {
        setStatus({
          type: "error",
          message: disallow
            ? "No disallow rows available."
            : reverseCharge
            ? "No reverse charge rows available."
            : mismatched
            ? "No mismatched rows available."
            : "No processed rows available.",
        });
        return;
      }
      const columnBlacklist = ["5%", "12%", "18%", "28%"];
      const sanitizedRows = stripMetaFields(rows);
      let columns = sanitizedRows[0]
        ? extractVisibleColumns(sanitizedRows[0])
        : [];
      let displayRows = sanitizedRows.slice(0, 100); // limit for modal

      if (mismatched) {
        let filteredColumns = columns.filter(
          (col) => !columnBlacklist.some((pattern) => col.includes(pattern))
        );
        if (!filteredColumns.includes("Accept Credit")) {
          filteredColumns = [...filteredColumns, "Accept Credit"];
        }
        columns = filteredColumns;
        displayRows = displayRows.map((row) =>
          columns.reduce((acc, col) => {
            acc[col] =
              col === "Accept Credit" ? row?.["Accept Credit"] ?? "" : row?.[col];
            return acc;
          }, {})
        );
      }

      setPreview({
        open: true,
        title: previewTitle,
        columns,
        rows: displayRows,
      });
    } catch (err) {
      console.error("Failed to preview processed data:", err);
      setStatus({ type: "error", message: "Unable to preview processed data." });
    }
  };

  const openProcessedEditor = async (importId) => {
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    try {
      const doc = await ensureProcessedDoc(importId);
      if (!doc) return;
      const hasAnyRows =
        (doc.processedRows?.length || 0) > 0 ||
        (doc.reverseChargeRows?.length || 0) > 0 ||
        (doc.mismatchedRows?.length || 0) > 0 ||
        ((doc.disallowRows?.length ||
          filterDisallowRows(doc.processedRows || []).length) > 0);
      if (!hasAnyRows) {
        setStatus({
          type: "error",
          message: "No processed data available for ledger editing.",
        });
        return;
      }
      setLedgerModal({
        open: true,
        processed: doc,
        importId,
        activeTab: "processed",
      });
    } catch (err) {
      console.error("Failed to open ledger editor:", err);
      setStatus({
        type: "error",
        message: "Unable to open ledger editor. Please try again.",
      });
    }
  };

  const closeLedgerModal = () =>
    setLedgerModal({ open: false, processed: null, importId: null, activeTab: "processed" });

  const handleLedgerModalSave = async () => {
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    try {
      const updated = await persistLedgerChangesModal();
      if (updated) {
        setStatus({
          type: "success",
          message: "Ledger names updated for this processed file.",
        });
        setModalAcceptCreditDrafts({});
        setModalActionDrafts({});
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

  const openAddLedgerModal = () => {
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    setAddLedgerModal({ open: true, value: "", submitting: false });
  };

  const closeAddLedgerModal = () =>
    setAddLedgerModal({ open: false, value: "", submitting: false });

  const handleAddLedgerSubmit = async (event) => {
    event.preventDefault();
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
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

  const handleDeleteImport = async () => {
    if (!confirmDeleteId) return;
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      setConfirmDeleteId(null);
      return;
    }
    setDeleting(true);
    try {
      await deleteImport(confirmDeleteId);
      setStatus({
        type: "success",
        message: "Import and processed file deleted successfully.",
      });
      // Remove from cache
      setImportCache((prev) => {
        const next = { ...prev };
        delete next[confirmDeleteId];
        return next;
      });
      setProcessedCache((prev) => {
        const next = { ...prev };
        delete next[confirmDeleteId];
        return next;
      });
      // Refresh imports list
      const { data } = await fetchImportsByCompany(companyId);
      setImports(data || []);
      setConfirmDeleteId(null);
    } catch (error) {
      console.error("Failed to delete import:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to delete import. Please try again.",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-white text-amber-800">
        Loading history...
      </main>
    );
  }

  return (
    <motion.main
      className="min-h-screen bg-gradient-to-br from-amber-50 via-rose-50 to-white p-4 sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <section className="mx-auto max-w-6xl space-y-5">
        {pageError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow">
            {pageError}
          </div>
        ) : null}

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

        <BackButton label="Back to history" fallback="/b2b-history" />

        <motion.header
          className="rounded-3xl border border-amber-100 bg-white/90 p-6 sm:p-8 shadow-lg backdrop-blur space-y-3"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">
            ImportEase – client history
          </p>
          <h1 className="text-3xl font-bold text-slate-900">
            {company?.companyName || "Company"}
          </h1>
          <div className="text-sm text-slate-600 space-y-1">
            <p>{company?.address}</p>
            <p>
              {company?.state}, {company?.country} - {company?.pincode}
            </p>
            <p>GSTIN: {company?.gstin || "—"}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-amber-700">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1">
              <FiInfo /> Use this page when you need to re-download Excel or
              correct ledgers for a past month.
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-rose-600">
              <FiLayers /> &quot;Mismatched&quot; shows supplier-wise
              differences; other buttons give ready-to-import Excel.
            </span>
          </div>
        </motion.header>

        <PlanRestrictionBanner />

        <motion.section
          className="rounded-3xl border border-amber-100 bg-white/95 p-4 sm:p-6 shadow-lg backdrop-blur space-y-4"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <FiFileText className="text-amber-500" />
            GSTR-2B Imports
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-slate-600">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2">Imported At</th>
                  <th className="px-2 py-2">Source File</th>
                  <th className="px-2 py-2">Rows</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.length ? (
                  imports.map((imp) => (
                    <tr
                      key={imp._id}
                      className="border-t border-amber-50 text-sm"
                    >
                      <td className="px-2 py-3">
                        {new Date(imp.createdAt).toLocaleString()}
                      </td>
                      <td className="px-2 py-3">{imp.sourceFileName || "—"}</td>
                      <td className="px-2 py-3">
                        {imp.rows?.length || imp.metadata?.totalRecords || 0}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-2">
                          {/* 1. GSTR-2B download & view */}
                          <button
                            onClick={() => downloadRawExcel(imp._id)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                          >
                            <FiDownload /> GSTR2B Excel
                          </button>
                          <button
                            onClick={() => openRawPreview(imp._id)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                          >
                            <FiEye /> View GSTR2B
                          </button>

                          {/* 2. Edit LedgerMaster */}
                          <button
                            onClick={() => openProcessedEditor(imp._id)}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={readOnly}
                            title={readOnly ? readOnlyMessage : "Edit ledger names"}
                          >
                            <FiEdit2 /> Edit LedgerMaster
                          </button>

                          {/* 3. Combined download */}
                          <button
                            onClick={() => downloadCombinedExcel(imp._id)}
                            className="inline-flex items-center gap-1 rounded-full border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                          >
                            <FiDownload /> Combined Excel
                          </button>
                          <button
                            onClick={() => downloadActionJson(imp._id)}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <FiDownload /> Action JSON
                          </button>

                          {/* 4. Processed download & view */}
                          <button
                            onClick={() => downloadProcessedExcel(imp._id, false)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                          >
                            <FiDownload /> TallyProcessedExcel
                          </button>
                          <button
                            onClick={() => openProcessedPreview(imp._id, false)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                          >
                            <FiEye /> View Processed
                          </button>

                          {/* 5. Mismatched download & view */}
                          <button
                            onClick={() => downloadProcessedExcel(imp._id, true)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                          >
                            <FiDownload /> Mismatched Excel
                          </button>
                          <button
                            onClick={() => openProcessedPreview(imp._id, true)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                          >
                            <FiEye /> View Mismatched
                          </button>

                          {/* 6. Reverse Charge download & view */}
                          <button
                            onClick={() => downloadReverseChargeExcel(imp._id)}
                            className="inline-flex items-center gap-1 rounded-full border border-purple-200 px-3 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50"
                          >
                            <FiDownload /> Reverse Charge Excel
                          </button>
                          <button
                            onClick={() => openProcessedPreview(imp._id, false, true)}
                            className="inline-flex items-center gap-1 rounded-full border border-purple-200 px-3 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50"
                          >
                            <FiEye /> View Reverse Charge
                          </button>

                          {/* 7. Disallow download & view */}
                          <button
                            onClick={() => downloadDisallowExcel(imp._id)}
                            className="inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            <FiDownload /> Disallow Excel
                          </button>
                          <button
                            onClick={() =>
                              openProcessedPreview(imp._id, false, false, true)
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            <FiEye /> View Disallow
                          </button>

                          {/* 8. Delete */}
                          <button
                            onClick={() => setConfirmDeleteId(imp._id)}
                            className="inline-flex items-center gap-1 rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={readOnly}
                            title={readOnly ? readOnlyMessage : "Delete import"}
                          >
                            <FiTrash2 /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-2 py-6 text-center text-slate-500"
                    >
                      No imports found for this company.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.section>
      </section>

      {ledgerModal.open && !readOnly ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[98vw] max-w-[98vw] rounded-3xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-hidden">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-semibold text-slate-900">
                  Edit ledger names
                </h3>
                <p className="text-sm text-slate-600">
                  Updates are saved to the processed file and shared with everyone.
                  Filling ledger names is optional.
                </p>
              </div>
              <button
                onClick={closeLedgerModal}
                className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                aria-label="Close"
              >
                <FiX />
              </button>
            </header>
            {/* Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-amber-200">
              {ledgerModalTabConfigs.map(({ key, label, enabled, activeClass }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    enabled &&
                    setLedgerModal((prev) => ({ ...prev, activeTab: key }))
                  }
                  disabled={!enabled}
                  className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                    ledgerModal.activeTab === key
                      ? activeClass
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  } ${enabled ? "" : "opacity-50 cursor-not-allowed"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadLedgerNames}
                disabled={ledgerNamesLoading}
                className="inline-flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FiRefreshCw className={ledgerNamesLoading ? "animate-spin" : ""} />
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
                onClick={handleLedgerModalSave}
                disabled={
                  !hasLedgerModalRows ||
                  !modalDirtyCount ||
                  modalSavingLedgerChanges
                }
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {modalSavingLedgerChanges ? (
                  <>
                    <FiRefreshCw className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <FiSave />
                    {modalDirtyCount
                      ? `Save ${modalDirtyCount} change${
                          modalDirtyCount > 1 ? "s" : ""
                        }`
                      : "Save ledger names"}
                  </>
                )}
              </button>
            </div>
            <div className="rounded-2xl border border-amber-100 overflow-auto max-h-[60vh] shadow-inner">
              {hasLedgerModalRows ? (
                <table className="w-full text-xs text-slate-700">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      {ledgerModalColumns.map((column) => {
                        // Skip the columns we're moving next to Ledger Name
                        if (['Accept Credit', 'Action', 'Action Reason', 'Narration'].includes(column)) {
                          return null;
                        }
                        return (
                          <th
                            key={column}
                            className={`px-1 py-1.5 text-left text-xs font-medium border-b border-amber-100 ${
                              column === 'Ledger Name' ? 'pr-4 border-r-2 border-amber-200' : ''
                            }`}
                          >
                            {column}
                          </th>
                        );
                      })}
                      {/* Add grouped header for the ledger editing fields */}
                      {ledgerModalColumns.some(col => ['Accept Credit', 'Action', 'Action Reason', 'Narration'].includes(col)) && (
                        <th 
                          colSpan={
                            ledgerModalColumns.filter(col =>
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
                      {ledgerModalColumns.map((column) => {
                        // Skip the columns we're moving next to Ledger Name in the main header
                        if (['Accept Credit', 'Action', 'Action Reason', 'Narration'].includes(column)) {
                          return null;
                        }
                        return <th key={`sub-${column}`} className="invisible"></th>;
                      })}
                      {/* Add sub-headers for the grouped fields */}
                      <th className="px-1 py-1 text-left text-xs font-normal text-slate-500 border-b border-amber-100">
                        Apply Below
                      </th>
                      {ledgerModalColumns.includes('Accept Credit') && (
                        <th className="px-1 py-1 text-left text-xs font-normal text-slate-500 border-b border-amber-100">
                          Accept Credit
                        </th>
                      )}
                      {ledgerModalColumns.includes('Action') && (
                        <th className="px-1 py-1 text-left text-xs font-normal text-slate-500 border-b border-amber-100">
                          Action
                        </th>
                      )}
                      <th className="px-1 py-1 text-left text-xs font-normal text-slate-500 border-b border-amber-100">
                        Apply Below
                      </th>
                      {ledgerModalColumns.includes('Action Reason') && (
                        <th className="px-1 py-1 text-left text-xs font-normal text-slate-500 border-b border-amber-100">
                          Reason
                        </th>
                      )}
                      {ledgerModalColumns.includes('Narration') && (
                        <th className="px-1 py-1 text-left text-xs font-normal text-slate-500 border-b border-amber-100">
                          Narration
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-50">
                    {ledgerModalRows.map((row, rowIdx) => {
                      const rowKey = getProcessedRowKey(row, rowIdx);
                      const ledgerValue = modalLedgerInputs[rowKey] ?? "";
                      const ledgerPropagationState =
                        modalLedgerPropagationSelections[`${ledgerModal.activeTab}-${rowKey}`];
                      const ledgerPropagationTitle = ledgerPropagationState
                        ? ledgerPropagationState.matches
                          ? `Applied to ${ledgerPropagationState.matches} matching row${
                              ledgerPropagationState.matches === 1 ? "" : "s"
                            }`
                          : "No matching rows were found the last time you applied."
                        : "Apply this ledger to matching suppliers in later rows.";
                      const actionPropagationState =
                        modalActionPropagationSelections[`${ledgerModal.activeTab}-${rowKey}`];
                      const actionPropagationTitle = actionPropagationState
                        ? actionPropagationState.matches
                          ? `Applied to ${actionPropagationState.matches} matching row${
                              actionPropagationState.matches === 1 ? "" : "s"
                            }`
                          : "No matching rows were found the last time you applied."
                        : "Apply this action (and reason, if any) to matching suppliers in later rows.";
                      return (
                        <tr
                          key={rowKey}
                          className="hover:bg-amber-50/30 transition-colors"
                        >
                          {ledgerModalColumns.map((column) => {
                            const cellKey = `${rowKey}-${column}`;
                            // Skip the columns we're moving next to Ledger Name in the main cells
                            if (['Accept Credit', 'Action', 'Action Reason', 'Narration'].includes(column)) {
                              return null;
                            }
                            return (
                              <td 
                                key={cellKey} 
                                className={`px-1 py-1 align-middle ${
                                  column === 'Ledger Name' ? 'pr-1 border-r-2 border-amber-200' : ''
                                }`}
                              >
                                {column === "Ledger Name" ? (
                                  <div className="flex items-center gap-1">
                                    <div className="flex-1">
                                      <LedgerNameDropdown
                                        value={ledgerValue}
                                        options={ledgerNames}
                                        onChange={(newValue) =>
                                          modalHandleLedgerInputChange(rowKey, newValue)
                                        }
                                        onAddNew={async (newName) => {
                                          try {
                                            await createLedgerNameApi({ name: newName });
                                            await loadLedgerNames();
                                            modalHandleLedgerInputChange(rowKey, newName);
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
                                      title={ledgerPropagationTitle}
                                    >
                                      {(() => {
                                        const checkboxId = `modal-apply-ledger-${ledgerModal.activeTab}-${rowKey}`;
                                        return (
                                          <>
                                            <input
                                              id={checkboxId}
                                              type="checkbox"
                                              className="h-4 w-4 rounded border-amber-300 text-amber-500 focus:ring-amber-400"
                                              checked={Boolean(
                                                ledgerPropagationState
                                              )}
                                              onChange={(event) => {
                                                const checked =
                                                  event.target.checked;
                                                const stateKey = `${ledgerModal.activeTab}-${rowKey}`;
                                                if (!checked) {
                                                  setModalLedgerPropagationSelections(
                                                    (prev) => {
                                                      if (!prev[stateKey])
                                                        return prev;
                                                      const next = { ...prev };
                                                      delete next[stateKey];
                                                      return next;
                                                    }
                                                  );
                                                  return;
                                                }

                                                const {
                                                  normalized: sourceSupplierNormalized,
                                                  original: sourceSupplier,
                                                } = getNormalizedSupplierName(
                                                  row
                                                );
                                                if (!sourceSupplierNormalized) {
                                                  setStatus({
                                                    type: "error",
                                                    message:
                                                      "Supplier name missing for this row, nothing to match against.",
                                                  });
                                                  return;
                                                }

                                                const trimmedLedger =
                                                  String(
                                                    ledgerValue ?? ""
                                                  ).trim();
                                                if (!trimmedLedger) {
                                                  setStatus({
                                                    type: "error",
                                                    message:
                                                      "Select a ledger name before applying it to other rows.",
                                                  });
                                                  return;
                                                }

                                                let appliedCount = 0;
                                                for (
                                                  let idx = rowIdx + 1;
                                                  idx < ledgerModalRows.length;
                                                  idx += 1
                                                ) {
                                                  const targetRow =
                                                    ledgerModalRows[idx];
                                                  const {
                                                    normalized: candidateSupplierNormalized,
                                                  } = getNormalizedSupplierName(
                                                    targetRow
                                                  );
                                                  if (
                                                    candidateSupplierNormalized &&
                                                    candidateSupplierNormalized ===
                                                      sourceSupplierNormalized
                                                  ) {
                                                    const targetRowKey =
                                                      getProcessedRowKey(
                                                        targetRow,
                                                        idx
                                                      );
                                                    modalHandleLedgerInputChange(
                                                      targetRowKey,
                                                      trimmedLedger
                                                    );
                                                    appliedCount += 1;
                                                  }
                                                }

                                                setModalLedgerPropagationSelections(
                                                  (prev) => ({
                                                    ...prev,
                                                    [stateKey]: {
                                                      ledger: trimmedLedger,
                                                      supplier: sourceSupplier,
                                                      matches: appliedCount,
                                                      appliedAt: Date.now(),
                                                    },
                                                  })
                                                );

                                                setStatus({
                                                  type: appliedCount
                                                    ? "success"
                                                    : "info",
                                                  message: appliedCount
                                                    ? `Applied ledger to ${appliedCount} matching row${
                                                        appliedCount > 1
                                                          ? "s"
                                                          : ""
                                                      }.`
                                                    : "No later rows found with the same supplier name.",
                                                });
                                              }}
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
                                    {ledgerModalColumns.includes('Accept Credit') && (
                                      <div className="w-20">
                                        {isMismatchedModal ? (
                                          <select
                                            value={
                                              (() => {
                                                const hasDraft = Object.prototype.hasOwnProperty.call(
                                                  modalAcceptCreditDrafts,
                                                  rowKey
                                                );
                                                const draftValue = hasDraft ? modalAcceptCreditDrafts[rowKey] : undefined;
                                                const sourceValue =
                                                  draftValue !== undefined ? draftValue : row?.["Accept Credit"] ?? "";
                                                return normalizeAcceptCreditValue(sourceValue) ?? "";
                                              })()
                                            }
                                            onChange={(event) =>
                                              handleLedgerModalAcceptCreditChange(
                                                rowKey,
                                                event.target.value
                                              )
                                            }
                                            className="w-full rounded border border-amber-200 bg-white px-1 py-0.5 text-xs font-medium text-slate-700 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-amber-300"
                                          >
                                            <option value="">Credit?</option>
                                            <option value="Yes">Yes</option>
                                            <option value="No">No</option>
                                          </select>
                                        ) : (
                                          <div className="px-1 py-0.5 text-xs">
                                            {renderModalAcceptCreditBadge(
                                              Object.prototype.hasOwnProperty.call(
                                                modalAcceptCreditDrafts,
                                                rowKey
                                              )
                                                ? modalAcceptCreditDrafts[rowKey]
                                                : row?.["Accept Credit"]
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    
                                    {/* Action Field */}
                                    {ledgerModalColumns.includes('Action') && (
                                      <div className="w-32 flex items-center gap-1">
                                        <select
                                          value={getModalActionValueForRow(row, rowKey) ?? ""}
                                          onChange={(event) =>
                                            handleLedgerModalActionChange(
                                              rowKey,
                                              event.target.value
                                            )
                                          }
                                          className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-amber-300"
                                        >
                                          <option value="">Action</option>
                                          {ACTION_OPTIONS.map((option) => (
                                            <option key={option} value={option}>
                                              {option}
                                            </option>
                                          ))}
                                        </select>
                                        {(() => {
                                          const checkboxId = `modal-apply-action-${ledgerModal.activeTab}-${rowKey}`;
                                          return (
                                            <div
                                              className="flex items-center gap-1"
                                              title={actionPropagationTitle}
                                            >
                                              <input
                                                id={checkboxId}
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-amber-300 text-amber-500 focus:ring-amber-400"
                                                checked={Boolean(
                                                  actionPropagationState
                                                )}
                                                onChange={(event) => {
                                                  const checked =
                                                    event.target.checked;
                                                  const stateKey = `${ledgerModal.activeTab}-${rowKey}`;
                                                  if (!checked) {
                                                    setModalActionPropagationSelections(
                                                      (prev) => {
                                                        if (!prev[stateKey])
                                                          return prev;
                                                        const next = { ...prev };
                                                        delete next[stateKey];
                                                        return next;
                                                      }
                                                    );
                                                    return;
                                                  }

                                                  const {
                                                    normalized: sourceSupplierNormalized,
                                                    original: sourceSupplier,
                                                  } = getNormalizedSupplierName(
                                                    row
                                                  );
                                                  if (!sourceSupplierNormalized) {
                                                    setStatus({
                                                      type: "error",
                                                      message:
                                                        "Supplier name missing for this row, nothing to match against.",
                                                    });
                                                    return;
                                                  }

                                                  const sourceAction =
                                                    getModalActionValueForRow(
                                                      row,
                                                      rowKey
                                                    );
                                                  const hasReason =
                                                    sourceAction ===
                                                      "Reject" ||
                                                    sourceAction === "Pending";
                                                  const sourceReasonRaw =
                                                    hasReason
                                                      ? (() => {
                                                          const hasDraft =
                                                            Object.prototype.hasOwnProperty.call(
                                                              modalActionReasonDrafts,
                                                              rowKey
                                                            );
                                                          const draftValue =
                                                            hasDraft
                                                              ? modalActionReasonDrafts[
                                                                  rowKey
                                                                ]
                                                              : undefined;
                                                          const sourceValue =
                                                            draftValue !==
                                                            undefined
                                                              ? draftValue
                                                              : row?.[
                                                                  "Action Reason"
                                                                ] ?? "";
                                                          return String(
                                                            sourceValue ?? ""
                                                          ).trim();
                                                        })()
                                                      : "";

                                                  if (!sourceAction) {
                                                    setStatus({
                                                      type: "error",
                                                      message:
                                                        "Select an action before applying it to other rows.",
                                                    });
                                                    return;
                                                  }

                                                  let appliedCount = 0;
                                                  for (
                                                    let idx = rowIdx + 1;
                                                    idx <
                                                    ledgerModalRows.length;
                                                    idx += 1
                                                  ) {
                                                    const targetRow =
                                                      ledgerModalRows[idx];
                                                    const {
                                                      normalized: candidateSupplierNormalized,
                                                    } =
                                                      getNormalizedSupplierName(
                                                        targetRow
                                                      );
                                                    if (
                                                      candidateSupplierNormalized &&
                                                      candidateSupplierNormalized ===
                                                        sourceSupplierNormalized
                                                    ) {
                                                      const targetRowKey =
                                                        getProcessedRowKey(
                                                          targetRow,
                                                          idx
                                                        );
                                                      handleLedgerModalActionChange(
                                                        targetRowKey,
                                                        sourceAction
                                                      );
                                                      if (hasReason) {
                                                        handleLedgerModalActionReasonChange(
                                                          targetRowKey,
                                                          sourceReasonRaw
                                                        );
                                                      }
                                                      appliedCount += 1;
                                                    }
                                                  }

                                                  setModalActionPropagationSelections(
                                                    (prev) => ({
                                                      ...prev,
                                                      [stateKey]: {
                                                        action: sourceAction,
                                                        reason: hasReason
                                                          ? sourceReasonRaw
                                                          : "",
                                                        supplier: sourceSupplier,
                                                        matches: appliedCount,
                                                        appliedAt: Date.now(),
                                                      },
                                                    })
                                                  );

                                                  setStatus({
                                                    type: appliedCount
                                                      ? "success"
                                                      : "info",
                                                    message: appliedCount
                                                      ? `Applied action to ${appliedCount} matching row${
                                                          appliedCount > 1
                                                            ? "s"
                                                            : ""
                                                        }.`
                                                      : "No later rows found with the same supplier name.",
                                                  });
                                                }}
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
                                    {ledgerModalColumns.includes('Action Reason') && (
                                      <div className="w-28">
                                        {(() => {
                                          const actionValue = getModalActionValueForRow(row, rowKey);
                                          const shouldShow = actionValue === "Reject" || actionValue === "Pending";
                                          if (!shouldShow) {
                                            return <div className="h-8"></div>; // Maintain consistent height
                                          }
                                          const hasDraft = Object.prototype.hasOwnProperty.call(
                                            modalActionReasonDrafts,
                                            rowKey
                                          );
                                          const draftValue = hasDraft ? modalActionReasonDrafts[rowKey] : undefined;
                                          const currentValue =
                                            draftValue !== undefined ? draftValue : row?.["Action Reason"] ?? "";
                                          return (
                                            <input
                                              type="text"
                                              value={currentValue}
                                              onChange={(event) =>
                                                handleLedgerModalActionReasonChange(
                                                  rowKey,
                                                  event.target.value
                                                )
                                              }
                                              placeholder="Reason..."
                                              className="w-full rounded border border-amber-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-amber-300"
                                            />
                                          );
                                        })()}
                                      </div>
                                    )}
                                    
                                    {/* Narration Field */}
                                    {ledgerModalColumns.includes('Narration') && (
                                      <div className="w-40">
                                        <input
                                          type="text"
                                          value={
                                            Object.prototype.hasOwnProperty.call(
                                              modalNarrationDrafts,
                                              rowKey
                                            )
                                              ? modalNarrationDrafts[rowKey] ?? ""
                                              : row?.["Narration"] ?? ""
                                          }
                                          onChange={(event) =>
                                            handleLedgerModalNarrationChange(
                                              rowKey,
                                              event.target.value
                                            )
                                          }
                                          placeholder="Narration..."
                                          className="w-full rounded border border-amber-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-amber-300"
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
              ) : (
                <p className="p-6 text-center text-sm text-slate-500">
                  No processed rows available.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {addLedgerModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Add ledger name
              </h3>
              <p className="text-sm text-slate-600">
                Newly added names appear instantly in the dropdown list.
              </p>
            </div>
            <form className="space-y-4" onSubmit={handleAddLedgerSubmit}>
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

      <ExcelPreviewModal
        open={preview.open}
        title={preview.title}
        columns={preview.columns}
        rows={preview.rows}
        onClose={() => setPreview((prev) => ({ ...prev, open: false }))}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="Delete Import"
        message="Are you sure you want to delete this import? This will also delete the associated processed file data. This action cannot be undone."
        confirmText={deleting ? "Deleting..." : "Delete"}
        cancelText="Cancel"
        onConfirm={handleDeleteImport}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </motion.main>
  );
};

export default B2BCompanyHistory;

