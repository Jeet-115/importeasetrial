import { findAll as findAllGstin } from "../models/gstinnumbermodel.js";
import { findAll as findAllPartyMasters } from "../models/partymastermodel.js";
import { upsert as upsertProcessedFile } from "../models/processedfilemodel2a.js";

const SLAB_CONFIG = [
  { label: "5%", igst: 5, cgst: 2.5, sgst: 2.5 },
  { label: "12%", igst: 12, cgst: 6, sgst: 6 },
  { label: "18%", igst: 18, cgst: 9, sgst: 9 },
  { label: "28%", igst: 28, cgst: 14, sgst: 14 },
];

const LEDGER_KEYS = {
  "5%": {
    ledgerAmount: "Ledger Amount 5%",
    ledgerCrDr: "Ledger DR/CR 5%",
    igst: "IGST Rate 5%",
    cgst: "CGST Rate 5%",
    sgst: "SGST/UTGST Rate 5%",
  },
  "12%": {
    ledgerAmount: "Ledger Amount 12%",
    ledgerCrDr: "Ledger DR/CR 12%",
    igst: "IGST Rate 12%",
    cgst: "CGST Rate 12%",
    sgst: "SGST/UTGST Rate 12%",
  },
  "18%": {
    ledgerAmount: "Ledger Amount 18%",
    ledgerCrDr: "Ledger DR/CR 18%",
    igst: "IGST Rate 18%",
    cgst: "CGST Rate 18%",
    sgst: "SGST/UTGST Rate 18%",
  },
  "28%": {
    ledgerAmount: "Ledger Amount 28%",
    ledgerCrDr: "Ledger DR/CR 28%",
    igst: "IGST Rate 28%",
    cgst: "CGST Rate 28%",
    sgst: "SGST/UTGST Rate 28%",
  },
};

const LEDGER_NAME_COLUMN = "Ledger Name";

let cachedStateMap = null;
let cachedPartyMasterMap = null;

const parseNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeItcAvailability = (value) => {
  if (value === null || value === undefined) return "Yes"; // Default to Yes
  const trimmed = String(value).trim();
  if (!trimmed) return "Yes";
  const lower = trimmed.toLowerCase();
  if (lower === "yes" || lower === "y") return "Yes";
  if (lower === "no" || lower === "n") return "No";
  return trimmed;
};

const determineSlab = (taxableValue, igst, cgst) => {
  if (!taxableValue) return null;
  const tolerance = 0.1;

  if (igst > 0) {
    const percent = (igst / taxableValue) * 100;
    const match = SLAB_CONFIG.find(
      (slab) => Math.abs(percent - slab.igst) <= tolerance
    );
    if (match) {
      return { slab: match.label, mode: "IGST" };
    }
  } else if (cgst > 0) {
    const percent = (cgst / taxableValue) * 100;
    const match = SLAB_CONFIG.find(
      (slab) => Math.abs(percent - slab.cgst) <= tolerance
    );
    if (match) {
      return { slab: match.label, mode: "CGST_SGST" };
    }
  }

  return null;
};

const initializeLedgerFields = () => {
  const fields = {};
  Object.keys(LEDGER_KEYS).forEach((slab) => {
    const keys = LEDGER_KEYS[slab];
    fields[keys.ledgerAmount] = null;
    fields[keys.ledgerCrDr] = null;
    fields[keys.igst] = null;
    fields[keys.cgst] = null;
    fields[keys.sgst] = null;
  });
  return fields;
};

const buildStateMap = async () => {
  if (cachedStateMap) return cachedStateMap;

  const rawResults = await findAllGstin();

  cachedStateMap = rawResults.reduce((acc, entry) => {
    if (entry?.gstCode && entry?.stateName) {
      acc.set(String(entry.gstCode).padStart(2, "0"), entry.stateName);
    }
    return acc;
  }, new Map());

  return cachedStateMap;
};

const buildPartyMasterMap = async (companyId) => {
  if (!companyId) return new Map();
  
  const parties = await findAllPartyMasters();
  const companyParties = parties.filter((p) => p.companyId === companyId);
  
  const partyMap = new Map();
  companyParties.forEach((party) => {
    if (party?.gstin) {
      const normalizedGstin = String(party.gstin).trim().toUpperCase();
      if (normalizedGstin) {
        partyMap.set(normalizedGstin, party.partyName || null);
      }
    }
  });
  
  return partyMap;
};

const interpretReverseChargeValue = (value) => {
  if (value === null || value === undefined) {
    return { isReverseCharge: false, displayValue: null };
  }

  const trimmed = String(value).trim().toUpperCase();
  if (!trimmed) {
    return { isReverseCharge: false, displayValue: null };
  }

  const truthy = trimmed === "YES" || trimmed === "Y" || trimmed === "1";
  const falsy = trimmed === "NO" || trimmed === "N" || trimmed === "0";

  return {
    isReverseCharge: truthy,
    displayValue: truthy ? "Yes" : falsy ? "No" : trimmed,
  };
};

