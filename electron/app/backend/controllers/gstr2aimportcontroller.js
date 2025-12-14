import multer from "multer";
import XLSX from "xlsx";
import {
  create as createGstrImport,
  findByCompany as findImportsByCompany,
  findById as findImportById,
  deleteById as deleteImportById,
} from "../models/gstr2aimportmodel.js";
import {
  findById as findProcessedById,
  appendManualRows as appendManualRowsById,
  updateLedgerNames as updateProcessedLedgerNamesById,
  updateReverseChargeLedgerNames as updateReverseChargeLedgerNamesById,
  updateMismatchedLedgerNames as updateMismatchedLedgerNamesById,
  updateDisallowLedgerNames as updateDisallowLedgerNamesById,
  deleteById as deleteProcessedById,
} from "../models/processedfilemodel2a.js";
import { processRows, processAndStoreDocument } from "../utils/gstr2aProcessor.js";

const upload = multer({ storage: multer.memoryStorage() });

// GSTR-2A CSV column headers (from row 3)
const CSV_COLUMN_MAP = {
  "GSTIN of supplier": "gstin",
  "Invoice number": "invoiceNumber",
  "Invoice type": "invoiceType",
  "Invoice Date": "invoiceDate",
  "Invoice Value (%u20B9)": "invoiceValue",
  "Place of supply": "placeOfSupply",
  "Supply Attract Reverse Charge": "reverseCharge",
  "Rate (%)": "ratePercent",
  "Taxable Value": "taxableValue",
  "Integrated Tax": "igst",
  "Central Tax": "cgst",
  "State/UT tax": "sgst",
  "Cess": "cess",
  "GSTR-1/IFF/GSTR-1A/GSTR-5 Filing Status": "gstrFilingStatus",
  "GSTR-3B Filing Status": "gstr3bFilingStatus",
  "Amendment made if any": "amendmentMade",
  "Tax Period in which Amended": "taxPeriodAmended",
  "Effective date of cancellation": "effectiveCancellationDate",
  "Source": "source",
  "IRN": "irn",
  "IRN Date": "irnDate",
};

const sanitizeString = (value) => {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue.length ? stringValue : null;
};

export const parseNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const normalized =
    typeof value === "string"
      ? value.replace(/,/g, "").replace(/%/g, "").trim()
      : Number(value);
  const parsed =
    typeof normalized === "number" ? normalized : Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTaxRatePercent = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  return parsed;
};

export const parseDate = (value) => {
  // Legacy helper kept for compatibility; not used in CSV parsing for GSTR-2A.
  if (value === null || value === undefined || value === "") return null;
  return String(value);
};

const isRowEmpty = (row) =>
  !row ||
  !row.some(
    (cell) =>
      cell !== null &&
      cell !== undefined &&
      String(cell).trim().length > 0
  );

