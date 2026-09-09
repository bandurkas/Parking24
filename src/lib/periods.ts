// Расчётные сутки: периоды по 24 часа от времени заезда, с льготным интервалом.
// Общий модуль для сайта и CRM — цена должна сходиться везде.
export const GRACE_MINUTES = 60;
export const DEFAULT_TIME = "12:00";

function stamp(dateIso: string, time?: string | null): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = (time && /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_TIME).split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm);
}

export function stayMinutes(dateFrom: string, dateTo: string, timeFrom?: string | null, timeTo?: string | null): number {
  if (!dateFrom || !dateTo) return 0;
  const a = stamp(dateFrom, timeFrom);
  const b = stamp(dateTo, timeTo);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 60_000);
}

// 0 — даты некорректны (выезд раньше заезда); иначе минимум 1.
export function billingPeriods(dateFrom: string, dateTo: string, timeFrom?: string | null, timeTo?: string | null, graceMinutes = GRACE_MINUTES): number {
  if (!dateFrom || !dateTo || dateTo < dateFrom) return 0;
  if (dateTo === dateFrom) return 1;
  const minutes = stayMinutes(dateFrom, dateTo, timeFrom, timeTo);
  if (minutes < 0) return 0;
  return Math.max(1, Math.ceil((minutes - graceMinutes) / 1440));
}

export function fmtDuration(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} сут.`);
  if (h) parts.push(`${h} ч`);
  if (m) parts.push(`${m} мин`);
  return parts.join(" ") || "0 мин";
}

export const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
