import express from "express";
import {
  uploadMiddleware,
  importGstr2ACSV,
  processGstr2AImport,
  getProcessedFile,
  getImportsByCompany,
  getImportById,
  updateProcessedLedgerNames,
  updateReverseChargeLedgerNames,
  updateMismatchedLedgerNames,
  updateDisallowLedgerNames,
  deleteImport,
  appendManualRows,
} from "../controllers/gstr2aimportcontroller.js";

const router = express.Router();

router.post("/csv", uploadMiddleware, importGstr2ACSV);
router.post("/:id/process", processGstr2AImport);
router.get("/:id/processed", getProcessedFile);
router.get("/company/:companyId", getImportsByCompany);
router.get("/:id", getImportById);
router.put("/:id/processed/ledger-names", updateProcessedLedgerNames);
router.put("/:id/processed/reverse-charge/ledger-names", updateReverseChargeLedgerNames);
router.put("/:id/processed/mismatched/ledger-names", updateMismatchedLedgerNames);
router.put("/:id/processed/disallow/ledger-names", updateDisallowLedgerNames);
router.post("/:id/processed/manual-rows", appendManualRows);
router.delete("/:id", deleteImport);

export default router;