// Parse CSV file - headers from row 3, data from row 4
export const parseGstr2ACSV = (csvBuffer) => {
  try {
    // Read CSV as workbook
    const workbook = XLSX.read(csvBuffer, { type: "buffer", raw: true, cellDates: false });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    if (!sheet) {
      throw new Error("No sheet found in CSV file");
    }

    // Convert to array of arrays
    const sheetRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    if (sheetRows.length < 4) {
      throw new Error("CSV file must have at least 4 rows (header row 3 + at least 1 data row)");
    }

    // Row 3 (index 2) contains headers
    const headerRow = sheetRows[2];
    if (!headerRow || !Array.isArray(headerRow)) {
      throw new Error("Header row (row 3) not found or invalid");
    }

    // Build column index map from headers
    const columnIndexMap = {};
    headerRow.forEach((header, index) => {
      if (header && String(header).trim()) {
        const headerKey = String(header).trim();
        if (CSV_COLUMN_MAP[headerKey]) {
          columnIndexMap[CSV_COLUMN_MAP[headerKey]] = index;
        }
      }
    });

    // Data starts from row 4 (index 3)
    const dataRows = sheetRows.slice(3);

    const mappedRows = dataRows
      .filter((row) => !isRowEmpty(row))
      .map((row) => {
        const entry = {};

        // Map each column
        Object.keys(columnIndexMap).forEach((key) => {
          const colIndex = columnIndexMap[key];
          const cell = row[colIndex];

          if (key === "invoiceDate" || key === "irnDate" || key === "effectiveCancellationDate") {
            entry[key] =
              cell === null || cell === undefined
                ? null
                : String(cell);
          } else if (key === "ratePercent") {
            entry[key] = parseTaxRatePercent(cell);
          } else if (key === "invoiceValue" || key === "taxableValue" || key === "igst" || 
                     key === "cgst" || key === "sgst" || key === "cess") {
            entry[key] = parseNumber(cell);
          } else {
            entry[key] = sanitizeString(cell);
          }
        });

        return entry;
      });

    // Deduplicate by invoice number (and GSTIN for safety), keeping the first occurrence
    const seenKeys = new Set();
    const dedupedRows = mappedRows.filter((row) => {
      const inv = (row?.invoiceNumber || "").trim().toUpperCase();
      const gstin = (row?.gstin || "").trim().toUpperCase();
      const key = `${inv}::${gstin}`;
      if (!inv) {
        // No invoice number -> keep (cannot dedupe confidently)
        return true;
      }
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    return dedupedRows;
  } catch (error) {
    console.error("parseGstr2ACSV Error:", error);
    throw new Error(`Failed to parse CSV: ${error.message}`);
  }
};

const sanitizeLedgerUpdateRows = (rows = []) =>
  rows
    .map((row) => ({
      slNo:
        row?.slNo !== undefined && row?.slNo !== null
          ? Number(row.slNo)
          : undefined,
      index:
        row?.index !== undefined && row?.index !== null
          ? Number(row.index)
          : undefined,
      ledgerName:
        typeof row?.ledgerName === "string" ? row.ledgerName : row?.ledgerName,
      acceptCredit:
        Object.prototype.hasOwnProperty.call(row ?? {}, "acceptCredit") ||
        Object.prototype.hasOwnProperty.call(row ?? {}, "accept_credit")
          ? row.acceptCredit ?? row.accept_credit ?? null
          : undefined,
      action:
        Object.prototype.hasOwnProperty.call(row ?? {}, "action") ||
        Object.prototype.hasOwnProperty.call(row ?? {}, "Action")
          ? row.action ?? row.Action ?? null
          : undefined,
      actionReason:
        Object.prototype.hasOwnProperty.call(row ?? {}, "actionReason") ||
        Object.prototype.hasOwnProperty.call(row ?? {}, "action_reason") ||
        Object.prototype.hasOwnProperty.call(row ?? {}, "Action Reason")
          ? (() => {
              const raw =
                row.actionReason ??
                row.action_reason ??
                row["Action Reason"] ??
                null;
              if (raw === undefined || raw === null) return null;
              const trimmed = sanitizeString(raw);
              return trimmed ? trimmed : null;
            })()
          : undefined,
      narration:
        Object.prototype.hasOwnProperty.call(row ?? {}, "narration") ||
        Object.prototype.hasOwnProperty.call(row ?? {}, "Narration")
          ? (() => {
              const raw =
                row.narration ??
                row.Narration ??
                null;
              if (raw === undefined || raw === null) return null;
              const trimmed = sanitizeString(raw);
              return trimmed ? trimmed : null;
            })()
          : undefined,
      itcAvailability:
        Object.prototype.hasOwnProperty.call(row ?? {}, "itcAvailability") ||
        Object.prototype.hasOwnProperty.call(row ?? {}, "ITC Availability")
          ? (() => {
              const raw =
                row.itcAvailability ?? row["ITC Availability"] ?? null;
              if (raw === undefined || raw === null) return null;
              const trimmed = String(raw).trim().toLowerCase();
              if (!trimmed) return null;
              if (trimmed === "yes" || trimmed === "y") return "Yes";
              if (trimmed === "no" || trimmed === "n") return "No";
              return null;
            })()
          : undefined,
      supplierName:
        Object.prototype.hasOwnProperty.call(row ?? {}, "supplierName") ||
        Object.prototype.hasOwnProperty.call(row ?? {}, "Supplier Name")
          ? (() => {
              const raw =
                row.supplierName ?? row["Supplier Name"] ?? null;
              if (raw === undefined || raw === null) return null;
              const trimmed = String(raw).trim();
              return trimmed.length ? trimmed : null;
            })()
          : undefined,
    }))
    .filter(
      (row) =>
        (row.slNo !== undefined && !Number.isNaN(row.slNo)) ||
        (row.index !== undefined && !Number.isNaN(row.index))
    );

export const uploadMiddleware = upload.single("file");

const sanitizeManualRows = (rows = []) =>
  rows
    .map((row, idx) => {
      const entry = { ...row };
      // Normalize field names to backend expectations
      entry.invoiceDate = row?.date ?? row?.invoiceDate ?? null;
      entry.invoiceNumber = row?.vchNo ?? row?.invoiceNumber ?? null;
      entry.referenceNo = entry.invoiceNumber;
      entry.referenceDate = entry.invoiceDate;
      entry.gstin = row?.gstin ?? row?.gstinUin ?? null;
      entry.placeOfSupply = row?.state ?? row?.placeOfSupply ?? null;
      entry.state = row?.state ?? row?.placeOfSupply ?? null;
      entry.supplierName = row?.supplierName ?? row?.["Supplier Name"] ?? null;
      entry.itcAvailability = row?.itcAvailability ?? row?.["ITC Availability"] ?? null;
      entry.reverseCharge = row?.reverseCharge ?? row?.["Reverse Supply Charge"] ?? null;
      entry.action = row?.action ?? row?.Action ?? null;
      entry.actionReason = row?.actionReason ?? row?.["Action Reason"] ?? null;
      entry.narration = row?.narration ?? row?.Narration ?? null;
      entry.ledgerName = row?.ledgerName ?? row?.["Ledger Name"] ?? null;
      entry.ratePercent = row?.ratePercent ?? row?.["Rate (%)"] ?? null;
      entry.igst = row?.igst ?? row?.["IGST"] ?? null;
      entry.cgst = row?.cgst ?? row?.["CGST"] ?? null;
      entry.sgst = row?.sgst ?? row?.["SGST/UTGST"] ?? null;
      entry.cess = row?.cess ?? row?.["Cess"] ?? null;
      entry.taxableValue = row?.taxableValue ?? row?.["Taxable Value"] ?? null;
      entry._isNewManual = true;
      entry._clientProvidedIndex = idx;
      return entry;
    })
    .filter((r) => r && Object.values(r).some((v) => v !== null && v !== undefined && String(v).trim() !== ""));

export const importGstr2ACSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file provided" });
    }

    const { companyId, companySnapshot } = req.body;

    if (!companyId) {
      return res
        .status(400)
        .json({ message: "companyId is required to import GSTR-2A data" });
    }

    let snapshot = companySnapshot;
    if (typeof snapshot === "string") {
      try {
        snapshot = JSON.parse(snapshot);
      } catch {
        snapshot = null;
      }
    }

    if (!snapshot) {
      return res
        .status(400)
        .json({ message: "Valid companySnapshot is required" });
    }

    const rows = parseGstr2ACSV(req.file.buffer);

    const document = await createGstrImport({
      company: companyId,
      companySnapshot: snapshot,
      sheetName: "GSTR-2A",
      rows,
      restSheets: [], // GSTR-2A CSV doesn't have additional sheets
      sourceFileName: req.file.originalname,
      uploadedAt: new Date(),
    });

    return res.status(201).json(document);
  } catch (error) {
    console.error("importGstr2ACSV Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to import GSTR-2A CSV" });
  }
};

