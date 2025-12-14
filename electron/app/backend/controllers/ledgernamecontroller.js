import {
  create as createLedgerRecord,
  deleteById as deleteLedgerById,
  estimatedDocumentCount,
  findAll as findAllLedgers,
  insertMany as insertLedgerSeed,
  updateById as updateLedgerById,
} from "../models/ledgernamemodel.js";

const normalizeName = (value = "") => value.trim().toLowerCase();

const LEDGER_SEED = [
  "Insurance Expense",
  "Freight & Octroi Expense",
  "Transportation Charges",
  "Rate & Taxes",
  "Security Expense [RCM]",
  "Cleaning Expense",
  "Discount & Kasar",
  "Royalty / Lease Expense",
  "Petrol and diesel Expense",
  "Director's Remuneration",
  "Salary",
  "Wages",
  "License Fees",
  "Commission & Brokerage Charges",
  "Advertisement Expenses",
  "Sales Promotion Expense",
  "Business Promotion Expense",
  "Professional Tax",
  "Penalty [disallow]",
  "Telephone & Mobile Expense",
  "Financial Charges",
  "Bank Charges",
  "Repair & Maintenance Expense",
  "Vehicles Expense",
  "Internet Charges",
  "Packing Material GST",
  "Raw Material GST",
  "Freight on Purchase [GST]",
  "Raw Material - OGS",
  "Store & Consumable",
  "Labour Purchase [GST]",
  "Travelling Exp.",
  "Stationery & Printing",
  "Repair of Vehicle [GST]",
  "Repair of Vehicle [disallow]",
  "Repair of Electrical",
  "Store & Consumabel - OGS",
  "Freight on Purchase [RCM]",
  "Testing Charges",
  "Oil,Grease & Kerosin",
  "Labour Purchase [Non GST]",
  "Account Writting Fees",
  "Manpower Power Service",
  "Administrative Exp",
  "Repair of Computer Exp",
  "Labour Welfare Exp.",
  "Mould & Tools [15%]",
  "Insurance of Vehicle [disallow]",
  "Legal & Profession Exp.",
  "GiDC Exp.",
  "Software Renewal Exp",
  "Testing Equipment [15%]",
  "Machinery [15%]",
  "Repair of Machinery",
  "Office Equipment",
  "Computer",
  "Pooja Exp.",
  "Repair of Office Equipment",
  "Festival Exp. [disallow]",
];

const asyncHandler =
  (handler) =>
  async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error("LedgerNameController Error:", error);
      res.status(error.statusCode || 500).json({
        message: error.message || "Something went wrong",
      });
    }
  };

export const ensureLedgerNamesSeeded = async () => {
  const count = await estimatedDocumentCount();
  if (count > 0) {
    return;
  }

  const uniqueNames = LEDGER_SEED.reduce((acc, raw) => {
    const normalized = normalizeName(raw);
    if (normalized && !acc.map.has(normalized)) {
      acc.map.set(normalized, raw.trim());
      acc.list.push(raw.trim());
    }
    return acc;
  }, { map: new Map(), list: [] });

  if (uniqueNames.list.length) {
    await insertLedgerSeed(uniqueNames.list);
    console.log("Seeded default ledger names");
  }
};

export const getLedgerNames = asyncHandler(async (_req, res) => {
  await ensureLedgerNamesSeeded();
  const ledgers = await findAllLedgers();
  const sorted = [...ledgers].sort((a, b) =>
    (a?.name || "").localeCompare(b?.name || "", undefined, {
      sensitivity: "base",
    }),
  );
  res.json(sorted);
});

export const createLedgerName = asyncHandler(async (req, res) => {
  const rawName = req.body?.name ?? "";
  const trimmed = rawName.trim();
  if (!trimmed) {
    return res.status(400).json({ message: "Ledger name is required." });
  }

  const existing = await findAllLedgers();
  if (
    existing.some(
      (entry) => normalizeName(entry?.name) === normalizeName(trimmed),
    )
  ) {
    return res.status(409).json({ message: "Ledger name already exists." });
  }

  const record = await createLedgerRecord({ name: trimmed });
  res.status(201).json(record);
});

export const updateLedgerName = asyncHandler(async (req, res) => {
  const rawName = req.body?.name ?? "";
  const trimmed = rawName.trim();
  if (!trimmed) {
    return res.status(400).json({ message: "Ledger name is required." });
  }

  const existing = await findAllLedgers();
  const current = existing.find((entry) => entry._id === req.params.id);
  if (!current) {
    return res.status(404).json({ message: "Ledger name not found." });
  }

  if (
    existing.some(
      (entry) =>
        entry._id !== req.params.id &&
        normalizeName(entry?.name) === normalizeName(trimmed),
    )
  ) {
    return res.status(409).json({ message: "Ledger name already exists." });
  }

  const updated = await updateLedgerById(req.params.id, { name: trimmed });
  res.json(updated);
});

export const deleteLedgerName = asyncHandler(async (req, res) => {
  const deleted = await deleteLedgerById(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Ledger name not found." });
  }
  res.json({ message: "Ledger name deleted successfully." });
});

