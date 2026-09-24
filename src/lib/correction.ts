import type { BookingStatus } from "@prisma/client";

// Ранг статуса: исправление в статус ранга < 3 снимает отметку заезда, < 4 — отметку выезда (как было в correctStatus)
export const STATUS_RANK: Record<BookingStatus, number> = {
  NEW: 0, AWAITING_PAYMENT: 1, CONFIRMED: 2, CHECKED_IN: 3, CHECKED_OUT: 4, CANCELLED: 9, NO_SHOW: 9, REJECTED: 9,
};

// Закрытые статусы: деньги и статус такой брони меняет только владелец (решение 24.09 п.4)
export const CLOSED_STATUSES: BookingStatus[] = ["CHECKED_OUT", "CANCELLED", "NO_SHOW"];

export type Marks = { checkedIn: boolean; checkedOut: boolean };

// Даты спрашиваем только у тех отметок, которые исправление ставит впервые
export function neededDates(to: BookingStatus, has: Marks): { in: boolean; out: boolean } {
  const keepIn = has.checkedIn && STATUS_RANK[to] >= 3;
  const keepOut = has.checkedOut && STATUS_RANK[to] >= 4;
  return {
    in: (to === "CHECKED_IN" || to === "CHECKED_OUT") && !keepIn,
    out: to === "CHECKED_OUT" && !keepOut,
  };
}

// 2026-02-31 проходит регулярку, а Date молча переносит её в март; 2026-09-00 — Invalid Date
function realDay(v: string): boolean {
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

// Текст ошибки или null. today — московская дата
export function checkDates(d: { in?: string; out?: string }, today: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  for (const [what, v] of [["заезда", d.in], ["выезда", d.out]] as const) {
    if (v === undefined) continue;
    if (!re.test(v) || !realDay(v)) return `Дата ${what} в формате ГГГГ-ММ-ДД`;
    if (v > today) return `Дата ${what} не может быть в будущем`;
  }
  if (d.in && d.out && d.out < d.in) return "Выезд не может быть раньше заезда";
  return null;
}

// Нижняя граница — только для введённых дат: сохранённые отметки ей не подчиняются (DECISIONS §2)
export function checkMinDate(d: { in?: string; out?: string }, minDate: string): string | null {
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(minDate + "T00:00:00.000Z"));
  for (const [what, v] of [["заезда", d.in], ["выезда", d.out]] as const) {
    if (v !== undefined && v < minDate) return `Дата ${what} не может быть раньше создания брони (${day})`;
  }
  return null;
}

// Сохранённые отметки — московскими датами ISO или null
export type SavedMarks = { in: string | null; out: string | null };

// Всё правило «Исправить статус» по датам: форма и сервер зовут только его
export function checkCorrection(to: BookingStatus, saved: SavedMarks, entered: { in?: string; out?: string }, today: string, minDate: string): { need: { in: boolean; out: boolean }; error: string | null } {
  const need = neededDates(to, { checkedIn: !!saved.in, checkedOut: !!saved.out });
  const dIn = need.in ? entered.in || undefined : undefined;
  const dOut = need.out ? entered.out || undefined : undefined;
  if (need.in && !dIn) return { need, error: "Укажите дату заезда" };
  if (need.out && !dOut) return { need, error: "Укажите дату выезда" };
  // Пару сохранённых отметок не перепроверяем: старая кривая бронь не должна запирать исправление, которое дат не вводит
  if (!need.in && !need.out) return { need, error: null };
  // Вторая дата — из сохранённой отметки: «выезд раньше заезда» не пройдёт и при одной введённой дате
  const effIn = dIn ?? (STATUS_RANK[to] >= 3 ? saved.in ?? undefined : undefined);
  const effOut = dOut ?? (STATUS_RANK[to] >= 4 ? saved.out ?? undefined : undefined);
  return { need, error: checkDates({ in: effIn, out: effOut }, today) ?? checkMinDate({ in: dIn, out: dOut }, minDate) };
}
