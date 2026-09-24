// Табель рабочих смен (Ф13): чистые правила — окна смен, самоотметка, правка сетки, сводка.
// Без Prisma и server-only: зовут и сервис, и клиент. Время — только по Москве с явным timeZone
import { MOSCOW_TZ, moscowIso } from "@/lib/moscow";
import { addDays, daysBetweenIso, fmtDate, toDate } from "@/server/lib/dates";

export type Slot = "DAY" | "NIGHT" | "FULL";
export const SLOT_ORDER: Slot[] = ["DAY", "NIGHT", "FULL"];
export const SLOT_LABEL: Record<Slot, string> = { DAY: "День", NIGHT: "Ночь", FULL: "Сутки" };
export const slotHours = (s: Slot) => (s === "FULL" ? 24 : 12);

// Вопрос 1 (§15): ответ меняет эти строки и больше ничего
export const DAY_START_H = 8;
export const NIGHT_START_H = 20;
export const EARLY_H = 2;
export const LATE_H = 4;
const CUTOFF_H = (NIGHT_START_H + DAY_START_H + 24) / 2 - 24;
export const SELF_UNDO_MIN = 15;

export function moscowMinutes(d: Date): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: MOSCOW_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return (n("hour") % 24) * 60 + n("minute");
}

export const hhmm = (d: Date | string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: MOSCOW_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));

// Одно правило даты смены для кассы (Ф11), отчёта (Ф12) и табеля: до 02:00 по Москве — ещё вчера (реш. 4.4.2)
export const shiftDateOf = (d: Date) => moscowIso(new Date(d.getTime() - CUTOFF_H * 3_600_000));
export const tabelToday = (now: Date = new Date()) => shiftDateOf(now);

// Окно смены — минуты от 00:00 по Москве даты смены, [начало, конец)
export function windowOf(slot: Slot): [number, number] {
  const day = DAY_START_H * 60;
  const night = NIGHT_START_H * 60;
  return slot === "DAY" ? [day, night] : slot === "NIGHT" ? [night, day + 1440] : [day, day + 1440];
}
export const minutesFrom = (date: string, d: Date) => daysBetweenIso(date, moscowIso(d)) * 1440 + moscowMinutes(d);

export type StartOption = { date: string; slot: Slot; late: boolean; suggested: boolean };

// Что сотрудник отмечает сам (реш. 4.2.2): «сейчас» — от начала − 2 ч до конца, «прошедшая» — 4 ч после конца
export function startOptions(now: Date, slots: readonly Slot[]): StartOption[] {
  const today = moscowIso(now);
  const found: (StartOption & { at: number })[] = [];
  for (const date of [addDays(today, -1), today]) {
    const m = minutesFrom(date, now);
    for (const slot of SLOT_ORDER) {
      if (!slots.includes(slot)) continue;
      const [s, e] = windowOf(slot);
      if (m >= s - EARLY_H * 60 && m < e) found.push({ date, slot, late: false, suggested: false, at: s - m });
      else if (m >= e && m < e + LATE_H * 60) found.push({ date, slot, late: true, suggested: false, at: s - m });
    }
  }
  found.sort((a, b) => Number(a.late) - Number(b.late) || b.at - a.at);
  if (found[0] && !found[0].late) found[0].suggested = true;
  return found.map((o) => ({ date: o.date, slot: o.slot, late: o.late, suggested: o.suggested }));
}

export type ShiftState = "manual" | "open" | "closed" | "no-leave" | "late";
export type StateInput = { date: string; slot: Slot; startedAt: Date | string | null; endedAt: Date | string | null; openFor: string | null };

// «Открыта» — только с openFor и пока окно не истекло; время прихода само смену не открывает
export function shiftState(m: StateInput, now: Date): ShiftState {
  if (!m.startedAt) return "manual";
  const [, end] = windowOf(m.slot);
  if (minutesFrom(m.date, new Date(m.startedAt)) >= end) return "late";
  if (m.endedAt) return "closed";
  return m.openFor && minutesFrom(m.date, now) < end + LATE_H * 60 ? "open" : "no-leave";
}

