import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "./generated/prisma/client.js";
import fs from "node:fs";
import path from "node:path";
import type { Config, Slot } from "./types.js";
export function openDb(url = process.env.DATABASE_URL) {
  if (!url)
    throw Error("Defina DATABASE_URL para PostgreSQL. Consulte README.md.");
  // O Prisma Postgres da integração da Vercel fornece uma URL prisma+postgres.
  // Esse formato usa o modo Accelerate/Prisma Postgres, não o driver pg direto.
  if (url.startsWith("prisma+postgres://"))
    return new PrismaClient({ accelerateUrl: url });
  const schema = new URL(url).searchParams.get("schema") || "public";
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 10 }, { schema }),
  });
}
export function prepareStorage(dir: string) {
  fs.mkdirSync(path.join(dir, "photos"), { recursive: true, mode: 0o700 });
}
export async function recordAttendance(
  db: Prisma.TransactionClient,
  userId: number,
  current: Slot,
  campus: string,
  now: Date,
) {
  if (!current.block) return "NO_BLOCK";
  // createMany + skipDuplicates usa ON CONFLICT DO NOTHING; não aborta a transação em uma repetição.
  const result = await db.attendance.createMany({
    data: [
      {
        user_id: userId,
        local_date: current.date,
        block: current.block,
        campus,
        created_at: now,
      },
    ],
    skipDuplicates: true,
  });
  return result.count ? "CONFIRMED" : "ALREADY";
}
export async function cleanup(
  db: PrismaClient,
  dir: string,
  config: Config,
  now = new Date(),
) {
  const photoCut = new Date(
    now.getTime() - config.retention.photosDays * 86400000,
  );
  const locationCut = new Date(
    now.getTime() - config.retention.locationsDays * 86400000,
  );
  for (const row of await db.user.findMany({
    where: { photo: { not: null }, created_at: { lt: photoCut } },
    select: { id: true, photo: true },
  })) {
    if (row.photo)
      fs.rmSync(path.join(dir, "photos", row.photo), { force: true });
    await db.user.update({ where: { id: row.id }, data: { photo: null } });
  }
  await db.registrationLocation.deleteMany({
    where: { created_at: { lt: locationCut } },
  });
  await db.attempt.updateMany({
    where: { created_at: { lt: locationCut } },
    data: { latitude: null, longitude: null, accuracy: null },
  });
  const referenced = new Set(
    (
      await db.user.findMany({
        where: { photo: { not: null } },
        select: { photo: true },
      })
    ).map((r) => r.photo),
  );
  for (const file of fs.readdirSync(path.join(dir, "photos")))
    if (
      !referenced.has(file) &&
      fs.statSync(path.join(dir, "photos", file)).mtimeMs <
        now.getTime() - 86400000
    )
      fs.rmSync(path.join(dir, "photos", file), { force: true });
}
