import "dotenv/config";
import { Client } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, prepareStorage } from "../src/db.js";
import { root } from "../src/config.js";
export async function fixture() {
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) throw Error("Configure PostgreSQL antes dos testes.");
  const schema = "test_" + crypto.randomBytes(12).toString("hex");
  const connection = new Client({ connectionString: base });
  await connection.connect();
  await connection.query(`CREATE SCHEMA "${schema}"`);
  await connection.query(`SET search_path TO "${schema}"`);
  const migrations = fs
    .readdirSync(path.join(root, "prisma/migrations"))
    .filter((f) => /^\d/.test(f))
    .sort();
  for (const file of migrations)
    await connection.query(
      fs
        .readFileSync(
          path.join(root, "prisma/migrations", file, "migration.sql"),
          "utf8",
        )
        .replace('CREATE SCHEMA IF NOT EXISTS "public";', ""),
    );
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  const db = openDb(url.toString());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chamada-pg-"));
  prepareStorage(dir);
  return {
    db,
    dir,
    url: url.toString(),
    async close() {
      await db.$disconnect();
      await connection.query(`DROP SCHEMA "${schema}" CASCADE`);
      await connection.end();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
