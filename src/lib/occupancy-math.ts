// Чистые функции занятости: считаются одинаково на сервере и в тестах, без обращения к базе.
// Правило 21.09: место занято в день заезда и в день выезда включительно.

export type Span = { dateFrom: string; dateTo: string };
export type DayLoad = { date: string; busy: number };

// Общий пул: легковые, кроссоверы и мото (решение пользователя 22.09). Грузовые считаются отдельно.
export const POOL_TYPES = ["CAR", "SUV", "MOTO"] as const;
export type PoolType = (typeof POOL_TYPES)[number];

export function isPoolType(t: string | null | undefined): t is PoolType {
  return t === "CAR" || t === "SUV" || t === "MOTO";
}

export function daysRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  const [y2, m2, d2] = to.split("-").map(Number);
  const end = Date.UTC(y2, m2 - 1, d2);
  for (let t = start; t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// Занятость по каждому дню отрезка [from, to] включительно.
export function loadByDay(bookings: Span[], from: string, to: string): DayLoad[] {
  return daysRange(from, to).map((date) => ({
    date,
    busy: bookings.filter((b) => b.dateFrom <= date && b.dateTo >= date).length,
  }));
}

// Пик занятости на отрезке брони — по нему решается, помещается ли заявка.
export function peakLoad(bookings: Span[], from: string, to: string): number {
  return loadByDay(bookings, from, to).reduce((max, d) => Math.max(max, d.busy), 0);
}

// Конец отрезка машины в перестое: «пока не решено» — на все дни вперёд
export const OPEN_END = "9999-12-31";

// Отрезок, на котором бронь занимает место (docs/phases/PHASE_02_OVERSTAY.md §4.1).
// «Заехал» — машина уже стоит: с сегодня, если заехала раньше брони, и без конца, пока в перестое.
export function effectiveSpan(b: { status: string; dateFrom: string; dateTo: string }, today: string): Span {
  if (b.status !== "CHECKED_IN") return { dateFrom: b.dateFrom, dateTo: b.dateTo };
  return { dateFrom: b.dateFrom < today ? b.dateFrom : today, dateTo: b.dateTo < today ? OPEN_END : b.dateTo };
}

// Помещается ли новая бронь: пик занятости плюс она сама не должны превышать порог.
// limit — порог автоподтверждения (395), при занятости 394 заявка ещё проходит.
export function fits(bookings: Span[], from: string, to: string, limit: number): boolean {
  return peakLoad(bookings, from, to) + 1 <= limit;
}
