import { Router } from "express";
import {
  createPartyMaster,
  deletePartyMaster,
  getPartyMasterById,
  getPartyMasters,
  updatePartyMaster,
  uploadMiddleware,
  uploadPurchaseRegister,
} from "../controllers/partymastercontroller.js";
import { requireActiveSubscription } from "../middleware/softwareAuthMiddleware.js";

const router = Router();

router.post(
  "/upload",
  requireActiveSubscription,
  uploadMiddleware,
  uploadPurchaseRegister,
);
router.get("/", getPartyMasters);
router.get("/:id", getPartyMasterById);
router.post("/", requireActiveSubscription, createPartyMaster);
router.put("/:id", requireActiveSubscription, updatePartyMaster);
router.delete("/:id", requireActiveSubscription, deletePartyMaster);

export default router;

