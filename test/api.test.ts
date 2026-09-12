import { fixture } from "./fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { readConfig } from "../src/config.js";
test("Fluxos HTTP, segurança e registros pelo relógio do servidor", async (t) => {
  const f = await fixture();
  const { db, dir } = f;
  const config = readConfig();
  let now = new Date("2026-09-12T22:59:59Z");
  const app = createApp({
    db,
    dir,
    config,
    secret: "test-secret-long-enough-1234567890",
    clock: () => now,
  });
  const server = app.listen(0);
  const agent = request.agent(server);
  let token = "";
  const refresh = async () => {
    token = (await agent.get("/api/session")).body.csrf;
  };
  const post = (url: string, body: object) =>
    agent.post(url).set("X-CSRF-Token", token).send(body);
  const geo = { latitude: 0, longitude: 0, accuracy: 10 };
  const photo =
    "data:image/jpeg;base64," +
    (
      await sharp({
        create: { width: 200, height: 200, channels: 3, background: "#ccaa88" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
  const form = {
    name: "Aluno Teste",
    registration: "20260001",
    password: "senha-de-teste-12345",
    photo,
  };
  try {
    await refresh();
    await t.test("CSRF obrigatório e painel protegido sem sessão", async () => {
      assert.equal(
        (await agent.post("/api/register/location").send({ location: geo }))
          .status,
        403,
      );
      assert.equal((await agent.get("/api/admin/students")).status, 401);
      assert.equal(
        (
          await agent
            .post("/api/login")
            .set("X-CSRF-Token", token)
            .set("Origin", "https://evil.example")
            .send({})
        ).status,
        403,
      );
    });
    await t.test(
      "Cadastro aceita localização distante e imprecisa sem criar tentativa recusada",
      async () => {
        const r = await post("/api/register/location", {
          location: { latitude: 1, longitude: 1, accuracy: 500 },
        });
        assert.equal(r.body.code, "APPROVED");
        assert.equal(await db.attempt.count(), 0);
        assert.equal(await db.attendance.count(), 0);
        assert.equal(fs.readdirSync(path.join(dir, "photos")).length, 0);
      },
    );
    await t.test(
      "Foto inválida recusada mesmo após localização aprovada",
      async () => {
        await post("/api/register/location", {
          location: { latitude: 1, longitude: 1, accuracy: 500 },
        });
        assert.equal(
          (
            await post("/api/register", {
              ...form,
              photo: "data:image/jpeg;base64,SGVsbG8=",
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "Cadastro salva localização e foto sem presença, mesmo em bloco ativo",
      async () => {
        const r = await post("/api/register", {
          ...form,
          date: "2099-01-01",
          block: "20:00–23:00",
        });
        assert.equal(r.body.code, "REGISTERED");
        await refresh();
        assert.equal(await db.attendance.count(), 0);
        const loc = await db.registrationLocation.findFirstOrThrow();
        assert.equal(loc.latitude, 1);
        assert.equal(loc.longitude, 1);
        assert.equal(loc.accuracy, 500);
        assert.equal(loc.created_at.toISOString(), now.toISOString());
        assert.equal((await agent.get("/api/history")).body.length, 0);
        assert.equal(fs.readdirSync(path.join(dir, "photos")).length, 1);
      },
    );
    await t.test("Aluno não acessa administração; foto privada", async () => {
      for (const route of [
        "students",
        "attendance",
        "attempts",
        "export",
        "qr",
        "config",
      ])
        assert.equal((await agent.get("/api/admin/" + route)).status, 403);
      assert.equal((await agent.get("/api/photos/1")).status, 200);
      assert.equal((await request(server).get("/api/photos/1")).status, 401);
      assert.equal((await agent.get("/api/photos/2")).status, 403);
      assert.equal(
        (
          await agent.get(
            "/data/photos/" + (await db.user.findFirstOrThrow()).photo,
          )
        ).status,
        404,
      );
    });
    await t.test(
      "Repetições HTTP concorrentes não duplicam presença",
      async () => {
        const rs = await Promise.all(
          Array.from({ length: 4 }, () =>
            post("/api/attendance", { location: geo }),
          ),
        );
        assert.equal(rs.filter((r) => r.body.code === "CONFIRMED").length, 1);
        assert.equal(rs.filter((r) => r.body.code === "ALREADY").length, 3);
        assert.equal(await db.attendance.count(), 1);
      },
    );
    await t.test(
      "Novo bloco exige leitura; precisão e área recusadas vinculadas ao aluno",
      async () => {
        now = new Date("2026-09-12T23:00:00Z");
        assert.equal(
          (
            await post("/api/attendance", {
              location: { ...geo, accuracy: 500 },
            })
          ).body.code,
          "IMPRECISE",
        );
        assert.equal(
          (await post("/api/attendance", { location: { ...geo, latitude: 1 } }))
            .body.code,
          "OUTSIDE",
        );
        assert.equal(
          (await db.attempt.findFirstOrThrow({ orderBy: { id: "desc" } }))
            .user_id,
          1,
        );
        assert.equal(await db.attendance.count(), 1);
        assert.equal(
          (await post("/api/attendance", { location: geo })).body.code,
          "CONFIRMED",
        );
        assert.equal(
          (await db.attendance.findFirstOrThrow({ orderBy: { id: "desc" } }))
            .block,
          "20:00–23:00",
        );
      },
    );
    await t.test("Às 23h não concede presença", async () => {
      now = new Date("2026-09-13T02:00:00Z");
      assert.equal(
        (await post("/api/attendance", { location: geo })).body.code,
        "NO_BLOCK",
      );
      assert.equal(await db.attendance.count(), 2);
    });
    await t.test("Logout, login e unicidade da matrícula", async () => {
      await post("/api/logout", {});
      assert.equal((await agent.get("/api/history")).status, 401);
      await refresh();
      await post("/api/register/location", { location: geo });
      assert.equal((await post("/api/register", form)).status, 409);
      assert.equal(fs.readdirSync(path.join(dir, "photos")).length, 1);
      assert.equal(
        (
          await post("/api/login", {
            registration: form.registration,
            password: "incorrect",
          })
        ).status,
        401,
      );
      assert.equal((await post("/api/login", form)).status, 200);
      await refresh();
      assert.equal((await agent.get("/api/history")).body.length, 2);
    });
    await t.test(
      "Administrador autorizado consulta, exporta e acessa QR e foto",
      async () => {
        await db.user.create({
          data: {
            name: "Admin",
            registration: "9999",
            password_hash: await bcrypt.hash(form.password, 4),
            role: "admin",
            created_at: now,
          },
        });
        await post("/api/logout", {});
        await refresh();
        await post("/api/login", {
          registration: "9999",
          password: form.password,
        });
        await refresh();
        assert.equal((await agent.get("/api/admin/students")).body.length, 1);
        assert.equal(
          (
            await agent.get(
              "/api/admin/attendance?date=2026-09-12&block=" +
                encodeURIComponent("18:00–20:00"),
            )
          ).body.length,
          1,
        );
        assert.match(
          (await agent.get("/api/admin/export")).text,
          /Aluno Teste/,
        );
        assert.equal(
          (await agent.get("/api/admin/qr")).headers["content-type"],
          "image/png",
        );
        assert.equal((await agent.get("/api/photos/1")).status, 200);
      },
    );
    await t.test(
      "Expiração da localização e cadastro fora dos blocos",
      async () => {
        await post("/api/logout", {});
        await refresh();
        await post("/api/register/location", { location: geo });
        now = new Date(now.getTime() + 121000);
        assert.equal(
          (await post("/api/register", { ...form, registration: "20260002" }))
            .body.code,
          "EXPIRED",
        );
        await post("/api/register/location", { location: geo });
        assert.equal(
          (await post("/api/register", { ...form, registration: "20260002" }))
            .body.code,
          "REGISTERED",
        );
        assert.equal(
          await db.attendance.count({
            where: { user: { registration: "20260002" } },
          }),
          0,
        );
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    app.locals.sessionStore.close();
    await f.close();
  }
});
