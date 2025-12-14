import express from "express";
import {
  createLedgerName,
  deleteLedgerName,
  getLedgerNames,
  updateLedgerName,
} from "../controllers/ledgernamecontroller.js";
import { requireActiveSubscription } from "../middleware/softwareAuthMiddleware.js";

const router = express.Router();

router.get("/", getLedgerNames);
router.post("/", requireActiveSubscription, createLedgerName);
router.put("/:id", requireActiveSubscription, updateLedgerName);
router.delete("/:id", requireActiveSubscription, deleteLedgerName);

export default router;

