import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixture } from "./fixture.js";
import { slot, location } from "../src/core.js";
import { readConfig } from "../src/config.js";
import { openDb, recordAttendance, cleanup } from "../src/db.js";
const c = readConfig();
test("Presença integral às 19h59, início inclusivo às 20h e fim exclusivo às 23h", () => {
  assert.equal(slot(new Date("2026-09-12T22:59:59Z"), c).block, "18:00–20:00");
  assert.equal(slot(new Date("2026-09-12T23:00:00Z"), c).block, "20:00–23:00");
  assert.equal(slot(new Date("2026-09-13T02:00:00Z"), c).block, null);
});
test("Fuso São Paulo e dias configuráveis", () => {
  assert.equal(slot(new Date("2026-09-13T01:00:00Z"), c).date, "2026-09-12");
  assert.equal(
    slot(new Date("2026-09-13T01:00:00Z"), { ...c, days: [] }).block,
    null,
  );
});
test("Haversine: dentro, fora, imprecisa e entrada inválida", () => {
  assert.equal(
    location({ latitude: 0, longitude: 0, accuracy: 10 }, c.campus).code,
    "APPROVED",
  );
  assert.equal(
    location({ latitude: 1, longitude: 0, accuracy: 10 }, c.campus).code,
    "OUTSIDE",
  );
  assert.equal(
    location({ latitude: 1, longitude: 0, accuracy: 100 }, c.campus).code,
    "IMPRECISE",
  );
  for (const v of [
    { latitude: "0", longitude: 0, accuracy: 5 },
    { latitude: 91, longitude: 0, accuracy: 5 },
    { latitude: 0, longitude: 0, accuracy: -1 },
    { latitude: 0, longitude: 0, accuracy: NaN },
  ])
    assert.equal(location(v, c.campus).code, "INVALID_LOCATION");
});
test("Unicidade com seis clientes Prisma e conexões PostgreSQL concorrentes", async () => {
  const f = await fixture();
  const clients = Array.from({ length: 6 }, () => openDb(f.url));
  try {
    const u = await f.db.user.create({
      data: { name: "Teste", registration: "1234", password_hash: "hash" },
    });
    const current = { date: "2026-09-12", block: "18:00–20:00" };
    const codes = await Promise.all(
      clients.map((db) =>
        recordAttendance(db, u.id, current, "Demo", new Date()),
      ),
    );
    assert.equal(codes.filter((c) => c === "CONFIRMED").length, 1);
    assert.equal(codes.filter((c) => c === "ALREADY").length, 5);
    assert.equal(await f.db.attendance.count(), 1);
    assert.equal(
      await recordAttendance(
        f.db,
        u.id,
        { ...current, block: null },
        "Demo",
        new Date(),
      ),
      "NO_BLOCK",
    );
  } finally {
    await Promise.all(clients.map((c) => c.$disconnect()));
    await f.close();
  }
});
test("Retenção PostgreSQL remove foto e coordenadas, preservando histórico", async () => {
  const f = await fixture();
  try {
    const u = await f.db.user.create({
      data: {
        name: "Teste",
        registration: "1234",
        password_hash: "hash",
        photo: "old.jpg",
        created_at: new Date("2020-01-01Z"),
      },
    });
    fs.writeFileSync(path.join(f.dir, "photos", "old.jpg"), "photo");
    await f.db.attempt.create({
      data: {
        user_id: u.id,
        purpose: "attendance",
        reason: "OUTSIDE",
        latitude: 1,
        longitude: 1,
        accuracy: 10,
        created_at: new Date("2020-01-01Z"),
      },
    });
    await recordAttendance(
      f.db,
      u.id,
      { date: "2020-01-01", block: "18:00–20:00" },
      "Demo",
      new Date(),
    );
    await f.db.registrationLocation.create({
      data: {
        user_id: u.id,
        latitude: 0,
        longitude: 0,
        accuracy: 10,
        created_at: new Date("2020-01-01Z"),
      },
    });
    await cleanup(f.db, f.dir, c);
    assert.equal(await f.db.registrationLocation.count(), 0);
    assert.equal(fs.existsSync(path.join(f.dir, "photos", "old.jpg")), false);
    assert.equal(
      (await f.db.user.findUniqueOrThrow({ where: { id: u.id } })).photo,
      null,
    );
    const a = await f.db.attempt.findFirstOrThrow();
    assert.equal(a.latitude, null);
    assert.equal(a.reason, "OUTSIDE");
    assert.equal(await f.db.attendance.count(), 1);
  } finally {
    await f.close();
  }
});
