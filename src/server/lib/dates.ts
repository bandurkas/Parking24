import { billingPeriods, isHHMM, parkingDays } from "@/lib/periods";
import { OVERSTAY_GRACE_MIN } from "@/lib/overstay";
import { moscowIso } from "@/lib/moscow";
import { dueState } from "@/lib/occupancy-math";

// moscowIso живёт в клиент-безопасном @/lib/moscow (на нём Ф9б чинит часы в шапке), ре-экспорт сохраняет старые импорты
export { moscowIso };

// Даты броней — календарные сутки, хранятся как DATE (UTC midnight).
export function toDate(iso: string): Date {
  return new Date(iso + "T00:00:00.000Z");
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  const hhmm = isHHMM(time) ? time : "12:00";
  return `${day}, ${hhmm}`;
}

// Момент события в CRM: без времени, если отметку поставили «Исправить статус» датой
export function fmtEvent(d: Date, dateOnly = false): string {
  if (!dateOnly) return fmtDateTime(d);
  return `${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short" }).format(d).replace(".", "")} · без времени`;
}

// То же для сообщения клиенту: время не выдумываем, остаётся только дата
export function fmtMoscowEvent(d: Date, dateOnly = false): string {
  if (!dateOnly) return fmtMoscow(d);
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" }).format(d);
}

const partsFmt = new Map<string, Intl.DateTimeFormat>();

// Смещение пояса tz от UTC в момент at, мс. Только Intl.formatToParts + Date.UTC: пояс процесса не участвует
export function tzOffsetMs(at: Date, tz = "Europe/Moscow"): number {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsFmt.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(at)) if (x.type !== "literal") p[x.type] = Number(x.value);
  // % 24 — ICU местами отдаёт полночь как 24
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - (at.getTime() - at.getUTCMilliseconds());
}

// Плановый момент заезда или выезда в UTC: календарная дата брони (по UTC — так хранится @db.Date) + время по поясу tz,
// без времени или с кривым временем — 12:00. Москва круглый год UTC+3, но смещение берём у Intl, а не числом.
// Два прохода: смещения по обе стороны возможного перехода и проверка на найденном моменте.
// Неоднозначное время (перевод часов назад) — более ранний из двух моментов; несуществующее (вперёд) — сдвиг вперёд на величину перехода
export function plannedMoment(date: Date | string, time?: string | null, tz = "Europe/Moscow"): Date {
  const iso = typeof date === "string" ? date : toIso(date);
  const [y, m, d] = iso.split("-").map(Number);
  const [hh, mm] = (isHHMM(time) ? time : "12:00").split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  if (Number.isNaN(wall)) return new Date(NaN);
  const before = tzOffsetMs(new Date(wall - 86_400_000), tz);
  const after = tzOffsetMs(new Date(wall + 86_400_000), tz);
  const found = [before, after].map((o) => wall - o).filter((t) => tzOffsetMs(new Date(t), tz) === wall - t);
  return new Date(found.length ? Math.min(...found) : wall - before);
}

// Плановые моменты брони (ТЗ 3.1, 4.2): окно 24 ч считается от них
export function plannedCheckIn(b: { dateFrom: Date | string; timeFrom?: string | null }): Date {
  return plannedMoment(b.dateFrom, b.timeFrom);
}

export function plannedCheckOut(b: { dateTo: Date | string; timeTo?: string | null }): Date {
  return plannedMoment(b.dateTo, b.timeTo);
}

// Обёртки над dueState (одно правило окна): «в ближайшие 24 ч» и «до конца окна, просроченные тоже»
export function within24h(moment: Date, now: Date): boolean {
  return dueState(moment, now) === "soon";
}

export function before24h(moment: Date, now: Date): boolean {
  return dueState(moment, now) !== null;
}
