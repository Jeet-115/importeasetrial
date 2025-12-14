import * as XLSX from "xlsx-js-style";
import { gstr2bHeaders } from "./gstr2bHeaders";

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
};

const getFirstValue = (row = {}, keys = []) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }
  return "";
};

const buildRowSignature = (row = {}) =>
  [
    getFirstValue(row, ["referenceNo", "Reference No.", "vchNo", "Vch No"]),
    getFirstValue(row, ["supplierName", "Supplier Name"]),
    getFirstValue(row, ["gstinUin", "GSTIN/UIN", "gstin", "GSTIN"]),
    getFirstValue(row, ["invoiceNumber", "Invoice Number"]),
    getFirstValue(row, [
      "supplierAmount",
      "Supplier Amount",
      "invoiceAmount",
      "Invoice Amount",
    ]),
  ]
    .map((value) => (value !== undefined && value !== null ? String(value) : ""))
    .join("::");

const createSheetFromRows = (rows = [], header) => {
  if (!rows.length) {
    return XLSX.utils.aoa_to_sheet([["No data available"]]);
  }
  if (header?.length) {
    // Ensure all rows have all header properties (even if null/undefined)
    const normalizedRows = rows.map((row) => {
      const normalized = { ...row };
      header.forEach((h) => {
        if (!Object.prototype.hasOwnProperty.call(normalized, h)) {
          normalized[h] = null;
        }
      });
      return normalized;
    });
    return XLSX.utils.json_to_sheet(normalizedRows, { header });
  }
  return XLSX.utils.json_to_sheet(rows);
};

const buildGstr2BSheet = (rows = []) => {
  if (!rows.length) {
    return XLSX.utils.aoa_to_sheet([["No GSTR-2B data available"]]);
  }
  const worksheetRows = rows.map((row) => {
    const entry = {};
    gstr2bHeaders.forEach(({ key, label }) => {
      entry[label] = row?.[key] ?? "";
    });
    return entry;
  });
  return XLSX.utils.json_to_sheet(worksheetRows);
};

const createRowSkeleton = (headers = []) => {
  const skeleton = {};
  headers.forEach((header) => {
    skeleton[header] = "";
  });
  return skeleton;
};

const COLOR_MAP = {
  green: "FFE4F8E5",
  orange: "FFFFEAD6",
  purple: "FFECE2FF",
  red: "FFFFE0E0",
  grand: "FFE0F2FF",
  accept: "FFD6F5E3",
  reject: "FFF9D6D6",
  pending: "FFFFF5D6",
  none: "FFF2F4F7",
  actionGrand: "FFE3F0FF",
};

// Disallow ledger names that should be separated into a disallow sheet
// Any ledger name containing "[disallow]" (case-insensitive) will be treated as disallow
const isDisallowLedger = (ledgerName) => {
  if (!ledgerName) return false;
  const normalizedName = String(ledgerName).trim().toLowerCase();
  return normalizedName.includes("[disallow]");
};

const normalizeActionValue = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "accept") return "Accept";
  if (lower === "reject") return "Reject";
  if (lower === "pending") return "Pending";
  return null;
};


const applyRowStyle = (sheet, headers, rowIndex, color) => {


  if (!color) return;
  headers.forEach((_, colIdx) => {
    const cellRef = XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIdx });
    let cell = sheet[cellRef];
    if (!cell) {
      cell = { t: "s", v: "" };
      sheet[cellRef] = cell;
    }
    cell.s = {
      ...cell.s,
      fill: {
        patternType: "solid",
        fgColor: { rgb: color },
      },
    };
  });
};

