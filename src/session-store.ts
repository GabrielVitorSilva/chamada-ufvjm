import session from "express-session";
import type { PrismaClient, Prisma } from "./generated/prisma/client.js";
type Callback = (error?: unknown) => void;
export class PrismaSessionStore extends session.Store {
  private timer: NodeJS.Timeout;
  constructor(private db: PrismaClient) {
    super();
    this.timer = setInterval(() => {
      void db.session
        .deleteMany({ where: { expires: { lt: new Date() } } })
        .catch(() => console.error("Falha ao limpar sessões expiradas."));
    }, 900000);
    this.timer.unref();
  }
  get(
    sid: string,
    cb: (error: unknown, value?: session.SessionData | null) => void,
  ) {
    void this.db.session
      .findUnique({ where: { sid } })
      .then((row) =>
        cb(
          null,
          row && row.expires > new Date()
            ? (row.data as unknown as session.SessionData)
            : null,
        ),
      )
      .catch(cb);
  }
  set(sid: string, value: session.SessionData, cb: Callback = () => {}) {
    const expires = value.cookie.expires
      ? new Date(value.cookie.expires)
      : new Date(Date.now() + 28800000);
    const data = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    void this.db.session
      .upsert({
        where: { sid },
        create: { sid, data, expires },
        update: { data, expires },
      })
      .then(() => cb())
      .catch(cb);
  }
  destroy(sid: string, cb: Callback = () => {}) {
    void this.db.session
      .deleteMany({ where: { sid } })
      .then(() => cb())
      .catch(cb);
  }
  touch(sid: string, value: session.SessionData, cb: Callback = () => {}) {
    void this.db.session
      .updateMany({
        where: { sid },
        data: {
          expires: value.cookie.expires
            ? new Date(value.cookie.expires)
            : new Date(Date.now() + 28800000),
        },
      })
      .then(() => cb())
      .catch(cb);
  }
  close() {
    clearInterval(this.timer);
  }
}
