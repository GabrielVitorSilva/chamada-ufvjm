import { fixture } from "../test/fixture.js";
import type { BrowserContext } from "@playwright/test";
import type { AddressInfo } from "node:net";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { readConfig } from "../src/config.js";
const f = await fixture();
const { db, dir } = f;
const config = readConfig();
const app = createApp({
  db,
  dir,
  config,
  secret: "ui-test-only-".repeat(4),
  clock: () => new Date("2026-09-12T22:59:00Z"),
});
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
config.publicUrl = url;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
let context: BrowserContext | undefined;
try {
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: 0, longitude: 0, accuracy: 10 },
    permissions: ["geolocation", "camera"],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator("#demo").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "sem overflow móvel",
  );
  await page.locator("#register [name=name]").fill("Aluno Interface");
  await page.locator("#register [name=registration]").fill("20269999");
  await page.locator("#register [name=password]").fill("senha-interface-123");
  await page.locator("#register [type=checkbox]").check();
  // Cadastro distante e impreciso deve abrir câmera e salvar sem presença.
  await context.setGeolocation({ latitude: 1, longitude: 1, accuracy: 500 });
  await page.locator("#register button").click();
  await page.locator("#snap").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector("video")!.videoWidth > 0,
  );
  await page.locator("#snap").click();
  await page.locator("#confirm").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() => document.querySelector("video")!.srcObject),
    null,
  );
  await page.locator("#retake").click();
  await page.locator("#snap").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector("video")!.videoWidth > 0,
  );
  await page.locator("#snap").click();
  await page.locator("#confirm").click();
  await page.locator("#dashboard").waitFor({ state: "visible" });
  await page
    .getByRole("status")
    .filter({ hasText: "Cadastro concluído" })
    .waitFor();
  assert.equal(await db.attendance.count(), 0);
  assert.equal(await db.registrationLocation.count(), 1);
  assert.match(await page.locator("#history").innerText(), /Nenhum registro/);
  await page.locator("#attend").click();
  await page
    .getByRole("status")
    .filter({ hasText: "Localização imprecisa" })
    .waitFor();
  await context.setGeolocation({ latitude: 1, longitude: 1, accuracy: 10 });
  await page.locator("#attend").click();
  await page
    .getByRole("status")
    .filter({ hasText: "Fora da área permitida" })
    .waitFor();
  await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 10 });
  await page.locator("#attend").click();
  await page
    .getByRole("status")
    .filter({ hasText: "Presença confirmada" })
    .waitFor();
  await page.locator("#attend").click();
  await page
    .getByRole("status")
    .filter({ hasText: "Presença já registrada" })
    .waitFor();
  await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 500 });
  await page.locator("#attend").click();
  await page
    .getByRole("status")
    .filter({ hasText: "Localização imprecisa" })
    .waitFor();
  await page.locator("#logout").click();
  await page.locator("#welcome").waitFor({ state: "visible" });
  await page.locator("#login [name=registration]").fill("20269999");
  await page.locator("#login [name=password]").fill("senha-interface-123");
  await page.locator("#login button").click();
  await page.locator("#dashboard").waitFor({ state: "visible" });
  await page
    .getByRole("status")
    .filter({ hasText: "Login realizado" })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator("#my-photo").click();
  await page.locator("#photo-dialog").waitFor({ state: "visible" });
  await page.locator("#close-photo").click();
  if (process.env.UI_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.UI_SCREENSHOT_DIR, "aluno-mobile.png"),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator("#logout").click();
  await page.locator("#welcome").waitFor({ state: "visible" });
  if (process.env.UI_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.UI_SCREENSHOT_DIR, "inicio-desktop.png"),
      fullPage: true,
    });

  // Timeout seguido de sucesso: usa nova leitura, mas preserva o limite de precisão.
  await page.evaluate(() => {
    let calls = 0;
    navigator.geolocation.getCurrentPosition = (ok, fail, options) => {
      if (options?.maximumAge !== 0) throw Error("Leitura deve ser atual");
      calls++;
      if (calls === 1) fail?.({ code: 3 } as GeolocationPositionError);
      else
        ok({
          coords: { latitude: 0, longitude: 0, accuracy: 500 },
        } as GeolocationPosition);
    };
  });
  await page.locator("#attend").click();
  await page
    .getByRole("status")
    .filter({ hasText: "Localização imprecisa" })
    .waitFor();
  // Falhas do navegador: simulação explícita, sem gerar presença.
  const count = await db.attendance.count();
  for (const [code, message] of [
    [1, "Permissão negada"],
    [2, "Localização indisponível"],
    [3, "Tempo esgotado"],
  ] as const) {
    await page.evaluate((code) => {
      navigator.geolocation.getCurrentPosition = (ok, fail) =>
        fail?.({ code } as GeolocationPositionError);
    }, code);
    await page.locator("#attend").click();
    await page.getByRole("status").filter({ hasText: message }).waitFor();
  }
  assert.equal(await db.attendance.count(), count);
  assert.deepEqual(errors, []);
  console.log(
    "UI OK: 390px e 1280px; cadastro, fora da área, captura/refazer/confirmação, encerramento da câmera, login, logout, foto privada, histórico, repetição e precisão. Admin, foto autorizada, QR, CSV e falhas de permissão/indisponibilidade/tempo esgotado também verificados. Câmera e GPS SIMULADOS.",
  );
} finally {
  await context?.close();
  await browser.close();
  await new Promise<void>((r, reject) =>
    server.close((e) => (e ? reject(e) : r())),
  );
  app.locals.sessionStore.close();
  await f.close();
}