const processRowWithMap = async (
  row,
  index,
  gstStateMap,
  partyMasterMap,
  reverseChargeLabel = null,
  companyId
) => {
  const gstin = (row?.gstin || "").trim();
  const stateFromPos = (row?.state || row?.placeOfSupply || "").trim();
  const supplierStateFromGstin = (() => {
    const code = gstin.slice(0, 2);
    return gstStateMap.get(code) || null;
  })();
  
  // Lookup supplier name from party master
  const normalizedGstin = gstin.toUpperCase();
  const partySupplier = partyMasterMap.get(normalizedGstin);
  const supplierName =
    partySupplier !== undefined && partySupplier !== null
      ? partySupplier
      : row?.supplierName || null;
  const supplierNameAutoFilled = Boolean(
    partySupplier !== undefined && partySupplier !== null
  );

  const taxableValue = parseNumber(row?.taxableValue);
  const invoiceValue = parseNumber(row?.invoiceValue);
  const igst = parseNumber(row?.igst);
  const cgst = parseNumber(row?.cgst);
  const sgst = parseNumber(row?.sgst);
  const cess = parseNumber(row?.cess);

  const rawInvoiceDate =
    row?.invoiceDate !== undefined && row?.invoiceDate !== null
      ? String(row.invoiceDate).trim()
      : null;

  const base = {
    _sourceRowId: index,
    slNo: index + 1,
    date: rawInvoiceDate,
    vchNo: row?.invoiceNumber || null,
    vchType: "PURCHASE",
    referenceNo: row?.invoiceNumber || null,
    referenceDate: rawInvoiceDate,
    supplierName: supplierName,
    _supplierNameAutoFilled: supplierNameAutoFilled,
    gstRegistrationType: row?.invoiceType === "R" ? "Regular" : row?.invoiceType || null,
    gstinUin: gstin || null,
    // Per requirement: state = Place of Supply; supplierState = from supplier GSTIN
    state: stateFromPos || null,
    supplierState: supplierStateFromGstin,
    supplierAmount: null,
    supplierDrCr: "CR",
    "Reverse Supply Charge": reverseChargeLabel,
    "GSTR-2A Invoice Value": invoiceValue || null,
    "GSTR-2A Taxable Value": taxableValue || null,
    "ITC Availability": normalizeItcAvailability(row?.itcAvailability),
    [LEDGER_NAME_COLUMN]: null,
    ...initializeLedgerFields(),
    "Custom Ledger Amount": null,
    "Custom Ledger DR/CR": null,
    "Custom IGST Rate": null,
    "Custom CGST Rate": null,
    "Custom SGST/UTGST": null,
    "Cess": cess || null,
    groAmount: null,
    roundOffDr: null,
    roundOffCr: null,
    invoiceAmount: null,
    changeMode: "Accounting Invoice",
    Action: null,
    "Action Reason": null,
    "Narration": null,
  };

  // Determine rate slab from Rate (%) column
  const ratePercent = parseNumber(row?.ratePercent);
  let slab = null;
  if (ratePercent) {
    if (ratePercent === 5) slab = { slab: "5%", mode: igst > 0 ? "IGST" : "CGST_SGST" };
    else if (ratePercent === 12) slab = { slab: "12%", mode: igst > 0 ? "IGST" : "CGST_SGST" };
    else if (ratePercent === 18) slab = { slab: "18%", mode: igst > 0 ? "IGST" : "CGST_SGST" };
    else if (ratePercent === 28) slab = { slab: "28%", mode: igst > 0 ? "IGST" : "CGST_SGST" };
  }
  
  // Fallback to determineSlab if ratePercent not available
  if (!slab) {
    slab = determineSlab(taxableValue, igst, cgst);
  }

  let ledgerAmount = taxableValue;
  let igstApplied = igst;
  let cgstApplied = cgst;
  let sgstApplied = sgst;
  let cessApplied = cess;

  let isMismatched = false;

  if (slab && ledgerAmount) {
    const keys = LEDGER_KEYS[slab.slab];
    base[keys.ledgerAmount] = ledgerAmount;
    base[keys.ledgerCrDr] = "DR";

    if (slab.mode === "IGST") {
      base[keys.igst] = igstApplied;
      cgstApplied = 0;
      sgstApplied = 0;
    } else {
      base[keys.cgst] = cgstApplied;
      base[keys.sgst] = sgstApplied;
      igstApplied = 0;
    }
  } else {
    ledgerAmount = taxableValue || invoiceValue;
    isMismatched = true;
    const customLedgerAmount = taxableValue || invoiceValue || null;
    base["Custom Ledger Amount"] =
      customLedgerAmount !== undefined ? customLedgerAmount : null;
    base["Custom Ledger DR/CR"] = customLedgerAmount ? "DR" : null;
    base["Custom IGST Rate"] = igstApplied ? igstApplied : null;
    base["Custom CGST Rate"] = cgstApplied ? cgstApplied : null;
    base["Custom SGST/UTGST"] = sgstApplied ? sgstApplied : null;
  }

  // For non-RCM rows, include CESS in gross amount calculation
  const isReverseCharge = reverseChargeLabel === "Yes";
  const groAmount = parseFloat(
    isReverseCharge
      ? ((ledgerAmount || 0) + igstApplied + cgstApplied + sgstApplied).toFixed(2)
      : ((ledgerAmount || 0) + igstApplied + cgstApplied + sgstApplied + cessApplied).toFixed(2)
  );

  let roundOffDr = 0;
  let roundOffCr = 0;
  const decimalPart = groAmount - Math.floor(groAmount);

  if (decimalPart > 0) {
    if (decimalPart >= 0.5) {
      roundOffCr = parseFloat((Math.ceil(groAmount) - groAmount).toFixed(2));
    } else {
      roundOffDr = parseFloat((groAmount - Math.floor(groAmount)).toFixed(2));
    }
  }

  const invoiceAmount = parseFloat(
    (groAmount + roundOffCr - roundOffDr).toFixed(2)
  );

  base.groAmount = groAmount;
  base.roundOffDr = roundOffDr || null;
  base.roundOffCr = roundOffCr || null;
  base.invoiceAmount = invoiceAmount;
  
  // For reverse charge rows, supplier amount should equal taxable value from GSTR-2A sheet
  if (isReverseCharge) {
    base.supplierAmount = taxableValue && Number.isFinite(taxableValue) 
      ? parseFloat(Number(taxableValue).toFixed(2)) 
      : invoiceAmount;
  } else {
    base.supplierAmount = invoiceAmount;
  }

  return { record: base, isMismatched };
};

