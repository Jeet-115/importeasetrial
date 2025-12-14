import { Router } from "express";
import {
  importB2BSheet,
  getProcessedFile,
  getImportsByCompany,
  getImportById,
  processB2BImport,
  updateProcessedLedgerNames,
  updateReverseChargeLedgerNames,
  updateMismatchedLedgerNames,
  updateDisallowLedgerNames,
  tallyWithGstr2A,
  deleteImport,
  uploadMiddleware,
} from "../controllers/gstr2bimportcontroller.js";
import { requireActiveSubscription } from "../middleware/softwareAuthMiddleware.js";

const router = Router();

router.post("/b2b", requireActiveSubscription, uploadMiddleware, importB2BSheet);
router.get("/company/:companyId", getImportsByCompany);
router.get("/:id", getImportById);
router.post("/:id/process", requireActiveSubscription, processB2BImport);
router.get("/:id/processed", getProcessedFile);
router.put(
  "/:id/processed/ledger-names",
  requireActiveSubscription,
  updateProcessedLedgerNames,
);
router.put(
  "/:id/processed/reverse-charge/ledger-names",
  requireActiveSubscription,
  updateReverseChargeLedgerNames,
);
router.put(
  "/:id/processed/mismatched/ledger-names",
  requireActiveSubscription,
  updateMismatchedLedgerNames,
);
router.put(
  "/:id/processed/disallow/ledger-names",
  requireActiveSubscription,
  updateDisallowLedgerNames,
);
router.post(
  "/:id/tally-with-gstr2a",
  requireActiveSubscription,
  tallyWithGstr2A,
);
router.delete("/:id", requireActiveSubscription, deleteImport);

export default router;

