import multer from "multer";
import XLSX from "xlsx";
import {
  create as createGstrImport,
  findByCompany as findImportsByCompany,
  findById as findImportById,
  deleteById as deleteImportById,
} from "../models/gstr2bimportmodel.js";
import {
  findById as findProcessedById,
  updateLedgerNames as updateProcessedLedgerNamesById,
  updateReverseChargeLedgerNames as updateReverseChargeLedgerNamesById,
  updateMismatchedLedgerNames as updateMismatchedLedgerNamesById,
  updateDisallowLedgerNames as updateDisallowLedgerNamesById,
  deleteById as deleteProcessedById,
  tallyWithGstr2A as tallyWithGstr2AById,
} from "../models/processedfilemodel.js";
import { findById as findGstr2AProcessedById } from "../models/processedfilemodel2a.js";
import { processAndStoreDocument } from "../utils/gstr2bProcessor.js";

const upload = multer({ storage: multer.memoryStorage() });

const HEADER_SEQUENCE = [
  { key: "gstin", label: "GSTIN of supplier", type: "string" },
  { key: "tradeName", label: "Trade/Legal name", type: "string" },
  { key: "invoiceNumber", label: "Invoice number", type: "string" },
  { key: "invoiceType", label: "Invoice type", type: "string" },
  { key: "invoiceDate", label: "Invoice Date", type: "string" },
  { key: "invoiceValue", label: "Invoice Value(₹)", type: "number" },
  { key: "placeOfSupply", label: "Place of supply", type: "string" },
  { key: "reverseCharge", label: "Supply Attract Reverse Charge", type: "string" },
  { key: "taxableValue", label: "Taxable Value (₹)", type: "number" },
  { key: "igst", label: "Integrated Tax(₹)", type: "number" },
  { key: "cgst", label: "Central Tax(₹)", type: "number" },
  { key: "sgst", label: "State/UT Tax(₹)", type: "number" },
  { key: "cess", label: "Cess(₹)", type: "number" },
  { key: "gstrPeriod", label: "GSTR-1/1A/IFF/GSTR-5 Period", type: "string" },
  { key: "gstrFilingDate", label: "GSTR-1/1A/IFF/GSTR-5 Filing Date", type: "date" },
  { key: "itcAvailability", label: "ITC Availability", type: "string" },
  { key: "reason", label: "Reason", type: "string" },
  { key: "taxRatePercent", label: "Applicable % of Tax Rate", type: "number" },
  { key: "source", label: "Source", type: "string" },
  { key: "irn", label: "IRN", type: "string" },
  { key: "irnDate", label: "IRN Date", type: "date" },
];

const sanitizeString = (value) => {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue.length ? stringValue : null;
};

const formatDisplayDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const dd = String(parsed.d).padStart(2, "0");
      const mm = String(parsed.m).padStart(2, "0");
      return `${dd}/${mm}/${parsed.y}`;
    }
  }
  if (value instanceof Date) {
    const dd = String(value.getDate()).padStart(2, "0");
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${value.getFullYear()}`;
  }
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

  const isPercentFormattedNumber =
    typeof value === "number" && Math.abs(value) <= 1;

  if (isPercentFormattedNumber) {
    return Number((parsed * 100).toFixed(2));
  }

  return parsed;
};

export const parseDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(
        Date.UTC(
          parsed.y,
          parsed.m - 1,
          parsed.d,
          parsed.H || 0,
          parsed.M || 0,
          parsed.S || 0
        )
      );
      return date.toISOString();
    }
  }
  const isoCandidate = new Date(value);
  return Number.isNaN(isoCandidate.getTime()) ? null : isoCandidate.toISOString();
};

const isRowEmpty = (row) =>
  !row ||
  !row.some(
    (cell) =>
      cell !== null &&
      cell !== undefined &&
      String(cell).trim().length > 0
  );

export const parseB2BSheet = (workbook) => {
  const sheet = workbook.Sheets["B2B"];
  if (!sheet) {
    throw new Error("B2B sheet not found in workbook");
  }

  const sheetRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const DATA_START_ROW = 6; // skip multi-row headers (first 6 rows)
  if (sheetRows.length <= DATA_START_ROW) return [];

  const dataRows = sheetRows.slice(DATA_START_ROW);

  return dataRows
    .filter((row) => !isRowEmpty(row))
    .map((row) => {
      const entry = {};

      HEADER_SEQUENCE.forEach(({ key, type }, index) => {
        const cell = row[index];
        if (key === "invoiceDate") {
          entry[key] = formatDisplayDate(cell);
        } else if (key === "gstrFilingDate") {
          entry[key] = formatDisplayDate(cell);
        } else if (key === "taxRatePercent") {
          entry[key] = parseTaxRatePercent(cell);
        } else if (type === "number") {
          entry[key] = parseNumber(cell);
        } else if (type === "date") {
          entry[key] = parseDate(cell);
        } else {
          entry[key] = sanitizeString(cell);
        }
      });

      return entry;
    });
};

const ADDITIONAL_HEADER_ROW_INDEX = 5;

const formatGenericCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number" && Number.isFinite(cell)) {
    return cell;
  }
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return formatDisplayDate(cell);
  }
  const stringValue = String(cell).trim();
  return stringValue.length ? stringValue : null;
};

// Detect if a row has meaningful header content
const hasHeaderContent = (row) => {
  if (!row || !Array.isArray(row)) return false;
  const nonEmptyCount = row.filter(
    (cell) => cell !== null && cell !== undefined && String(cell).trim().length > 0
  ).length;
  return nonEmptyCount >= 3; // At least 3 non-empty cells to be considered a header row
};

// Find header and sub-header rows (checking rows 5-6 or 6-7, 0-indexed: 4-5 or 5-6)
const findHeaderRows = (rows = []) => {
  // Try rows 5-6 first (0-indexed: 4-5)
  if (rows.length > 5) {
    const row5 = rows[4] || [];
    const row6 = rows[5] || [];
    if (hasHeaderContent(row5) && hasHeaderContent(row6)) {
      return { mainHeaderRow: 4, subHeaderRow: 5 };
    }
    if (hasHeaderContent(row5)) {
      // Only main header row found
      return { mainHeaderRow: 4, subHeaderRow: null };
    }
  }
  
  // Try rows 6-7 (0-indexed: 5-6)
  if (rows.length > 6) {
    const row6 = rows[5] || [];
    const row7 = rows[6] || [];
    if (hasHeaderContent(row6) && hasHeaderContent(row7)) {
      return { mainHeaderRow: 5, subHeaderRow: 6 };
    }
    if (hasHeaderContent(row6)) {
      return { mainHeaderRow: 5, subHeaderRow: null };
    }
  }
  
  // Fallback: find first non-empty row
  for (let idx = 0; idx < Math.min(10, rows.length); idx += 1) {
    if (hasHeaderContent(rows[idx])) {
      // Check if next row also has content (could be sub-header)
      if (idx + 1 < rows.length && hasHeaderContent(rows[idx + 1])) {
        return { mainHeaderRow: idx, subHeaderRow: idx + 1 };
      }
      return { mainHeaderRow: idx, subHeaderRow: null };
    }
  }
  
  return null;
};

// Combine main header and sub-header, handling merged cells
// When main header is empty in a cell, it means it's merged from previous cell
const combineHeaders = (mainHeaderRow, subHeaderRow, maxCols) => {
  const headers = [];
  let currentMainHeader = null;
  
  for (let colIdx = 0; colIdx < maxCols; colIdx += 1) {
    const mainCell = mainHeaderRow?.[colIdx];
    const subCell = subHeaderRow?.[colIdx];
    
    const mainValue = formatGenericCell(mainCell);
    const subValue = formatGenericCell(subCell);
    
    // If main header exists (not empty), update current main header
    // Empty cells in main header row indicate merged cells - keep using previous main header
    if (mainValue) {
      currentMainHeader = mainValue;
    }
    
    // If sub-header exists, combine with main header
    if (subValue) {
      if (currentMainHeader && currentMainHeader !== subValue) {
        // Only combine if they're different (avoid "Tax Amount(Tax Amount)")
        headers.push(`${subValue}(${currentMainHeader})`);
      } else {
        // If same or no main header, just use sub-header
        headers.push(subValue);
      }
    } else if (currentMainHeader) {
      // Only main header, no sub-header
      headers.push(currentMainHeader);
    } else {
      // No header at all
      headers.push(`Column ${colIdx + 1}`);
    }
  }
  
  return headers;
};

const parseAdditionalSheet = (sheet) => {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  
  if (!rows.length) {
    return null;
  }
  
  const headerInfo = findHeaderRows(rows);
  if (!headerInfo) {
    return null;
  }
  
  const { mainHeaderRow: mainIdx, subHeaderRow: subIdx } = headerInfo;
  const mainHeaderRow = rows[mainIdx] || [];
  const subHeaderRow = subIdx !== null ? (rows[subIdx] || []) : null;
  
  // Determine max columns by finding the longest row
  const maxCols = Math.max(
    mainHeaderRow.length,
    subHeaderRow ? subHeaderRow.length : 0,
    ...rows.slice(Math.max(mainIdx, subIdx !== null ? subIdx : mainIdx) + 1).map(r => r?.length || 0)
  );
  
  // Combine headers
  const headers = subHeaderRow
    ? combineHeaders(mainHeaderRow, subHeaderRow, maxCols)
    : mainHeaderRow.map((cell, idx) => {
        const value = formatGenericCell(cell);
        return value ?? `Column ${idx + 1}`;
      });
  
  // Determine data start row (after sub-header if exists, otherwise after main header)
  const dataStartRow = subIdx !== null ? subIdx + 1 : mainIdx + 1;
  
  const dataRows = rows
    .slice(dataStartRow)
    .map((row) => {
      const record = {};
      headers.forEach((header, idx) => {
        if (!header) return;
        const value = formatGenericCell(row[idx]);
        record[header] =
          value === null || value === undefined ? "" : value;
      });
      return record;
    })
    .filter((record) =>
      Object.values(record).some(
        (value) =>
          value !== null &&
          value !== undefined &&
          String(value).trim().length > 0
      )
    );

  return { headers, rows: dataRows };
};

const parseAdditionalSheets = (workbook) => {
  const sheetNames = workbook.SheetNames || [];
  const b2bIndex = sheetNames.findIndex(
    (name = "") => name.toLowerCase() === "b2b"
  );
  if (b2bIndex === -1) return [];
  const targetNames = sheetNames.slice(b2bIndex + 1);
  const parsed = [];
  targetNames.forEach((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const result = parseAdditionalSheet(sheet);
    if (result) {
      parsed.push({
        sheetName: name,
        headers: result.headers,
        rows: result.rows,
      });
    }
  });
  return parsed;
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
    }))
    .filter(
      (row) =>
        (row.slNo !== undefined && !Number.isNaN(row.slNo)) ||
        (row.index !== undefined && !Number.isNaN(row.index))
    );

export const uploadMiddleware = upload.single("file");

export const importB2BSheet = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file provided" });
    }

    const { companyId, companySnapshot } = req.body;

    if (!companyId) {
      return res
        .status(400)
        .json({ message: "companyId is required to import GSTR-2B data" });
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

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const rows = parseB2BSheet(workbook);
    const restSheets = parseAdditionalSheets(workbook);

    const document = await createGstrImport({
      company: companyId,
      companySnapshot: snapshot,
      sheetName: "B2B",
      rows,
      restSheets,
      sourceFileName: req.file.originalname,
      uploadedAt: new Date(),
    });

    return res.status(201).json(document);
  } catch (error) {
    console.error("importB2BSheet Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to import B2B sheet" });
  }
};

export const processB2BImport = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await findImportById(id);
    if (!doc) {
      return res.status(404).json({ message: "GSTR-2B import not found" });
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
    console.error("processB2BImport Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to process GSTR-2B data" });
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
    if (!companyId) {
      return res.status(400).json({ message: "companyId is required" });
    }

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
    const document = await findImportById(id);
    if (!document) {
      return res.status(404).json({ message: "GSTR-2B import not found" });
    }
    return res.status(200).json(document);
  } catch (error) {
    console.error("getImportById Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to fetch GSTR-2B import" });
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

    return res
      .status(200)
      .json({ message: "Ledger names updated.", processed: updated });
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

    // Ensure the response includes reverseChargeRows
    if (!updated.reverseChargeRows || !Array.isArray(updated.reverseChargeRows)) {
      console.error("Updated document missing reverseChargeRows:", updated);
      return res.status(500).json({ 
        message: "Server error: Updated document is missing reverse charge rows." 
      });
    }

    // Check if reverseChargeRows is empty
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
      return res.status(404).json({
        message:
          "Processed file not found or no mismatched rows available.",
      });
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
      return res.status(404).json({
        message:
          "Processed file not found or no disallow rows available.",
      });
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

export const deleteImport = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete both the import and the processed file
    const deletedImport = await deleteImportById(id);
    if (!deletedImport) {
      return res.status(404).json({
        message: "Import not found.",
      });
    }

    // Also delete the processed file if it exists (they share the same _id)
    await deleteProcessedById(id);

    return res.status(200).json({
      message: "Import and processed file deleted successfully.",
      deleted: deletedImport,
    });
  } catch (error) {
    console.error("deleteImport Error:", error);
    return res.status(500).json({
      message: error.message || "Failed to delete import.",
    });
  }
};

export const tallyWithGstr2A = async (req, res) => {
  try {
    const { id } = req.params;
    const { gstr2aId } = req.body || {};
    if (!gstr2aId) {
      return res.status(400).json({ message: "gstr2aId is required" });
    }

    const processed2B = await findProcessedById(id);
    if (!processed2B) {
      return res.status(404).json({ message: "Processed GSTR-2B file not found" });
    }

    const processed2A = await findGstr2AProcessedById(gstr2aId);
    if (!processed2A) {
      return res.status(404).json({ message: "Processed GSTR-2A file not found" });
    }

    const updated = await tallyWithGstr2AById(id, processed2A.processedRows || []);
    if (!updated) {
      return res.status(500).json({ message: "Failed to update processed GSTR-2B file" });
    }

    return res.status(200).json({
      message: "GSTR-2B sheet updated after tallying with GSTR-2A.",
      processed: updated,
    });
  } catch (error) {
    console.error("tallyWithGstr2A Error:", error);
    return res.status(500).json({
      message: error.message || "Failed to tally GSTR-2B with GSTR-2A",
    });
  }
};

