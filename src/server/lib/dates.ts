// Даты броней — календарные сутки, хранятся как DATE (UTC midnight).
export function toDate(iso: string): Date {
  return new Date(iso + "T00:00:00.000Z");
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayIso(tz = "Europe/Moscow"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts;
}

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function daysBetweenIso(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}

export function fmtDate(d: Date | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  const date = typeof d === "string" ? toDate(d) : d;
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", ...opts }).format(date).replace(".", "");
}

export function fmtRange(from: Date | string, to: Date | string): string {
  return `${fmtDate(from)} → ${fmtDate(to)}`;
}

export function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d).replace(".", "");
}
