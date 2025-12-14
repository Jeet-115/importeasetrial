import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initFileStore } from "../storage/fileStore.js";
import { ensureGSTINSeeded } from "../controllers/gstinnumbercontroller.js";
import { processAllImports } from "../utils/gstr2bProcessor.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, "../.env.production"),
});
const run = async () => {
  try {
    await initFileStore();
    await ensureGSTINSeeded();
    await processAllImports();
    console.log("Processing completed");
  } catch (error) {
    console.error("Error processing GSTR-2B imports:", error);
  }
};

run();

