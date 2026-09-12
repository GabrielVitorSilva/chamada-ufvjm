import type { Config } from "./types.js";
import fs from "node:fs";
import path from "node:path";
export const root = path.resolve(
  import.meta.dirname,
  import.meta.dirname.includes(`${path.sep}dist${path.sep}`) ? "../.." : "..",
);

const bundledConfig: Config = {
  publicUrl: "http://127.0.0.1:3017",
  campus: {
    name: "Campus JK da UFVJM — Diamantina/MG",
    latitude: -18.2025,
    longitude: -43.573,
    radiusMeters: 150,
    maxAccuracyMeters: 50,
    demonstration: false,
  },
  days: [0, 1, 2, 3, 4, 5, 6],
  blocks: [
    ["08:00", "10:00"],
    ["10:00", "12:00"],
    ["12:00", "14:00"],
    ["14:00", "16:00"],
    ["16:00", "18:00"],
    ["18:00", "20:00"],
    ["20:00", "23:00"],
  ],
  locationTtlSeconds: 120,
  retention: { photosDays: 90, locationsDays: 30 },
};

export function readConfig(): Config {
  const configPath =
    process.env.CONFIG_FILE ||
    path.join(
      root,
      fs.existsSync(path.join(root, "config.json"))
        ? "config.json"
        : "config.example.json",
    );
  // O arquivo local não acompanha necessariamente a função serverless da Vercel.
  // O fallback mantém a configuração do Campus JK disponível nesse ambiente.
  const c: Config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : structuredClone(bundledConfig);
  c.publicUrl =
    process.env.PUBLIC_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : c.publicUrl);
  const finite = (x: unknown, min: number, max: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
  if (
    !c.campus ||
    !finite(c.campus.latitude, -90, 90) ||
    !finite(c.campus.longitude, -180, 180) ||
    !finite(c.campus.radiusMeters, 1, 100000) ||
    !finite(c.campus.maxAccuracyMeters, 1, 10000) ||
    typeof c.campus.demonstration !== "boolean"
  )
    throw Error("Configuração do campus inválida");
  if (
    !Array.isArray(c.days) ||
    !c.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  )
    throw Error("Dias inválidos");
  if (!Array.isArray(c.blocks) || !c.blocks.length)
    throw Error("Blocos inválidos");
  let end = "";
  for (const b of c.blocks) {
    if (
      !Array.isArray(b) ||
      b.length !== 2 ||
      !b.every(
        (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t),
      ) ||
      b[0] >= b[1] ||
      b[0] < end
    )
      throw Error(
        "Blocos devem ser ordenados, sem sobreposição e no mesmo dia",
      );
    end = b[1];
  }
  if (
    !finite(c.locationTtlSeconds, 10, 300) ||
    !finite(c.retention?.photosDays, 1, 3650) ||
    !finite(c.retention?.locationsDays, 1, 3650)
  )
    throw Error("Retenção ou validade inválida");
  const u = new URL(c.publicUrl);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw Error("publicUrl deve ser a origem, sem caminho ou credenciais");
  if (
    process.env.NODE_ENV === "production" &&
    (u.protocol !== "https:" || c.campus.demonstration)
  )
    throw Error("Produção requer HTTPS e campus real configurado");
  c.publicUrl = u.origin;
  return c;
}
