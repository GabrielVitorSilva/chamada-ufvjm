import type { Config } from "./types.js";
export function slot(now: Date, config: Config) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const minutes = (v: string) =>
    Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const block = config.days.includes(weekday)
    ? config.blocks.find(
        ([a, b]) => minute >= minutes(a) && minute < minutes(b),
      )
    : null;
  return { date, block: block ? block.join("–") : null };
}
export function coordinates(input: unknown) {
  const { latitude, longitude, accuracy } = (input || {}) as Record<
    string,
    unknown
  >;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    typeof accuracy !== "number" ||
    ![latitude, longitude, accuracy].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    accuracy < 0 ||
    accuracy > 100000
  )
    return null;
  return { latitude, longitude, accuracy };
}
export function location(input: unknown, campus: Config["campus"]) {
  const value = coordinates(input);
  if (!value) return { code: "INVALID_LOCATION" };
  const { latitude, longitude, accuracy } = value;
  if (accuracy > campus.maxAccuracyMeters)
    return { code: "IMPRECISE", latitude, longitude, accuracy };
  const rad = (v: number) => (v * Math.PI) / 180;
  const a =
    Math.sin(rad(latitude - campus.latitude) / 2) ** 2 +
    Math.cos(rad(latitude)) *
      Math.cos(rad(campus.latitude)) *
      Math.sin(rad(longitude - campus.longitude) / 2) ** 2;
  const distance =
    6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return {
    code: distance <= campus.radiusMeters ? "APPROVED" : "OUTSIDE",
    latitude,
    longitude,
    accuracy,
    distance,
  };
}