export const processRows = async (rows, companyId, startIndex = 0) => {
  // Deduplicate rows defensively by invoice number + gstin; keep the first (earliest) occurrence.
  const seenKeys = new Set();
  const uniqueRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const inv = (row?.invoiceNumber || "").trim().toUpperCase();
    const gstin = (row?.gstin || "").trim().toUpperCase();
    const key = `${inv}::${gstin}`;
    if (!inv) return true; // no invoice number -> keep (can't dedupe reliably)
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const gstStateMap = await buildStateMap();
  const partyMasterMap = await buildPartyMasterMap(companyId);
  const processedRows = [];
  const mismatchedRows = [];
  const reverseChargeRows = [];
  const itcNoRows = []; // Rows with ITC Availability = "No"

  for (let index = 0; index < uniqueRows.length; index++) {
    const row = uniqueRows[index];
    const absoluteIndex = startIndex + index;
    
    // Check if this row has reverse charge = "yes"
    const { isReverseCharge, displayValue: reverseChargeLabel } =
      interpretReverseChargeValue(row?.reverseCharge);
    
    const { record, isMismatched } = await processRowWithMap(
      row,
      absoluteIndex,
      gstStateMap,
      partyMasterMap,
      reverseChargeLabel,
      companyId
    );

    // Check if ITC Availability is "No"
    const itcAvailability = record?.["ITC Availability"];
    const isItcNo = itcAvailability === "No";

    processedRows.push(record);
    if (isMismatched) {
      mismatchedRows.push(record);
    }
    if (isReverseCharge) {
      reverseChargeRows.push(record);
    }
    if (isItcNo) {
      itcNoRows.push(record);
    }
  }
  
  console.log(
    `Processing complete: ${reverseChargeRows.length} reverse charge rows, ${processedRows.length} processed rows (including mismatches), ${mismatchedRows.length} mismatched rows, ${itcNoRows.length} ITC Availability = No rows`
  );

  const renumber = (list) =>
    list.map((entry, idx) => ({
      ...entry,
      slNo: idx + 1,
    }));

  return {
    processedRows: renumber(processedRows),
    mismatchedRows: renumber(mismatchedRows),
    reverseChargeRows: renumber(reverseChargeRows),
    itcNoRows: renumber(itcNoRows),
  };
};

export const processAndStoreDocument = async (doc) => {
  if (!doc) throw new Error("Invalid GSTR-2A document");
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  if (!rows.length) return null;

  const companyId = doc.company;
  const { processedRows, mismatchedRows, reverseChargeRows, itcNoRows } =
    await processRows(rows, companyId);

  const disallowRows = processedRows
    .filter((row) => normalizeItcAvailability(row?.["ITC Availability"]) === "No")
    .map((row, idx) => ({ ...row, slNo: idx + 1 }));

  const payload = {
    _id: doc._id,
    company: doc.companySnapshot?.companyName || "Unknown",
    companySnapshot: doc.companySnapshot || {},
    processedRows,
    mismatchedRows,
    reverseChargeRows: reverseChargeRows || [],
    disallowRows,
    processedAt: new Date(),
  };

  await upsertProcessedFile(payload);

  return payload;
};

