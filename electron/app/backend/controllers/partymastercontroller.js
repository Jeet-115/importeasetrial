import multer from "multer";
import XLSX from "xlsx";
import {
  create as createParty,
  createMany as createManyParties,
  deleteById as deletePartyById,
  findAll as findAllParties,
  findByCompany as findPartiesByCompany,
  findById as findPartyById,
  updateById as updatePartyById,
} from "../models/partymastermodel.js";

const upload = multer({ storage: multer.memoryStorage() });

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error("PartyMasterController Error:", error);
    res.status(error.statusCode || 500).json({
      message: error.message || "Something went wrong",
    });
  }
};

const findHeaderRow = (sheetRows, targetHeaders) => {
  for (let rowIdx = 0; rowIdx < Math.min(10, sheetRows.length); rowIdx += 1) {
    const row = sheetRows[rowIdx] || [];
    const normalizedRow = row.map((cell) =>
      String(cell || "").trim().toLowerCase()
    );
    const foundHeaders = targetHeaders.filter((header) =>
      normalizedRow.some((cell) => cell.includes(header.toLowerCase()))
    );
    if (foundHeaders.length === targetHeaders.length) {
      return rowIdx;
    }
  }
  return null;
};

const parsePurchaseRegister = (workbook) => {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("No sheet found in workbook");
  }

  const sheetRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const headerRowIdx = findHeaderRow(sheetRows, ["particular", "gstin/uin"]);
  if (headerRowIdx === null) {
    throw new Error(
      "Could not find 'Particular' and 'GSTIN/UIN' columns. Please ensure headers start from row 7 or 8."
    );
  }

  const headerRow = sheetRows[headerRowIdx] || [];
  const particularColIdx = headerRow.findIndex((cell) =>
    String(cell || "").toLowerCase().includes("particular")
  );
  const gstinColIdx = headerRow.findIndex((cell) =>
    String(cell || "").toLowerCase().includes("gstin/uin")
  );

  if (particularColIdx === -1 || gstinColIdx === -1) {
    throw new Error("Required columns 'Particular' and 'GSTIN/UIN' not found.");
  }

  const dataRows = sheetRows.slice(headerRowIdx + 1);
  const parties = [];

  for (const row of dataRows) {
    const particular = String(row[particularColIdx] || "").trim();
    const gstin = String(row[gstinColIdx] || "").trim();

    if (particular && gstin) {
      parties.push({
        partyName: particular,
        gstin: gstin,
      });
    }
  }

  return parties;
};

export const uploadMiddleware = upload.single("file");

export const uploadPurchaseRegister = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file provided" });
  }

  const { companyId } = req.body;
  if (!companyId) {
    return res.status(400).json({ message: "companyId is required" });
  }

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const parties = parsePurchaseRegister(workbook);

  if (!parties.length) {
    return res.status(400).json({
      message: "No valid party data found in the Excel file.",
    });
  }

  // Get existing parties for this company to check duplicates by GSTIN
  const existingParties = await findPartiesByCompany(companyId);
  const existingGstinSet = new Set();
  existingParties.forEach((party) => {
    existingGstinSet.add(party.gstin.trim().toUpperCase());
  });

  // Remove duplicates from parsed data (both within file and against existing)
  // Duplicate is determined by GSTIN only
  const uniqueParties = [];
  const seenInFile = new Set();
  
  for (const party of parties) {
    const normalizedName = party.partyName.trim();
    const normalizedGstin = party.gstin.trim().toUpperCase();
    
    // Skip if GSTIN already seen in this file or exists in database
    if (!seenInFile.has(normalizedGstin) && !existingGstinSet.has(normalizedGstin)) {
      seenInFile.add(normalizedGstin);
      uniqueParties.push({
        companyId,
        partyName: normalizedName,
        gstin: normalizedGstin,
      });
    }
  }

  if (!uniqueParties.length) {
    return res.status(400).json({
      message: "All parties in the file are duplicates. No new parties to import.",
    });
  }

  const created = await createManyParties(uniqueParties);
  const skipped = parties.length - uniqueParties.length;

  return res.status(201).json({
    message: `Imported ${created.length} parties successfully.${skipped > 0 ? ` ${skipped} duplicate(s) skipped.` : ""}`,
    parties: created,
    count: created.length,
    skipped,
  });
});

export const getPartyMasters = asyncHandler(async (req, res) => {
  const { companyId } = req.query;
  if (companyId) {
    const parties = await findPartiesByCompany(companyId);
    return res.json(parties);
  }
  const all = await findAllParties();
  return res.json(all);
});

export const getPartyMasterById = asyncHandler(async (req, res) => {
  const party = await findPartyById(req.params.id);
  if (!party) {
    return res.status(404).json({ message: "Party master not found" });
  }
  return res.json(party);
});

export const createPartyMaster = asyncHandler(async (req, res) => {
  const { companyId, partyName, gstin } = req.body;
  if (!companyId || !partyName || !gstin) {
    return res
      .status(400)
      .json({ message: "companyId, partyName, and gstin are required" });
  }

  const normalizedName = partyName.trim();
  const normalizedGstin = gstin.trim().toUpperCase();

  // Check for duplicates by GSTIN only
  const existingParties = await findPartiesByCompany(companyId);
  const isDuplicate = existingParties.some(
    (party) => party.gstin.trim().toUpperCase() === normalizedGstin
  );

  if (isDuplicate) {
    return res.status(400).json({
      message: "A party with this GSTIN already exists for this company.",
    });
  }

  const party = await createParty({
    companyId,
    partyName: normalizedName,
    gstin: normalizedGstin,
  });
  return res.status(201).json(party);
});

export const updatePartyMaster = asyncHandler(async (req, res) => {
  const existingParty = await findPartyById(req.params.id);
  if (!existingParty) {
    return res.status(404).json({ message: "Party master not found" });
  }

  // Normalize GSTIN if provided
  const updates = { ...req.body };
  if (updates.gstin) {
    updates.gstin = updates.gstin.trim().toUpperCase();
    
    // Check for duplicate GSTIN (excluding the current party)
    const existingParties = await findPartiesByCompany(existingParty.companyId);
    const isDuplicate = existingParties.some(
      (party) =>
        party._id !== req.params.id &&
        party.gstin.trim().toUpperCase() === updates.gstin
    );

    if (isDuplicate) {
      return res.status(400).json({
        message: "A party with this GSTIN already exists for this company.",
      });
    }
  }

  // Normalize party name if provided
  if (updates.partyName) {
    updates.partyName = updates.partyName.trim();
  }

  const party = await updatePartyById(req.params.id, updates);
  return res.json(party);
});

export const deletePartyMaster = asyncHandler(async (req, res) => {
  const deleted = await deletePartyById(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Party master not found" });
  }
  return res.json({ message: "Party master deleted successfully" });
});

