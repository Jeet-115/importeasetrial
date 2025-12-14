import { Router } from "express";
import {
  createCompanyMaster,
  getCompanyMasters,
  getCompanyMasterById,
  updateCompanyMaster,
  deleteCompanyMaster,
} from "../controllers/companymastercontroller.js";
import { requireActiveSubscription } from "../middleware/softwareAuthMiddleware.js";

const router = Router();

router
  .route("/")
  .get(getCompanyMasters)
  .post(requireActiveSubscription, createCompanyMaster);

router
  .route("/:id")
  .get(getCompanyMasterById)
  .put(requireActiveSubscription, updateCompanyMaster)
  .delete(requireActiveSubscription, deleteCompanyMaster);

export default router;