export const processGstr2AImport = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await findImportById(id);
    if (!doc) {
      return res.status(404).json({ message: "GSTR-2A import not found" });
    }

    const processed = await processAndStoreDocument(doc);
    if (!processed) {
      return res
        .status(400)
        .json({ message: "No rows to process for this document" });
    }

    return res.status(200).json({
      message: "Processed successfully",
      processedCount: processed.processedRows.length,
      processed,
    });
  } catch (error) {
    console.error("processGstr2AImport Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to process GSTR-2A data" });
  }
};

export const getProcessedFile = async (req, res) => {
  try {
    const { id } = req.params;
    const processed = await findProcessedById(id);
    if (!processed) {
      return res.status(404).json({ message: "Processed file not found" });
    }
    return res.status(200).json(processed);
  } catch (error) {
    console.error("getProcessedFile Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to fetch processed file" });
  }
};

export const getImportsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const imports = await findImportsByCompany(companyId);
    return res.status(200).json(imports);
  } catch (error) {
    console.error("getImportsByCompany Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to fetch imports" });
  }
};

export const getImportById = async (req, res) => {
  try {
    const { id } = req.params;
    const importDoc = await findImportById(id);
    if (!importDoc) {
      return res.status(404).json({ message: "Import not found" });
    }
    return res.status(200).json(importDoc);
  } catch (error) {
    console.error("getImportById Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to fetch import" });
  }
};

export const updateProcessedLedgerNames = async (req, res) => {
  try {
    const { id } = req.params;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ message: "rows payload is required." });
    }

    const sanitized = sanitizeLedgerUpdateRows(rows);

    if (!sanitized.length) {
      return res
        .status(400)
        .json({ message: "rows payload is invalid or empty." });
    }

    const updated = await updateProcessedLedgerNamesById(id, sanitized);
    if (!updated) {
      return res.status(404).json({ message: "Processed file not found." });
    }

    return res.status(200).json({
      message: "Ledger names updated.",
      processed: updated,
    });
  } catch (error) {
    console.error("updateProcessedLedgerNames Error:", error);
    return res.status(500).json({
      message: error.message || "Failed to update ledger names.",
    });
  }
};

