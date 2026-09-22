import { billingPeriods, parkingDays } from "@/lib/periods";
import { OVERSTAY_GRACE_MIN } from "@/lib/overstay";
// Даты броней — календарные сутки, хранятся как DATE (UTC midnight).
export function toDate(iso: string): Date {
  return new Date(iso + "T00:00:00.000Z");
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Календарная дата момента по Москве: сутки парковки, перестой и «сегодня» считаются по ней, а не по UTC сервера
export function moscowIso(d: Date, tz = "Europe/Moscow"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function todayIso(tz = "Europe/Moscow"): string {
  return moscowIso(new Date(), tz);
}

// Сутки для перестоя — со сдвигом на льготный час: в 00:30 это ещё вчера. Занятость считается по todayIso
export function overstayDayIso(d: Date = new Date()): string {
  return moscowIso(new Date(d.getTime() - OVERSTAY_GRACE_MIN * 60_000));
}

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

// Расчётные сутки брони: парковка — даты включительно; остальное (комнаты и пр.) — 24-часовые периоды с льготой
export function bookingDays(dateFrom: string, dateTo: string, timeFrom?: string | null, timeTo?: string | null, kind: string = "PARKING"): number {
  return kind === "PARKING" ? parkingDays(dateFrom, dateTo) : billingPeriods(dateFrom, dateTo, timeFrom, timeTo);
}

// Фактические сутки парковки: календарные дни заезда и выезда включительно, по московскому времени.
// plannedTo — плановая дата выезда: выезд после неё в льготный час (до 01:00) сутки не добавляет, как и в начислении перестоя
export function actualParkingDays(checkedInAt: Date, checkedOutAt: Date, plannedTo?: string): number {
  const out = moscowIso(checkedOutAt);
  const end = plannedTo && out > plannedTo ? overstayDayIso(checkedOutAt) : out;
  return Math.max(1, parkingDays(moscowIso(checkedInAt), end));
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

// «22 сентября, 14:05» по Москве — фактический момент (заезд, выезд) в сообщении клиенту.
// Два вызова Intl: одним он вставляет «в» между датой и временем.
export function fmtMoscow(d: Date): string {
  const tz = { timeZone: "Europe/Moscow" } as const;
  const day = new Intl.DateTimeFormat("ru-RU", { ...tz, day: "numeric", month: "long" }).format(d);
  const time = new Intl.DateTimeFormat("ru-RU", { ...tz, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day}, ${time}`;
}

// «1 октября, 12:00» — дата и время для сообщений клиенту. Время берётся из брони (строка «ЧЧ:ММ»),
// по умолчанию 12:00: заказчик просил оставить время в брони, хотя на цену оно не влияет.
export function fmtDayTime(date: Date | string, time?: string | null): string {
  const day = fmtDate(date, { day: "numeric", month: "long" });
  const hhmm = time && /^\d{2}:\d{2}$/.test(time) ? time : "12:00";
  return `${day}, ${hhmm}`;
}

// Плановый момент заезда или выезда в UTC: календарная дата брони + время по Москве.
// Москва круглый год UTC+3, но смещение берём у Intl, чтобы не зашивать его числом.
export function plannedMoment(date: Date | string, time?: string | null, tz = "Europe/Moscow"): Date {
  const iso = typeof date === "string" ? date : toIso(date);
  const [hh, mm] = (time && /^\d{2}:\d{2}$/.test(time) ? time : "12:00").split(":").map(Number);
  const guess = new Date(`${iso}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (shown.getTime() - utc.getTime()));
}
