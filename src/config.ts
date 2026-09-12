import type { Config } from "./types.js";
import fs from "node:fs";
import path from "node:path";
export const root = path.resolve(
  import.meta.dirname,
  import.meta.dirname.includes(`${path.sep}dist${path.sep}`) ? "../.." : "..",
);
export function readConfig(): Config {
  const c: Config = JSON.parse(
    fs.readFileSync(
      process.env.CONFIG_FILE ||
        path.join(
          root,
          fs.existsSync(path.join(root, "config.json"))
            ? "config.json"
            : "config.example.json",
        ),
      "utf8",
    ),
  );
  if (process.env.PUBLIC_URL) c.publicUrl = process.env.PUBLIC_URL;
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