export const updateReverseChargeLedgerNames = async (req, res) => {
  try {
    const { id } = req.params;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ message: "rows payload is required." });
    }

    const sanitized = sanitizeLedgerUpdateRows(rows);

    if (!sanitized.length) {
      return res
        .status(400)
        .json({ message: "rows payload is invalid or empty." });
    }

    const updated = await updateReverseChargeLedgerNamesById(id, sanitized);
    if (!updated) {
      return res.status(404).json({ message: "Processed file not found or no reverse charge rows available." });
    }

    if (!updated.reverseChargeRows || !Array.isArray(updated.reverseChargeRows)) {
      console.error("Updated document missing reverseChargeRows:", updated);
      return res.status(500).json({ 
        message: "Server error: Updated document is missing reverse charge rows." 
      });
    }

    if (updated.reverseChargeRows.length === 0) {
      return res.status(400).json({ 
        message: "No reverse charge rows available to update." 
      });
    }

    return res
      .status(200)
      .json({ message: "Reverse charge ledger names updated.", processed: updated });
  } catch (error) {
    console.error("updateReverseChargeLedgerNames Error:", error);
    return res.status(500).json({
      message: error.message || "Failed to update reverse charge ledger names.",
    });
  }
};

export const updateMismatchedLedgerNames = async (req, res) => {
  try {
    const { id } = req.params;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ message: "rows payload is required." });
    }

    const sanitized = sanitizeLedgerUpdateRows(rows);

    if (!sanitized.length) {
      return res
        .status(400)
        .json({ message: "rows payload is invalid or empty." });
    }

    const updated = await updateMismatchedLedgerNamesById(id, sanitized);
    if (!updated) {
      return res.status(404).json({ message: "Processed file not found or no mismatched rows available." });
    }

    return res.status(200).json({
      message: "Mismatched ledger names updated.",
      processed: updated,
    });
  } catch (error) {
    console.error("updateMismatchedLedgerNames Error:", error);
    return res.status(500).json({
      message: error.message || "Failed to update mismatched ledger names.",
    });
  }
};

export const updateDisallowLedgerNames = async (req, res) => {
  try {
    const { id } = req.params;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ message: "rows payload is required." });
    }

    const sanitized = sanitizeLedgerUpdateRows(rows);

    if (!sanitized.length) {
      return res
        .status(400)
        .json({ message: "rows payload is invalid or empty." });
    }

    const updated = await updateDisallowLedgerNamesById(id, sanitized);
    if (!updated) {
      return res.status(404).json({ message: "Processed file not found or no disallow rows available." });
    }

    return res.status(200).json({
      message: "Disallow ledger names updated.",
      processed: updated,
    });
  } catch (error) {
    console.error("updateDisallowLedgerNames Error:", error);
    return res.status(500).json({
      message: error.message || "Failed to update disallow ledger names.",
    });
  }
};

export const appendManualRows = async (req, res) => {
  try {
    const { id } = req.params;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const sanitized = sanitizeManualRows(rows).filter((r) => !r.isNew);
    if (!sanitized.length) {
      return res.status(400).json({ message: "No manual rows provided." });
    }
    const importDoc = await findImportById(id);
    if (!importDoc) {
      return res.status(404).json({ message: "Import not found." });
    }
    const processedDoc = await findProcessedById(id);
    if (!processedDoc) {
      return res.status(404).json({ message: "Processed file not found." });
    }
    const companyId = importDoc.company;
    const startIndex = Array.isArray(processedDoc.processedRows)
      ? processedDoc.processedRows.length
      : 0;
    const { processedRows: manualProcessed } = await processRows(
      sanitized,
      companyId,
      startIndex
    );

    const updated = await appendManualRowsById(id, manualProcessed);
    if (!updated) {
      return res.status(404).json({ message: "Processed file not found." });
    }
    return res.status(200).json({
      message: "Manual rows appended.",
      processed: updated,
    });
  } catch (error) {
    console.error("appendManualRows Error:", error);
    return res.status(500).json({
      message: error.message || "Failed to append manual rows.",
    });
  }
};

export const deleteImport = async (req, res) => {
  try {
    const { id } = req.params;
    const importDoc = await findImportById(id);
    if (!importDoc) {
      return res.status(404).json({ message: "Import not found" });
    }

    await deleteImportById(id);
    await deleteProcessedById(id);

    return res.status(200).json({ message: "Import and processed data deleted successfully" });
  } catch (error) {
    console.error("deleteImport Error:", error);
    return res.status(500).json({
      message: error.message || "Failed to delete import",
    });
  }
};

