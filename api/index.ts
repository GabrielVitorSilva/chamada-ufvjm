import "dotenv/config";
import path from "node:path";
import { readConfig, root } from "../src/config.js";
import { openDb, prepareStorage } from "../src/db.js";
import { createApp } from "../src/app.js";

const config = readConfig();
const secret = process.env.SESSION_SECRET?.trim();
if (!secret)
  throw Error("SESSION_SECRET não foi recebida pela função da Vercel.");
if (secret.length < 32)
  throw Error("SESSION_SECRET deve ter pelo menos 32 caracteres.");
// Na Vercel apenas /tmp é gravável; arquivos nele são temporários.
const dir = process.env.VERCEL
  ? "/tmp/chamada-ufvjm"
  : path.resolve(process.env.DATA_DIR || path.join(root, "data"));
prepareStorage(dir);
const db = openDb();
const app = createApp({ db, dir, config, secret });

export default app;