export const buildCombinedWorkbook = ({
  originalRows = [],
  processedRows = [],
  processedHeaders = [],
  mismatchedRows = [],
  reverseChargeRows = [],
  disallowRows = [],
  restSheets = [],
  normalizeAcceptCreditValue = (value) => value,
}) => {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: GSTR-2B
  const gstrSheet = buildGstr2BSheet(originalRows);
  XLSX.utils.book_append_sheet(workbook, gstrSheet, "GSTR2B");

  const derivedHeaders =
    processedHeaders && processedHeaders.length
      ? processedHeaders.slice()
      : processedRows[0]
      ? Object.keys(processedRows[0])
      : [];
  
  // Reorder headers to place Accept Credit, Action, Action Reason, Narration after Change Mode
  const reorderHeaders = (headers, columnsToInsert = ["Accept Credit", "Action", "Action Reason", "Narration"]) => {
    const changeModeIndex = headers.findIndex((h) => h === "Change Mode" || h === "changeMode");
    if (changeModeIndex === -1) {
      // If Change Mode not found, just ensure columns exist
      const result = [...headers];
      columnsToInsert.forEach((col) => {
        if (!result.includes(col)) {
          result.push(col);
        }
      });
      return result;
    }
    
    const changeModeHeader = headers[changeModeIndex];
    const beforeChangeMode = headers.slice(0, changeModeIndex);
    const afterChangeMode = headers.slice(changeModeIndex + 1);
    
    // Remove these columns from their original positions
    const filteredBefore = beforeChangeMode.filter(
      (h) => !columnsToInsert.includes(h)
    );
    const filteredAfter = afterChangeMode.filter(
      (h) => !columnsToInsert.includes(h)
    );
    
    // Always insert the columns after Change Mode
    return [...filteredBefore, changeModeHeader, ...columnsToInsert, ...filteredAfter];
  };
  
  const reorderedHeaders = reorderHeaders(derivedHeaders.filter((h) => h !== "Category"), ["Accept Credit", "Action", "Action Reason", "Narration"]);
  
  // Ensure GSTR-2B columns are included in master headers
  const additionalHeaders = [];
  if (!reorderedHeaders.includes("GSTR-2B Invoice Value")) {
    additionalHeaders.push("GSTR-2B Invoice Value");
  }
  if (!reorderedHeaders.includes("GSTR-2B Taxable Value")) {
    additionalHeaders.push("GSTR-2B Taxable Value");
  }
  if (!reorderedHeaders.includes("ITC Availability")) {
    additionalHeaders.push("ITC Availability");
  }
  let masterHeaders = ["Category", ...reorderedHeaders, ...additionalHeaders];

  const mapRowWithCategory = (row, categoryLabel) => {
    const mapped = createRowSkeleton(masterHeaders);
    masterHeaders.forEach((header) => {
      if (header === "Category") {
        mapped.Category = categoryLabel;
      } else if (row && Object.prototype.hasOwnProperty.call(row, header)) {
        mapped[header] = row[header];
      }
    });
    return mapped;
  };

  // Build signature sets
  const reverseSignatures = new Set(reverseChargeRows.map((row) => buildRowSignature(row)));
  const disallowSignatures = new Set(disallowRows.map((row) => buildRowSignature(row)));
  const mismatchedAcceptStatus = new Map();
  mismatchedRows.forEach((row) => {
    const sig = buildRowSignature(row);
    const normalized = normalizeAcceptCreditValue(row?.["Accept Credit"]);
    mismatchedAcceptStatus.set(sig, normalized || "No");
  });

  const greenRows = [];
  const orangeRows = [];
  const purpleRows = [];
  const redRows = disallowRows.slice();
  const redSignatureSet = new Set(disallowRows.map((row) => buildRowSignature(row)));

  const greenSignatureSet = new Set();

  // First, filter RCM rows - move disallow ledger names or ITC Availability = "No" to redRows
  reverseChargeRows.forEach((row) => {
    const sig = buildRowSignature(row);
    const ledgerName = row?.["Ledger Name"];
    const itcAvailability = row?.["ITC Availability"];
    const isItcNo = itcAvailability === "No";
    
    if (isDisallowLedger(ledgerName) || isItcNo) {
      // Move to disallow rows if not already there
      if (!redSignatureSet.has(sig)) {
        redRows.push(row);
        redSignatureSet.add(sig);
      }
    } else {
      purpleRows.push(row);
    }
  });

  processedRows.forEach((row) => {
    const sig = buildRowSignature(row);
    const acceptStatus = mismatchedAcceptStatus.get(sig);
    const isOrange = acceptStatus === "No" || (!acceptStatus && mismatchedAcceptStatus.has(sig));
    const itcAvailability = row?.["ITC Availability"];
    const isItcNo = itcAvailability === "No";
    
    // Move ITC Availability = "No" rows to disallow rows
    if (isItcNo && !redSignatureSet.has(sig)) {
      redRows.push(row);
      redSignatureSet.add(sig);
      return;
    }
    
    if (disallowSignatures.has(sig) || reverseSignatures.has(sig) || isOrange) {
      return;
    }
    greenRows.push(row);
    greenSignatureSet.add(sig);
  });

  mismatchedRows.forEach((row) => {
    const normalized = normalizeAcceptCreditValue(row?.["Accept Credit"]);
    const sig = buildRowSignature(row);
    const ledgerName = row?.["Ledger Name"];
    const itcAvailability = row?.["ITC Availability"];
    const isItcNo = itcAvailability === "No";
    
    // Check if this mismatched row has ITC Availability = "No" or disallow ledger name
    if (isItcNo || isDisallowLedger(ledgerName)) {
      // Move to disallow rows if not already there
      if (!redSignatureSet.has(sig)) {
        redRows.push(row);
        redSignatureSet.add(sig);
      }
      return; // Don't add to green or orange
    }
    
    if (normalized === "Yes" && !greenSignatureSet.has(sig)) {
      greenRows.push(row);
      greenSignatureSet.add(sig);
    }
  });

  mismatchedRows.forEach((row) => {
    const normalized = normalizeAcceptCreditValue(row?.["Accept Credit"]);
    const sig = buildRowSignature(row);
    const ledgerName = row?.["Ledger Name"];
    
    // Skip if already moved to disallow rows
    if (isDisallowLedger(ledgerName) || redSignatureSet.has(sig)) {
      return;
    }
    
    if (normalized === "No" || !normalized) {
      orangeRows.push(row);
    }
  });

  const masterRows = [];
  const masterRowStyles = new Map();

  const pushSection = (rows, color, label) => {
    rows.forEach((row) => {
      const mapped = mapRowWithCategory(row, label);
      masterRowStyles.set(masterRows.length, color);
      masterRows.push(mapped);
    });
    if (rows.length) {
      masterRows.push({ Category: "" });
    }
  };

  pushSection(greenRows, COLOR_MAP.green, "Allowed (Green)");
  pushSection(orangeRows, COLOR_MAP.orange, "Mismatched - Accept Credit No");
  pushSection(purpleRows, COLOR_MAP.purple, "RCM");
  pushSection(redRows, COLOR_MAP.red, "Disallow");

  // Helper function to get GSTR-2B invoice value for a processed row
  // Use the stored value from the processed row directly
  const getGstr2bInvoiceValue = (row) => {
    const value = row?.["GSTR-2B Invoice Value"];
    if (value === null || value === undefined || value === "") return 0;
    return toNumber(value);
  };

  // Helper function to get GSTR-2B taxable value for a processed row
  // Use the stored value from the processed row directly
  const getGstr2bTaxableValue = (row) => {
    const value = row?.["GSTR-2B Taxable Value"];
    if (value === null || value === undefined || value === "") return 0;
    return toNumber(value);
  };

  // Helper function to get tax values from processed row
  const getTaxValue = (row, fieldName) => {
    return toNumber(row?.[fieldName]);
  };

  // Helper function to sum a field across rows
  const sumField = (rows, getValueFn) =>
    rows.reduce((total, row) => total + getValueFn(row), 0);

  // Helper function to sum all tax fields (IGST, CGST, SGST, CESS)
  const sumTaxFields = (rows) => {
    let igstTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let cessTotal = 0;

    rows.forEach((row) => {
      // Sum all slab-specific tax fields
      ["5%", "12%", "18%", "28%"].forEach((slab) => {
        igstTotal += toNumber(row?.[`IGST Rate ${slab}`] ?? 0);
        cgstTotal += toNumber(row?.[`CGST Rate ${slab}`] ?? 0);
        sgstTotal += toNumber(row?.[`SGST/UTGST Rate ${slab}`] ?? 0);
      });
      // Sum custom tax fields (for mismatched rows)
      igstTotal += toNumber(row?.["Custom IGST Rate"] ?? 0);
      cgstTotal += toNumber(row?.["Custom CGST Rate"] ?? 0);
      sgstTotal += toNumber(row?.["Custom SGST/UTGST"] ?? 0);
      // CESS is in a single column
      cessTotal += toNumber(row?.["Cess"] ?? 0);
    });

    return { igstTotal, cgstTotal, sgstTotal, cessTotal };
  };

  const allColoredRows = [...greenRows, ...orangeRows, ...purpleRows, ...redRows];

  // Calculate totals for each category
  const calculateCategoryTotals = (rows) => {
    const gstr2bInvoiceTotal = sumField(rows, getGstr2bInvoiceValue);
    const taxableValueTotal = sumField(rows, getGstr2bTaxableValue);
    const taxes = sumTaxFields(rows);
    const supplierAmountTotal = sumField(rows, (row) =>
      toNumber(
        row?.supplierAmount ??
          row?.["supplierAmount"] ??
          row?.["Supplier Amount"] ??
          row?.invoiceAmount ??
          row?.["Invoice Amount"]
      )
    );
    const invoiceAmountTotal = sumField(rows, (row) =>
      toNumber(row?.invoiceAmount ?? row?.["Invoice Amount"])
    );

    return {
      gstr2bInvoiceTotal,
      taxableValueTotal,
      ...taxes,
      supplierAmountTotal,
      invoiceAmountTotal,
    };
  };

  const greenTotals = calculateCategoryTotals(greenRows);
  const orangeTotals = calculateCategoryTotals(orangeRows);
  const purpleTotals = calculateCategoryTotals(purpleRows);
  const redTotals = calculateCategoryTotals(redRows);

  // Calculate grand totals
  const grandTotals = {
    gstr2bInvoiceTotal:
      greenTotals.gstr2bInvoiceTotal +
      orangeTotals.gstr2bInvoiceTotal +
      purpleTotals.gstr2bInvoiceTotal +
      redTotals.gstr2bInvoiceTotal,
    taxableValueTotal:
      greenTotals.taxableValueTotal +
      orangeTotals.taxableValueTotal +
      purpleTotals.taxableValueTotal +
      redTotals.taxableValueTotal,
    igstTotal:
      greenTotals.igstTotal +
      orangeTotals.igstTotal +
      purpleTotals.igstTotal +
      redTotals.igstTotal,
    cgstTotal:
      greenTotals.cgstTotal +
      orangeTotals.cgstTotal +
      purpleTotals.cgstTotal +
      redTotals.cgstTotal,
    sgstTotal:
      greenTotals.sgstTotal +
      orangeTotals.sgstTotal +
      purpleTotals.sgstTotal +
      redTotals.sgstTotal,
    cessTotal:
      greenTotals.cessTotal +
      orangeTotals.cessTotal +
      purpleTotals.cessTotal +
      redTotals.cessTotal,
    supplierAmountTotal:
      greenTotals.supplierAmountTotal +
      orangeTotals.supplierAmountTotal +
      purpleTotals.supplierAmountTotal +
      redTotals.supplierAmountTotal,
    invoiceAmountTotal:
      greenTotals.invoiceAmountTotal +
      orangeTotals.invoiceAmountTotal +
      purpleTotals.invoiceAmountTotal +
      redTotals.invoiceAmountTotal,
  };

  if (masterRows.length) {
    masterRows.push({ Category: "" });
  }

  const totalsColumnNames = [
    "GSTR-2B Invoice",
    "GSTR-2B Taxable",
    "IGST Total",
    "CGST Total",
    "SGST Total",
    "CESS Total",
    "Supplier Amount",
    "Invoice Amount",
  ];

  const assignCompactTotals = (totals) => [
    totals.gstr2bInvoiceTotal || 0,
    totals.taxableValueTotal || 0,
    totals.igstTotal || 0,
    totals.cgstTotal || 0,
    totals.sgstTotal || 0,
    totals.cessTotal || 0,
    totals.supplierAmountTotal || 0,
    totals.invoiceAmountTotal || 0,
  ];

  const categoryTotals = [
    { label: "Green Total", totals: greenTotals, color: COLOR_MAP.green },
    { label: "Orange Total", totals: orangeTotals, color: COLOR_MAP.orange },
    { label: "Purple Total", totals: purpleTotals, color: COLOR_MAP.purple },
    { label: "Red Total", totals: redTotals, color: COLOR_MAP.red },
  ];

  const actionTotals = [
    { key: "Accept", label: "Action Accept Total", color: COLOR_MAP.accept },
    { key: "Reject", label: "Action Reject Total", color: COLOR_MAP.reject },
    { key: "Pending", label: "Action Pending Total", color: COLOR_MAP.pending },
    { key: null, label: "Action No Action Total", color: COLOR_MAP.none },
  ];
  const sumAction = (target) =>
    processedRows.reduce((total, row) => {
      const normalized = normalizeActionValue(row?.Action);
      if (target === null) {
        return normalized ? total : total + toNumber(
          row?.supplierAmount ??
            row?.["supplierAmount"] ??
            row?.["Supplier Amount"] ??
            row?.invoiceAmount ??
            row?.["Invoice Amount"]
        );
      }
      if (normalized === target) {
        return (
          total +
          toNumber(
            row?.supplierAmount ??
              row?.["supplierAmount"] ??
              row?.["Supplier Amount"] ??
              row?.invoiceAmount ??
              row?.["Invoice Amount"]
          )
        );
      }
      return total;
    }, 0);
  const actionTotalsWithValues = actionTotals.map((entry) => ({
    ...entry,
    value: sumAction(entry.key),
  }));
  const actionGrandTotal = actionTotalsWithValues.reduce(
    (sum, entry) => sum + entry.value,
    0
  );
  masterRows.push({ Category: "" });

  const masterSheet = createSheetFromRows(masterRows, masterHeaders);
  masterRowStyles.forEach((color, rowIndex) => {
    applyRowStyle(masterSheet, masterHeaders, rowIndex, color);
  });

  const additionalAoA = [];
  const additionalRowStyles = [];

  additionalAoA.push(["", ...totalsColumnNames]);
  additionalRowStyles.push(null);

  categoryTotals.forEach((entry) => {
    const totalsRow = [entry.label, ...assignCompactTotals(entry.totals)];
    // Add "rcm paid by party" text after invoice amount for purple total
    if (entry.label === "Purple Total") {
      totalsRow.push("rcm paid by party");
    }
    additionalAoA.push(totalsRow);
    additionalRowStyles.push(entry.color);
  });

  additionalAoA.push(["Grand Total", ...assignCompactTotals(grandTotals)]);
  additionalRowStyles.push(COLOR_MAP.grand);

  additionalAoA.push([]);
  additionalRowStyles.push(null);

  additionalAoA.push(["Action Category", "Amount"]);
  additionalRowStyles.push(null);

  actionTotalsWithValues.forEach((entry) => {
    additionalAoA.push([entry.label, entry.value || 0]);
    additionalRowStyles.push(entry.color);
  });
  additionalAoA.push(["Action Grand Total", actionGrandTotal || 0]);
  additionalRowStyles.push(COLOR_MAP.actionGrand);

  // Calculate tax totals from rest sheets
  const calculateRestSheetTaxTotals = (sheetName, rows, headers) => {
    if (!rows || !rows.length || !headers || !headers.length) {
      return { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    }

    // Determine main header pattern based on sheet name
    // Headers are in format "subheading(heading)" or just "heading"
    const sheetNameLower = sheetName.toLowerCase();
    let mainPattern;
    
    if (sheetNameLower.includes("isd")) {
      // ISD, ISDA, ISD(Rejected), ISDA(Rejected) - use "Input tax distribution by ISD"
      mainPattern = /input.*tax.*distribution.*isd/i;
    } else if (sheetNameLower.includes("impg")) {
      // IMPG, IMPGA, IMPGSEZ, IMPGSEZA - use "Amount of tax (₹)"
      mainPattern = /amount.*tax/i;
    } else {
      // Default: ECOA, B2B (ITC Reversal), B2BA (ITC Reversal), B2B(Rejected), B2BA(Rejected), ECO(Rejected), ECOA(Rejected), B2BA
      // Use "Tax Amount" pattern
      mainPattern = /tax.*amount/i;
    }

    // Tax type patterns
    const igstPattern = /integrated.*tax|igst/i;
    const cgstPattern = /central.*tax|cgst/i;
    const sgstPattern = /state.*ut.*tax|sgst|utgst/i;
    const cessPattern = /cess/i;

    // Find columns matching tax type pattern
    // Headers are in format "subheading(heading)" where heading contains the main pattern
    // Try to find exact match first (both patterns), then fallback to tax pattern only
    const findColumnIndex = (taxPattern) => {
      // First, try to find exact match (both tax and main pattern)
      let exactMatch = headers.findIndex((header) => {
        if (!header) return false;
        const headerStr = String(header).toLowerCase();
        return taxPattern.test(headerStr) && mainPattern.test(headerStr);
      });
      
      if (exactMatch !== -1) return exactMatch;
      
      // Fallback: find any column matching tax pattern (in case main pattern format differs)
      return headers.findIndex((header) => {
        if (!header) return false;
        const headerStr = String(header).toLowerCase();
        return taxPattern.test(headerStr);
      });
    };

    const igstColIdx = findColumnIndex(igstPattern);
    const cgstColIdx = findColumnIndex(cgstPattern);
    const sgstColIdx = findColumnIndex(sgstPattern);
    const cessColIdx = findColumnIndex(cessPattern);

    // Calculate totals
    let igstTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let cessTotal = 0;

    rows.forEach((row) => {
      if (igstColIdx !== -1) {
        const header = headers[igstColIdx];
        igstTotal += toNumber(row?.[header]);
      }
      if (cgstColIdx !== -1) {
        const header = headers[cgstColIdx];
        cgstTotal += toNumber(row?.[header]);
      }
      if (sgstColIdx !== -1) {
        const header = headers[sgstColIdx];
        sgstTotal += toNumber(row?.[header]);
      }
      if (cessColIdx !== -1) {
        const header = headers[cessColIdx];
        cessTotal += toNumber(row?.[header]);
      }
    });

    return { igst: igstTotal, cgst: cgstTotal, sgst: sgstTotal, cess: cessTotal };
  };

  // Calculate tax totals for CDNR/DNR sheets based on Note type
  const calculateCDNRTaxTotals = (sheetName, rows, headers, noteTypeValue) => {
    if (!rows || !rows.length || !headers || !headers.length) {
      return { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    }

    // Find Note type column - check in order: "Note type(Credit note/Debit note details)", "Note type(Debit note details)", "Note type"
    let noteTypeHeader = null;
    const noteTypePatterns = [
      /note.*type.*credit.*note.*debit.*note.*details/i,
      /note.*type.*debit.*note.*details/i,
      /^note.*type$/i,
    ];

    for (const pattern of noteTypePatterns) {
      const found = headers.find((h) => h && pattern.test(String(h).toLowerCase()));
      if (found) {
        noteTypeHeader = found;
        break;
      }
    }

    if (!noteTypeHeader) {
      return { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    }

    // Filter rows by Note type value
    const filteredRows = rows.filter((row) => {
      const noteType = String(row?.[noteTypeHeader] || "").trim().toUpperCase();
      return noteType === noteTypeValue.toUpperCase();
    });

    if (!filteredRows.length) {
      return { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    }

    // Use Tax Amount pattern for these sheets
    const mainPattern = /tax.*amount/i;
    const igstPattern = /integrated.*tax|igst/i;
    const cgstPattern = /central.*tax|cgst/i;
    const sgstPattern = /state.*ut.*tax|sgst|utgst/i;
    const cessPattern = /cess/i;

    const findColumnIndex = (taxPattern) => {
      let exactMatch = headers.findIndex((header) => {
        if (!header) return false;
        const headerStr = String(header).toLowerCase();
        return taxPattern.test(headerStr) && mainPattern.test(headerStr);
      });
      if (exactMatch !== -1) return exactMatch;
      return headers.findIndex((header) => {
        if (!header) return false;
        const headerStr = String(header).toLowerCase();
        return taxPattern.test(headerStr);
      });
    };

    const igstColIdx = findColumnIndex(igstPattern);
    const cgstColIdx = findColumnIndex(cgstPattern);
    const sgstColIdx = findColumnIndex(sgstPattern);
    const cessColIdx = findColumnIndex(cessPattern);

    let igstTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let cessTotal = 0;

    filteredRows.forEach((row) => {
      if (igstColIdx !== -1) {
        const header = headers[igstColIdx];
        igstTotal += toNumber(row?.[header]);
      }
      if (cgstColIdx !== -1) {
        const header = headers[cgstColIdx];
        cgstTotal += toNumber(row?.[header]);
      }
      if (sgstColIdx !== -1) {
        const header = headers[sgstColIdx];
        sgstTotal += toNumber(row?.[header]);
      }
      if (cessColIdx !== -1) {
        const header = headers[cessColIdx];
        cessTotal += toNumber(row?.[header]);
      }
    });

    return { igst: igstTotal, cgst: cgstTotal, sgst: sgstTotal, cess: cessTotal };
  };

  // Build tax totals table - separate ADD and LESS rows
  const addRows = [];
  const lessRows = [];
  const addRowStyles = [];
  const lessRowStyles = [];

  // Table headers (will be added later)
  const tableHeaders = ["ADD/LESS", "Name", "IGST Total", "CGST Total", "SGST Total", "CESS Total", "Final Total"];

  // Row 1: Total Credit B2B (Green rows total) - ADD
  const greenTaxTotals = {
    igst: greenTotals.igstTotal || 0,
    cgst: greenTotals.cgstTotal || 0,
    sgst: greenTotals.sgstTotal || 0,
    cess: greenTotals.cessTotal || 0,
  };
  const greenFinalTotal = greenTaxTotals.igst + greenTaxTotals.cgst + greenTaxTotals.sgst + greenTaxTotals.cess;
  addRows.push([
    "ADD",
    "Total Credit B2B",
    greenTaxTotals.igst,
    greenTaxTotals.cgst,
    greenTaxTotals.sgst,
    greenTaxTotals.cess,
    greenFinalTotal,
  ]);
  addRowStyles.push(COLOR_MAP.green);

  // Row 2: AMEDMEND BILL (B2BA sheet) - ADD
  const b2baSheet = restSheets.find((s) => s.sheetName?.toLowerCase() === "b2ba");
  const b2baTotals = b2baSheet
    ? calculateRestSheetTaxTotals(b2baSheet.sheetName, b2baSheet.rows, b2baSheet.headers)
    : { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const b2baFinalTotal = b2baTotals.igst + b2baTotals.cgst + b2baTotals.sgst + b2baTotals.cess;
  addRows.push([
    "ADD",
    "AMEDMEND BILL(B2BA)",
    b2baTotals.igst,
    b2baTotals.cgst,
    b2baTotals.sgst,
    b2baTotals.cess,
    b2baFinalTotal,
  ]);
  addRowStyles.push(null);

  // Sheets with "Tax Amount" pattern: ECOA, B2B (ITC Reversal), B2BA (ITC Reversal), B2B(Rejected), B2BA(Rejected), ECO(Rejected), ECOA(Rejected) - ADD
  const taxAmountSheets = ["ECO", "ECOA", "B2B (ITC Reversal)", "B2BA (ITC Reversal)", "B2B(Rejected)", "B2BA(Rejected)", "ECO(Rejected)", "ECOA(Rejected)"];
  taxAmountSheets.forEach((sheetName) => {
    const sheet = restSheets.find((s) => s.sheetName === sheetName);
    if (sheet) {
      const totals = calculateRestSheetTaxTotals(sheet.sheetName, sheet.rows, sheet.headers);
      const finalTotal = totals.igst + totals.cgst + totals.sgst + totals.cess;
      addRows.push([
        "ADD",
        sheetName,
        totals.igst,
        totals.cgst,
        totals.sgst,
        totals.cess,
        finalTotal,
      ]);
      addRowStyles.push(null);
    }
  });

  // Sheets with "Input tax distribution by ISD" pattern: ISD, ISDA, ISD(Rejected), ISDA(Rejected) - ADD
  const isdSheets = ["ISD", "ISDA", "ISD(Rejected)", "ISDA(Rejected)"];
  isdSheets.forEach((sheetName) => {
    const sheet = restSheets.find((s) => s.sheetName === sheetName);
    if (sheet) {
      const totals = calculateRestSheetTaxTotals(sheet.sheetName, sheet.rows, sheet.headers);
      const finalTotal = totals.igst + totals.cgst + totals.sgst + totals.cess;
      addRows.push([
        "ADD",
        sheetName,
        totals.igst,
        totals.cgst,
        totals.sgst,
        totals.cess,
        finalTotal,
      ]);
      addRowStyles.push(null);
    }
  });

  // Sheets with "Amount of tax (₹)" pattern: IMPG, IMPGA, IMPGSEZ, IMPGSEZA - ADD
  const impgSheets = ["IMPG", "IMPGA", "IMPGSEZ", "IMPGSEZA"];
  impgSheets.forEach((sheetName) => {
    const sheet = restSheets.find((s) => s.sheetName === sheetName);
    if (sheet) {
      const totals = calculateRestSheetTaxTotals(sheet.sheetName, sheet.rows, sheet.headers);
      const finalTotal = totals.igst + totals.cgst + totals.sgst + totals.cess;
      addRows.push([
        "ADD",
        sheetName,
        totals.igst,
        totals.cgst,
        totals.sgst,
        totals.cess,
        finalTotal,
      ]);
      addRowStyles.push(null);
    }
  });

  // CDNR/DNR sheets: B2B-CDNR, B2B-CDNRA, B2B-DNR, B2B-DNRA, B2B-CDNR(Rejected), B2B-CDNRA(Rejected)
  const cdnrSheets = ["B2B-CDNR", "B2B-CDNRA", "B2B-DNR", "B2B-DNRA", "B2B-CDNR(Rejected)", "B2B-CDNRA(Rejected)"];
  cdnrSheets.forEach((sheetName) => {
    const sheet = restSheets.find((s) => s.sheetName === sheetName);
    if (sheet) {
      // Calculate for Debit Note rows (ADD)
      const debitNoteTotals = calculateCDNRTaxTotals(sheet.sheetName, sheet.rows, sheet.headers, "Debit Note");
      const debitNoteFinalTotal = debitNoteTotals.igst + debitNoteTotals.cgst + debitNoteTotals.sgst + debitNoteTotals.cess;
      if (debitNoteFinalTotal > 0) {
        addRows.push([
          "ADD",
          `DEBIT NOTE ${sheetName}`,
          debitNoteTotals.igst,
          debitNoteTotals.cgst,
          debitNoteTotals.sgst,
          debitNoteTotals.cess,
          debitNoteFinalTotal,
        ]);
        addRowStyles.push(null);
      }

      // Calculate for Credit Note rows (LESS)
      const creditNoteTotals = calculateCDNRTaxTotals(sheet.sheetName, sheet.rows, sheet.headers, "Credit Note");
      const creditNoteFinalTotal = creditNoteTotals.igst + creditNoteTotals.cgst + creditNoteTotals.sgst + creditNoteTotals.cess;
      if (creditNoteFinalTotal > 0) {
        lessRows.push([
          "LESS",
          `CREDIT NOTE ${sheetName}`,
          creditNoteTotals.igst,
          creditNoteTotals.cgst,
          creditNoteTotals.sgst,
          creditNoteTotals.cess,
          creditNoteFinalTotal,
        ]);
        lessRowStyles.push(null);
      }
    }
  });

  // DISALLOW row (LESS) - red rows + orange rows totals
  const disallowTotals = {
    igst: (redTotals.igstTotal || 0) + (orangeTotals.igstTotal || 0),
    cgst: (redTotals.cgstTotal || 0) + (orangeTotals.cgstTotal || 0),
    sgst: (redTotals.sgstTotal || 0) + (orangeTotals.sgstTotal || 0),
    cess: (redTotals.cessTotal || 0) + (orangeTotals.cessTotal || 0),
  };
  const disallowFinalTotal = disallowTotals.igst + disallowTotals.cgst + disallowTotals.sgst + disallowTotals.cess;
  lessRows.push([
    "LESS",
    "DISALLOW",
    disallowTotals.igst,
    disallowTotals.cgst,
    disallowTotals.sgst,
    disallowTotals.cess,
    disallowFinalTotal,
  ]);
  lessRowStyles.push(null);

  // Calculate totals for ADD rows
  const addTotals = addRows.reduce(
    (acc, row) => ({
      igst: acc.igst + (row[2] || 0),
      cgst: acc.cgst + (row[3] || 0),
      sgst: acc.sgst + (row[4] || 0),
      cess: acc.cess + (row[5] || 0),
    }),
    { igst: 0, cgst: 0, sgst: 0, cess: 0 }
  );
  const addFinalTotal = addTotals.igst + addTotals.cgst + addTotals.sgst + addTotals.cess;

  // Calculate totals for LESS rows
  const lessTotals = lessRows.reduce(
    (acc, row) => ({
      igst: acc.igst + (row[2] || 0),
      cgst: acc.cgst + (row[3] || 0),
      sgst: acc.sgst + (row[4] || 0),
      cess: acc.cess + (row[5] || 0),
    }),
    { igst: 0, cgst: 0, sgst: 0, cess: 0 }
  );
  const lessFinalTotal = lessTotals.igst + lessTotals.cgst + lessTotals.sgst + lessTotals.cess;

  // Build final table: headers, ADD rows, ADD totals, LESS rows, LESS totals
  const taxTotalsAoA = [];
  const taxTotalsStyles = [];

  taxTotalsAoA.push(tableHeaders);
  taxTotalsStyles.push(null);

  // ADD rows
  addRows.forEach((row) => {
    taxTotalsAoA.push(row);
  });
  addRowStyles.forEach((style) => {
    taxTotalsStyles.push(style);
  });

  // ADD totals row
  if (addRows.length > 0) {
    taxTotalsAoA.push([
      "ADD Total",
      "",
      addTotals.igst,
      addTotals.cgst,
      addTotals.sgst,
      addTotals.cess,
      addFinalTotal,
    ]);
    taxTotalsStyles.push(COLOR_MAP.grand);
  }

  // Empty row separator
  if (addRows.length > 0 && lessRows.length > 0) {
    taxTotalsAoA.push([]);
    taxTotalsStyles.push(null);
  }

  // LESS rows
  lessRows.forEach((row) => {
    taxTotalsAoA.push(row);
  });
  lessRowStyles.forEach((style) => {
    taxTotalsStyles.push(style);
  });

  // LESS totals row
  if (lessRows.length > 0) {
    taxTotalsAoA.push([
      "LESS Total",
      "",
      lessTotals.igst,
      lessTotals.cgst,
      lessTotals.sgst,
      lessTotals.cess,
      lessFinalTotal,
    ]);
    taxTotalsStyles.push(COLOR_MAP.grand);
  }

  // GRAND TOTAL row (ADD Total - LESS Total)
  const grandTaxTotal = {
    igst: addTotals.igst - lessTotals.igst,
    cgst: addTotals.cgst - lessTotals.cgst,
    sgst: addTotals.sgst - lessTotals.sgst,
    cess: addTotals.cess - lessTotals.cess,
  };
  const grandTaxFinalTotal = grandTaxTotal.igst + grandTaxTotal.cgst + grandTaxTotal.sgst + grandTaxTotal.cess;
  taxTotalsAoA.push([
    "GRAND TOTAL",
    "",
    grandTaxTotal.igst,
    grandTaxTotal.cgst,
    grandTaxTotal.sgst,
    grandTaxTotal.cess,
    grandTaxFinalTotal,
  ]);
  taxTotalsStyles.push(COLOR_MAP.grand);

  // RCM PAY AMOUNT row
  const rcmPayAmount = purpleTotals.supplierAmountTotal || 0;
  const rcmPayTotals = {
    igst: purpleTotals.igstTotal || 0,
    cgst: purpleTotals.cgstTotal || 0,
    sgst: purpleTotals.sgstTotal || 0,
    cess: purpleTotals.cessTotal || 0,
  };
  const rcmPayFinalTotal = rcmPayTotals.igst + rcmPayTotals.cgst + rcmPayTotals.sgst + rcmPayTotals.cess;
  taxTotalsAoA.push([
    rcmPayAmount,
    "RCM PAY AMOUNT",
    rcmPayTotals.igst,
    rcmPayTotals.cgst,
    rcmPayTotals.sgst,
    rcmPayTotals.cess,
    rcmPayFinalTotal,
  ]);
  taxTotalsStyles.push(COLOR_MAP.purple);

  // Add tax totals table after action totals
  additionalAoA.push([]);
  additionalRowStyles.push(null);
  additionalAoA.push([]);
  additionalRowStyles.push(null);

  if (additionalAoA.length) {
    const originRow = masterRows.length + 1;
    XLSX.utils.sheet_add_aoa(masterSheet, additionalAoA, {
      origin: { r: originRow, c: 0 },
    });
    additionalRowStyles.forEach((color, idx) => {
      if (!color) return;
      applyRowStyle(masterSheet, masterHeaders, masterRows.length + idx, color);
    });
  }

  // Add tax totals table
  if (taxTotalsAoA.length) {
    const taxTotalsStartRow = masterRows.length + additionalAoA.length + 1;
    XLSX.utils.sheet_add_aoa(masterSheet, taxTotalsAoA, {
      origin: { r: taxTotalsStartRow, c: 0 },
    });
    taxTotalsStyles.forEach((color, idx) => {
      if (!color) return;
      applyRowStyle(masterSheet, masterHeaders, taxTotalsStartRow + idx, color);
    });
  }
  XLSX.utils.book_append_sheet(workbook, masterSheet, "Master");

  // Helper function to ensure columns are in headers
  const ensureColumnsInHeaders = (headers, columnsToAdd) => {
    const result = [...headers];
    columnsToAdd.forEach((col) => {
      if (!result.includes(col)) {
        result.push(col);
      }
    });
    return result;
  };

  // Helper function to reorder columns to place specific columns after Change Mode
  const reorderSheetHeaders = (headers, columnsToInsert) => {
    const changeModeIndex = headers.findIndex((h) => h === "Change Mode" || h === "changeMode");
    if (changeModeIndex === -1) {
      return ensureColumnsInHeaders(headers, columnsToInsert);
    }
    
    const changeModeHeader = headers[changeModeIndex];
    const beforeChangeMode = headers.slice(0, changeModeIndex);
    const afterChangeMode = headers.slice(changeModeIndex + 1);
    
    // Remove columns from their original positions
    const filteredBefore = beforeChangeMode.filter(
      (h) => !columnsToInsert.includes(h)
    );
    const filteredAfter = afterChangeMode.filter(
      (h) => !columnsToInsert.includes(h)
    );
    
    // Always insert the columns after Change Mode
    return [...filteredBefore, changeModeHeader, ...columnsToInsert, ...filteredAfter];
  };

  // Remaining sheets
  // Processed sheet: Accept Credit, Action, Action Reason, Narration
  const processedSheetHeaders = ensureColumnsInHeaders(derivedHeaders, ["Accept Credit", "Action", "Action Reason", "Narration"]);
  const processedHeadersOrdered = reorderSheetHeaders(processedSheetHeaders, ["Accept Credit", "Action", "Action Reason", "Narration"]);
  const tallySheet = createSheetFromRows(processedRows, processedHeadersOrdered);
  XLSX.utils.book_append_sheet(workbook, tallySheet, "TallyProcessed");

  // Mismatched sheet: Accept Credit, Action, Action Reason, Narration
  const mismatchedHeaders = mismatchedRows[0] ? Object.keys(mismatchedRows[0]) : [];
  const mismatchedHeadersWithColumns = ensureColumnsInHeaders(mismatchedHeaders, ["Accept Credit", "Action", "Action Reason", "Narration"]);
  const mismatchedHeadersOrdered = reorderSheetHeaders(mismatchedHeadersWithColumns, ["Accept Credit", "Action", "Action Reason", "Narration"]);
  const mismatchedSheet = createSheetFromRows(mismatchedRows, mismatchedHeadersOrdered);
  XLSX.utils.book_append_sheet(workbook, mismatchedSheet, "Mismatched");

  // RCM sheet: Action, Action Reason, Narration (no Accept Credit)
  const rcmHeaders = reverseChargeRows[0] ? Object.keys(reverseChargeRows[0]) : [];
  const rcmHeadersWithColumns = ensureColumnsInHeaders(rcmHeaders, ["Action", "Action Reason", "Narration"]);
  const rcmHeadersOrdered = reorderSheetHeaders(rcmHeadersWithColumns, ["Action", "Action Reason", "Narration"]);
  const rcmSheet = createSheetFromRows(reverseChargeRows, rcmHeadersOrdered);
  XLSX.utils.book_append_sheet(workbook, rcmSheet, "RCM");

  // Disallow sheet: Action, Action Reason, Narration (no Accept Credit)
  const disallowHeaders = disallowRows[0] ? Object.keys(disallowRows[0]) : [];
  const disallowHeadersWithColumns = ensureColumnsInHeaders(disallowHeaders, ["Action", "Action Reason", "Narration"]);
  const disallowHeadersOrdered = reorderSheetHeaders(disallowHeadersWithColumns, ["Action", "Action Reason", "Narration"]);
  const disallowSheet = createSheetFromRows(
    disallowRows,
    disallowHeadersOrdered
  );
  XLSX.utils.book_append_sheet(workbook, disallowSheet, "Disallow");

  if (restSheets?.length) {
    const restData = [];
    restSheets.forEach(({ sheetName, headers = [], rows = [] }) => {
      const normalizedHeaders =
        headers.length > 0
          ? headers
          : rows.length > 0
          ? Object.keys(rows[0])
          : [];
      restData.push([sheetName || "Sheet"]);
      if (normalizedHeaders.length) {
        restData.push(normalizedHeaders);
      } else {
        restData.push(["No headers detected"]);
      }
      if (rows.length) {
        rows.forEach((row) => {
          if (normalizedHeaders.length) {
            restData.push(
              normalizedHeaders.map((header) => {
                const value = row?.[header];
                return value === null || value === undefined ? "" : value;
              })
            );
          } else {
            const values = Object.values(row || {});
            restData.push(values.length ? values : [""]);
          }
        });
      } else {
        restData.push(["No data available"]);
      }
      restData.push([]);
      restData.push([]);
    });
    if (restData.length) {
      while (
        restData.length &&
        restData[restData.length - 1].length === 0
      ) {
        restData.pop();
      }
      const restSheet = XLSX.utils.aoa_to_sheet(restData);
      XLSX.utils.book_append_sheet(workbook, restSheet, "Rest Sheets");
    }
  }

  return workbook;
};

