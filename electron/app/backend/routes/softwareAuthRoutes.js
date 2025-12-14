import express from "express";
import { loginSoftware } from "../controllers/softwareAuthController.js";

const router = express.Router();

router.post("/login", loginSoftware);

export default router;


