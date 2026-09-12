import "dotenv/config";
import path from "node:path";
import { readConfig, root } from "../src/config.js";
import { openDb, prepareStorage } from "../src/db.js";
import { createApp } from "../src/app.js";

const config = readConfig();
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  throw Error("Defina SESSION_SECRET nas variáveis da Vercel.");
// Na Vercel apenas /tmp é gravável; arquivos nele são temporários.
const dir = process.env.VERCEL
  ? "/tmp/chamada-ufvjm"
  : path.resolve(process.env.DATA_DIR || path.join(root, "data"));
prepareStorage(dir);
const db = openDb();
const app = createApp({ db, dir, config, secret: process.env.SESSION_SECRET });

export default app;
