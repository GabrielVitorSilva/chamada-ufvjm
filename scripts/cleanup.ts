import "dotenv/config";
import path from "node:path";
import { root, readConfig } from "../src/config.js";
import { openDb, prepareStorage, cleanup } from "../src/db.js";
const dir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
prepareStorage(dir);
const db = openDb();
try {
  await cleanup(db, dir, readConfig());
  console.log("Retenção aplicada.");
} finally {
  await db.$disconnect();
}
