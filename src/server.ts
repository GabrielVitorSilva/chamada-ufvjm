import "dotenv/config";
import path from "node:path";
import { readConfig, root } from "./config.js";
import { openDb, prepareStorage, cleanup } from "./db.js";
import { createApp } from "./app.js";
const config = readConfig();
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  throw Error("Defina SESSION_SECRET com pelo menos 32 caracteres aleatórios.");
const dir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
prepareStorage(dir);
const db = openDb();
await db.$connect();
await cleanup(db, dir, config);
let cleaning = false;
const timer = setInterval(async () => {
  if (cleaning) return;
  cleaning = true;
  try {
    await cleanup(db, dir, config);
  } catch {
    console.error("Falha na rotina de retenção.");
  } finally {
    cleaning = false;
  }
}, 3600000);
timer.unref();
const app = createApp({ db, dir, config, secret: process.env.SESSION_SECRET });
const server = app.listen(
  Number(process.env.PORT || 3017),
  process.env.HOST || "127.0.0.1",
  () => console.log("Aplicação iniciada: " + config.publicUrl),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      clearInterval(timer);
      app.locals.sessionStore.close();
      await db.$disconnect();
      process.exit(0);
    }),
  );
