import { GST_STATE_CODES } from "../constants/gstStateCodes";

const ACTION_CODE_MAP = {
  Accept: "A",
  Reject: "R",
  Pending: "P",
};

const STATE_CODE_MAP = new Map(
  GST_STATE_CODES.map(({ name, code }) => [name.toLowerCase(), code])
);

const padTwo = (value) => String(value ?? "").padStart(2, "0");

const normalizeDateToDMY = (value) => {
  if (!value) return "";
  const stringValue = String(value).trim();
  if (!stringValue) return "";
  const match = stringValue.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/ // dd/mm/yyyy or dd-mm-yyyy
  );
  if (match) {
    const [, d, m, y] = match;
    const fullYear = y.length === 2 ? `20${y}` : y.padStart(4, "0");
    return `${padTwo(d)}-${padTwo(m)}-${fullYear}`;
  }
  const isoDate = new Date(stringValue);
  if (!Number.isNaN(isoDate.getTime())) {
    return `${padTwo(isoDate.getDate())}-${padTwo(isoDate.getMonth() + 1)}-${
      isoDate.getFullYear()
    }`;
  }
  return stringValue;
};

const parseAmount = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
};

const normalizeGstin = (value) => {
  if (!value) return "";
  const trimmed = String(value).trim().toUpperCase();
  if (trimmed.length === 15) {
    return trimmed;
  }
  return trimmed;
};

const MONTH_MAP = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const normalizeReturnPeriod = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) {
    return raw;
  }
  const normalized = raw.replace(/[^a-zA-Z0-9']/g, " ").trim();
  const match = normalized.match(
    /^([A-Za-z]+)'?(\d{2,4})$/ // e.g., Oct'25 or Oct25
  );
  if (match) {
    const month = MONTH_MAP[match[1].toLowerCase()] || "";
    if (!month) return "";
    const yearPart = match[2];
    const fullYear =
      yearPart.length === 2
        ? `20${yearPart}`
        : yearPart.padStart(4, "0").slice(-4);
    return `${month}${fullYear}`;
  }
  return "";
};

const getStateCodeFromPlace = (place = "") => {
  if (!place) return "";
  const trimmed = String(place).trim();
  if (!trimmed) return "";
  const digitMatch = trimmed.match(/(\d{2})/);
  if (digitMatch) {
    return digitMatch[1];
  }
  const normalized = trimmed.toLowerCase();
  if (STATE_CODE_MAP.has(normalized)) {
    return STATE_CODE_MAP.get(normalized);
  }
  const cleaned = normalized.replace(/\(.*?\)/g, "").replace(/[^a-z\s]/g, "").trim();
  return STATE_CODE_MAP.get(cleaned) || "";
};

const mapInvoiceTypeCode = (value) => {
  if (!value) return "R";
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return "R";
  if (normalized.startsWith("c")) return "C";
  if (normalized.startsWith("d")) return "D";
  return "R";
};

const getOriginalRow = (row, map) => {
  if (!row) return null;
  if (row._sourceRowId !== undefined && map.has(row._sourceRowId)) {
    return map.get(row._sourceRowId);
  }
  if (row.slNo !== undefined && row.slNo !== null) {
    const idx = Number(row.slNo) - 1;
    if (!Number.isNaN(idx) && map.has(idx)) {
      return map.get(idx);
    }
  }
  return null;
};

const buildInvoiceEntry = ({ row, originalRow, actionCode }) => {
  const placeOfSupply =
    originalRow?.placeOfSupply ?? row?.supplierState ?? row?.state ?? "";
  const invoiceNumber =
    originalRow?.invoiceNumber ?? row?.referenceNo ?? row?.vchNo ?? "";
  const invoiceDate =
    originalRow?.invoiceDate ?? row?.referenceDate ?? row?.date ?? "";
  const invoiceTypeCode = mapInvoiceTypeCode(
    originalRow?.invoiceType ?? row?.gstRegistrationType ?? row?.vchType
  );
  const supplierGSTIN = (
    originalRow?.gstin ?? row?.gstinUin ?? row?.gstin ?? ""
  ).trim();
  const supplierAmount = parseAmount(
    row?.supplierAmount ?? row?.invoiceAmount ?? originalRow?.invoiceValue
  );
  const taxableValue = parseAmount(
    originalRow?.taxableValue ?? row?.["GSTR-2B Taxable Value"]
  );
  const igstAmount = parseAmount(originalRow?.igst);
  const cgstAmount = parseAmount(originalRow?.cgst);
  const sgstAmount = parseAmount(originalRow?.sgst);
  const cessAmount = parseAmount(originalRow?.cess ?? row?.["Cess"]);

  return {
    stin: supplierGSTIN,
    rtnprd:
      normalizeReturnPeriod(
        originalRow?.gstrPeriod ?? row?.["GSTR-1/1A/IFF/GSTR-5 Period"]
      ) || "",
    srcform: "R1",
    inum: invoiceNumber,
    idt: normalizeDateToDMY(invoiceDate),
    inv_typ: invoiceTypeCode,
    pos: getStateCodeFromPlace(placeOfSupply),
    val: supplierAmount,
    txval: taxableValue,
    iamt: igstAmount,
    camt: cgstAmount,
    samt: sgstAmount,
    cess: cessAmount,
    action: actionCode,
    prev_status: "",
  };
};

export const buildActionJsonPayload = ({
  rowGroups = [],
  getRowKey,
  getActionValue,
  originalRows = [],
  companyGstin = "",
}) => {
  const trimmedGstin = normalizeGstin(companyGstin);
  const originalMap = new Map();
  originalRows.forEach((row, idx) => {
    originalMap.set(idx, row);
  });

  const entries = [];
  const seen = new Set();

  rowGroups.forEach(({ rows = [] }) => {
    rows.forEach((row, idx) => {
      const rowKey =
        typeof getRowKey === "function"
          ? getRowKey(row, idx)
          : row?._id ?? `${idx}`;
      const actionValue = getActionValue
        ? getActionValue(row, rowKey, idx)
        : row?.Action;
      const normalizedAction = actionValue
        ? String(actionValue).trim()
        : "";
      const actionCode = ACTION_CODE_MAP[normalizedAction];
      if (!actionCode) return;

      const signature =
        row?._id ?? `${rowKey}-${row?._sourceRowId ?? row?.slNo ?? idx}`;
      if (seen.has(signature)) return;
      seen.add(signature);

      const originalRow = getOriginalRow(row, originalMap);
      const invoiceEntry = buildInvoiceEntry({
        row,
        originalRow,
        actionCode,
      });

      if (!invoiceEntry.stin || !invoiceEntry.inum) {
        return;
      }

      entries.push(invoiceEntry);
    });
  });

  return {
    rtin: trimmedGstin,
    reqtyp: "SAVE",
    invdata: {
      b2b: entries,
    },
  };
};

export const downloadJsonFile = (payload, filename = "actions.json") => {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

