// Общий модуль расчёта суток для сайта и CRM — цена должна сходиться везде.
// ПАРКОВКА (правка заказчика 21.09): календарные дни заезда и выезда ВКЛЮЧИТЕЛЬНО, время на цену не влияет.
// КОМНАТЫ: периоды по 24 часа от времени заезда с льготным интервалом (billingPeriods).
export const GRACE_MINUTES = 60;
export const DEFAULT_TIME = "12:00";

// Строгое «ЧЧ:ММ» 00:00–23:59: «25:00» и «07:99» — не время. Одно правило на форму, сервер и расчёты
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isHHMM(v: unknown): v is string {
  return typeof v === "string" && HHMM.test(v);
}

// 17.09 → 19.09 = 3 суток; заезд и выезд в один день = 1; 0 — выезд раньше заезда.
export function parkingDays(dateFrom: string, dateTo: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateTo < dateFrom) return 0;
  const [y1, m1, d1] = dateFrom.split("-").map(Number);
  const [y2, m2, d2] = dateTo.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

function stamp(dateIso: string, time?: string | null): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = (isHHMM(time) ? time : DEFAULT_TIME).split(":").map(Number);
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

// Периоды по фактическим минутам стоянки (заезд → выезд по времени)
export function periodsFromMinutes(minutes: number, graceMinutes = GRACE_MINUTES): number {
  return Math.max(1, Math.ceil((Math.max(0, minutes) - graceMinutes) / 1440));
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
