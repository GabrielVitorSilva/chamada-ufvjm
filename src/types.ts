import type { User } from "./generated/prisma/client.js";
export interface Config {
  publicUrl: string;
  campus: {
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    maxAccuracyMeters: number;
    demonstration: boolean;
  };
  days: number[];
  blocks: [string, string][];
  locationTtlSeconds: number;
  retention: { photosDays: number; locationsDays: number };
}
export interface Slot {
  date: string;
  block: string | null;
}
declare module "express-session" {
  interface SessionData {
    csrf?: string;
    userId?: number;
    proof?: {
      time: number;
      nonce: string;
      latitude: number;
      longitude: number;
      accuracy: number;
    };
  }
}
declare global {
  namespace Express {
    interface Request {
      user?: Pick<User, "id" | "name" | "registration" | "role" | "photo">;
    }
  }
}
