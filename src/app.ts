import express, {
  type Request,
  type Response,
  type RequestHandler,
  type ErrorRequestHandler,
} from "express";
import { Prisma, type PrismaClient } from "./generated/prisma/client.js";
import type { Config } from "./types.js";
import session from "express-session";
import { PrismaSessionStore } from "./session-store.js";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import QRCode from "qrcode";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { slot, location, coordinates } from "./core.js";
import { recordAttendance } from "./db.js";
import { root } from "./config.js";
const messages: Record<string, string> = {
  REGISTERED:
    "Localização e foto salvas. Para fazer check-in, toque em Registrar presença.",
  CONFIRMED: "Presença confirmada",
  ALREADY: "Presença já registrada",
  NO_BLOCK: "Nenhum bloco ativo",
  OUTSIDE: "Fora da área permitida",
  IMPRECISE: "Localização imprecisa",
  INVALID_LOCATION: "Localização inválida",
  EXPIRED: "Validação expirada. Solicite uma nova localização.",
};
export function createApp({
  db,
  dir,
  config,
  secret,
  clock = () => new Date(),
}: {
  db: PrismaClient;
  dir: string;
  config: Config;
  secret: string;
  clock?: () => Date;
}) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      strictTransportSecurity:
        process.env.NODE_ENV === "production" ? undefined : false,
      contentSecurityPolicy: {
        directives: { "img-src": ["'self'", "blob:", "data:"] },
      },
    }),
  );
  app.use(express.json({ limit: "3mb" }));
  const store = new PrismaSessionStore(db);
  app.locals.sessionStore = store;
  app.use(
    session({
      name: "chamada.sid",
      secret,
      resave: false,
      saveUninitialized: false,
      store: store,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    if (
      ["POST", "PUT", "DELETE", "PATCH"].includes(req.method) &&
      (!req.session.csrf ||
        req.get("X-CSRF-Token") !== req.session.csrf ||
        (req.get("Origin") && req.get("Origin") !== config.publicUrl))
    )
      return res
        .status(403)
        .json({ message: "Requisição não autorizada. Atualize a página." });
    next();
  });
  const auth: RequestHandler = async (req, res, next) => {
    const u = await db.user.findUnique({
      where: { id: req.session.userId || 0 },
      select: {
        id: true,
        name: true,
        registration: true,
        role: true,
        photo: true,
      },
    });
    if (!u) return res.status(401).json({ message: "Entre para continuar." });
    req.user = u;
    next();
  };
  const admin: RequestHandler = (req, res, next) =>
    req.user!.role === "admin"
      ? next()
      : res.status(403).json({ message: "Acesso restrito à administração." });
  const anonymous: RequestHandler = (req, res, next) =>
    req.session.userId
      ? res
          .status(400)
          .json({ message: "Encerre a sessão antes de cadastrar outra conta." })
      : next();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Muitas tentativas. Aguarde 15 minutos." },
  });
  const geoLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Muitas leituras. Aguarde um minuto." },
  });
  const result = (
    res: Response,
    code: string,
    extra: Record<string, unknown> = {},
  ) => res.json({ code, message: messages[code] || code, ...extra });
  async function validate(req: Request, purpose: string) {
    const v = location(req.body?.location, config.campus);
    if (["OUTSIDE", "IMPRECISE"].includes(v.code))
      await db.attempt.create({
        data: {
          user_id: req.user?.id ?? null,
          purpose,
          reason: v.code,
          latitude: v.latitude,
          longitude: v.longitude,
          accuracy: v.accuracy,
          created_at: clock(),
        },
      });
    return v;
  }
  function establish(req: Request, id: number) {
    return new Promise<void>((resolve, reject) =>
      req.session.regenerate((e) => {
        if (e) return reject(e);
        req.session.userId = id;
        req.session.csrf = crypto.randomBytes(32).toString("hex");
        req.session.save((e) => (e ? reject(e) : resolve()));
      }),
    );
  }
  app.get("/api/session", async (req, res) => {
    req.session.csrf ||= crypto.randomBytes(32).toString("hex");
    const user = await db.user.findUnique({
      where: { id: req.session.userId || 0 },
      select: {
        id: true,
        name: true,
        registration: true,
        role: true,
        photo: true,
      },
    });
    res.json({
      csrf: req.session.csrf,
      user: user
        ? {
            id: user.id,
            name: user.name,
            registration: user.registration,
            role: user.role,
            hasPhoto: !!user.photo,
          }
        : null,
      current: slot(clock(), config),
      campus: config.campus.name,
      demonstration: config.campus.demonstration,
      retention: config.retention,
    });
  });
  app.post("/api/register/location", geoLimit, anonymous, async (req, res) => {
    delete req.session.proof;
    const v = coordinates(req.body?.location);
    if (!v) return result(res, "INVALID_LOCATION");

    req.session.proof = {
      time: clock().getTime(),
      nonce: crypto.randomUUID(),
      latitude: v.latitude!,
      longitude: v.longitude!,
      accuracy: v.accuracy!,
    };
    result(res, "APPROVED");
  });
  app.post("/api/register", limiter, anonymous, async (req, res) => {
    const { name, registration, password, photo } = req.body;
    if (
      typeof name !== "string" ||
      name.trim().length < 3 ||
      name.length > 100 ||
      typeof registration !== "string" ||
      !/^\d{4,20}$/.test(registration) ||
      typeof password !== "string" ||
      password.length < 12 ||
      Buffer.byteLength(password) > 72
    )
      return res.status(400).json({
        message:
          "Informe nome (3–100 caracteres), matrícula (4–20 dígitos) e senha (mínimo 12 caracteres, máximo 72 bytes).",
      });
    const proof = req.session.proof;
    if (
      !proof ||
      ![proof.latitude, proof.longitude, proof.accuracy].every(
        Number.isFinite,
      ) ||
      clock().getTime() - proof.time > config.locationTtlSeconds * 1000
    ) {
      delete req.session.proof;
      return result(res, "EXPIRED");
    }
    if (
      typeof photo !== "string" ||
      !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(photo)
    )
      return res.status(400).json({ message: "Foto JPEG ou PNG inválida." });
    const buffer = Buffer.from(photo.split(",")[1], "base64");
    if (buffer.length > 2 * 1024 * 1024 || buffer.length < 100)
      return res.status(400).json({ message: "A foto deve ter até 2 MB." });
    let normalized;
    try {
      const input = sharp(buffer, { limitInputPixels: 16000000 });
      const meta = await input.metadata();
      if (
        !["jpeg", "png"].includes(meta.format) ||
        meta.width < 100 ||
        meta.height < 100 ||
        (meta.pages ?? 1) > 1
      )
        throw Error();
      normalized = await input
        .rotate()
        .resize(640, 640, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      return res.status(400).json({ message: "Conteúdo da foto inválido." });
    }
    const hash = await bcrypt.hash(password, 12);
    if (clock().getTime() - proof.time > config.locationTtlSeconds * 1000)
      return result(res, "EXPIRED");
    const filename = crypto.randomUUID() + ".jpg";
    fs.writeFileSync(path.join(dir, "photos", filename), normalized, {
      mode: 0o600,
      flag: "wx",
    });
    let created;
    try {
      created = await db.$transaction(async (tx) => {
        const row = await tx.user.create({
          data: {
            name: name.trim(),
            registration,
            password_hash: hash,
            photo: filename,
            created_at: clock(),
          },
        });
        await tx.registrationLocation.create({
          data: {
            user_id: row.id,
            latitude: proof.latitude,
            longitude: proof.longitude,
            accuracy: proof.accuracy,
            created_at: new Date(proof.time),
          },
        });
        return { id: row.id };
      });
    } catch (e) {
      fs.rmSync(path.join(dir, "photos", filename), { force: true });
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        return res.status(409).json({ message: "Matrícula já cadastrada." });
      throw e;
    }
    await establish(req, created.id);
    result(res, "REGISTERED", { registered: true });
  });
  const dummyHash = bcrypt.hashSync(crypto.randomUUID(), 12);
  app.post("/api/login", limiter, async (req, res) => {
    const { registration, password } = req.body;
    if (
      typeof registration !== "string" ||
      registration.length > 40 ||
      typeof password !== "string" ||
      Buffer.byteLength(password) > 72
    )
      return res.status(400).json({ message: "Dados de acesso inválidos." });
    const u = await db.user.findUnique({ where: { registration } });
    const ok = await bcrypt.compare(password, u?.password_hash || dummyHash);
    if (!u || !ok)
      return res.status(401).json({ message: "Matrícula ou senha incorreta." });
    await establish(req, u.id);
    res.json({ ok: true });
  });
  app.post("/api/logout", (req, res, next) =>
    req.session.destroy((e) => {
      if (e) return next(e);
      res.clearCookie("chamada.sid");
      res.json({ ok: true });
    }),
  );
  app.post("/api/attendance", geoLimit, auth, async (req, res) => {
    const v = await validate(req, "attendance");
    if (v.code !== "APPROVED") return result(res, v.code);
    const now = clock();
    result(
      res,
      await recordAttendance(
        db,
        req.user!.id,
        slot(now, config),
        config.campus.name,
        now,
      ),
    );
  });
  app.get("/api/history", auth, async (req, res) =>
    res.json(
      await db.attendance.findMany({
        where: { user_id: req.user!.id },
        select: {
          local_date: true,
          block: true,
          campus: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
        take: 1000,
      }),
    ),
  );
  app.get("/api/photos/:id", auth, async (req, res) => {
    if (String(req.user!.id) !== req.params.id && req.user!.role !== "admin")
      return res.sendStatus(403);
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.sendStatus(404);
    const row = await db.user.findUnique({
      where: { id },
      select: { photo: true },
    });
    if (!row?.photo) return res.sendStatus(404);
    res.type("jpeg").sendFile(path.join(dir, "photos", row.photo));
  });
  app.use("/api/admin", auth, admin);
  app.get("/api/admin/students", async (req, res) => {
    const users = await db.user.findMany({
      where: { role: "student" },
      select: {
        id: true,
        name: true,
        registration: true,
        photo: true,
        created_at: true,
      },
      orderBy: { name: "asc" },
      take: 5000,
    });
    res.json(users.map(({ photo, ...u }) => ({ ...u, hasPhoto: !!photo })));
  });
  app.get("/api/admin/attempts", async (req, res) => {
    const attempts = await db.attempt.findMany({
      include: { user: { select: { name: true, registration: true } } },
      orderBy: { id: "desc" },
      take: 1000,
    });
    res.json(
      attempts.map(({ user, ...a }) => ({
        ...a,
        name: user?.name ?? null,
        registration: user?.registration ?? null,
      })),
    );
  });
  const rows = async (req: Request) => {
    const local_date =
      typeof req.query.date === "string" && req.query.date
        ? req.query.date
        : undefined;
    const block =
      typeof req.query.block === "string" && req.query.block
        ? req.query.block
        : undefined;
    const records = await db.attendance.findMany({
      where: { local_date, block },
      include: { user: { select: { name: true, registration: true } } },
      orderBy: { created_at: "desc" },
    });
    return records.map((r) => ({
      name: r.user.name,
      registration: r.user.registration,
      local_date: r.local_date,
      block: r.block,
      campus: r.campus,
      created_at: r.created_at.toISOString(),
    }));
  };
  app.get("/api/admin/attendance", async (req, res) =>
    res.json(await rows(req)),
  );
  app.get("/api/admin/export", async (req, res) => {
    const esc = (v: string) =>
      '"' +
      (/^[=+@\-\t\r\n]/.test(v) ? "'" + v : v).replaceAll('"', '""') +
      '"';
    const data = await rows(req);
    res
      .set("Content-Disposition", 'attachment; filename="presencas.csv"')
      .type("text/csv")
      .send(
        "\uFEFF" +
          [
            [
              "Nome",
              "Matrícula",
              "Data local",
              "Bloco",
              "Campus",
              "Registro UTC",
            ],
            ...data.map((r) => Object.values(r)),
          ]
            .map((r) => r.map(esc).join(";"))
            .join("\r\n"),
      );
  });
  app.get("/api/admin/config", (req, res) =>
    res.json({ publicUrl: config.publicUrl, blocks: config.blocks }),
  );
  app.get("/api/admin/qr", async (req, res) => {
    res.type("png");
    if (req.query.download) res.attachment("qr-chamada.png");
    res.send(
      await QRCode.toBuffer(config.publicUrl, { width: 700, margin: 4 }),
    );
  });
  app.use(express.static(path.join(root, "public")));
  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    res.status(err.status === 413 ? 413 : 500).json({
      message:
        err.status === 413
          ? "Arquivo muito grande."
          : "Não foi possível concluir. Tente novamente.",
    });
  };
  app.use(errorHandler);
  return app;
}