export type OwnAction = { kind: "start" | "leave"; id: string; at: Date };
// Последнее своё действие не старше 15 минут — его отменяет «Отменить»
export function lastOwnAction(rows: { id: string; startedAt: Date | null; endedAt: Date | null }[], now: Date): OwnAction | null {
  const from = now.getTime() - SELF_UNDO_MIN * 60_000;
  let best: OwnAction | null = null;
  for (const r of rows) {
    for (const [kind, at] of [["start", r.startedAt], ["leave", r.endedAt]] as const) {
      if (!at || at.getTime() < from || at.getTime() > now.getTime()) continue;
      if (!best || at.getTime() > best.at.getTime() || (at.getTime() === best.at.getTime() && kind === "leave")) best = { kind, id: r.id, at };
    }
  }
  return best;
}

// Правила сетки в одном месте: зовут и сервис, и клиент. null — можно, иначе текст отказа
export function gridEditCheck(a: { actorRole: "OWNER" | "ADMIN"; actorId: string; empUserId: string | null; date: string; today: string }): string | null {
  if (a.date > a.today) return "Будущие даты не отмечаются: табель — это отработанные смены";
  if (a.actorRole !== "OWNER" && a.empUserId === a.actorId) return "Свою смену отмечайте кнопкой «Отметить приход». Прошлые правит владелец";
  return null;
}

// ── Даты для экрана (строки YYYY-MM-DD, без поясов процесса) ──

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export const monthOf = (iso: string) => iso.slice(0, 7);
export const monthStart = (month: string) => `${month}-01`;
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
}
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}
export const monthTitle = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export const weekdayOf = (iso: string) => WEEKDAY[toDate(iso).getUTCDay()];
export const dayLabel = (iso: string) => `${Number(iso.slice(8))} ${weekdayOf(iso)}`;
export const shortDate = (iso: string) => fmtDate(iso);
export const longDate = (iso: string) => fmtDate(iso, { day: "numeric", month: "long" });

export type Day = { date: string; weekday: string; weekend: boolean };
export function monthDays(month: string): Day[] {
  const out: Day[] = [];
  for (let d = monthStart(month), end = monthEnd(month); d <= end; d = addDays(d, 1)) {
    const wd = toDate(d).getUTCDay();
    out.push({ date: d, weekday: WEEKDAY[wd], weekend: wd === 0 || wd === 6 });
  }
  return out;
}

// ── Сетка ──

export type PositionIn = { id: string; name: string; slots: Slot[]; isActive: boolean };
export type Column = { positionId: string; name: string; slot: Slot; configured: boolean; positionActive: boolean };
export type MarkKey = { positionId: string; slot: Slot };

// Колонки = слоты активных должностей ∪ слоты, по которым в месяце есть отметки; должности — в порядке, как пришли
export function columnsOf(positions: PositionIn[], marks: MarkKey[]): Column[] {
  const used = new Set(marks.map((m) => `${m.positionId}|${m.slot}`));
  const out: Column[] = [];
  for (const p of positions)
    for (const slot of SLOT_ORDER) {
      const configured = p.slots.includes(slot);
      if ((p.isActive && configured) || used.has(`${p.id}|${slot}`)) out.push({ positionId: p.id, name: p.name, slot, configured, positionActive: p.isActive });
    }
  return out;
}

export const CHIP_COLORS = 8;
export function colorOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % CHIP_COLORS;
}

export const cellKey = (positionId: string, slot: Slot, date: string) => `${positionId}|${slot}|${date}`;

export type CountIn = { employeeId: string; employee: string; positionId: string; position: string; slot: Slot; hours: number };
export type ReportRow = { employee: string; position: string; day: number; night: number; full: number; total: number; hours: number };

// Сводка по паре «сотрудник + должность отметки»; порядок — как пришли строки
export function countsOf(marks: CountIn[]): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  for (const m of marks) {
    const k = `${m.employeeId}|${m.positionId}`;
    const r = rows.get(k) ?? { employee: m.employee, position: m.position, day: 0, night: 0, full: 0, total: 0, hours: 0 };
    if (m.slot === "DAY") r.day++;
    else if (m.slot === "NIGHT") r.night++;
    else r.full++;
    r.total++;
    r.hours += m.hours;
    rows.set(k, r);
  }
  return [...rows.values()];
}
