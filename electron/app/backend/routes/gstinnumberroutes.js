import { Router } from "express";
import { getGSTINNumbers } from "../controllers/gstinnumbercontroller.js";

const router = Router();

router.get("/", getGSTINNumbers);

export default router;

