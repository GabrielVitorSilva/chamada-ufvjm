import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { root } from "../src/config.js";
const password = crypto.randomBytes(32).toString("hex");
const filename = path.join(root, ".env");
try {
  fs.writeFileSync(
    filename,
    `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://chamada:${password}@127.0.0.1:55437/chamada\nSESSION_SECRET=${crypto.randomBytes(48).toString("hex")}\nHOST=127.0.0.1\nPORT=3017\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(".env local criado com segredos aleatórios.");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "EEXIST")
    console.log(".env existente preservado.");
  else throw e;
}
