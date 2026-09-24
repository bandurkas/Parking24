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

// Пул брони (Ф3, вопрос 7): не фура — общий пул 405, в том числе старые брони без типа машины
export type PoolKind = "POOL" | "TRUCK";
export const poolOf = (vt: string | null | undefined): PoolKind => (vt === "TRUCK" ? "TRUCK" : "POOL");

export function daysRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  const [y2, m2, d2] = to.split("-").map(Number);
  const end = Date.UTC(y2, m2 - 1, d2);
  for (let t = start; t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const covers = (b: Span, day: string) => b.dateFrom <= day && b.dateTo >= day;

// Занятость по каждому дню отрезка [from, to] включительно.
export function loadByDay(bookings: Span[], from: string, to: string): DayLoad[] {
  return daysRange(from, to).map((date) => ({ date, busy: bookings.filter((b) => covers(b, date)).length }));
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

// Одна формула «помещается ли ещё одна бронь» — для автоподтверждения (порог) и потолка в CRM (вместимость)
export const roomFor = (busy: number, limit: number) => busy + 1 <= limit;

// Помещается ли новая бронь: пик занятости плюс она сама не должны превышать порог.
// limit — порог автоподтверждения (395), при занятости 394 заявка ещё проходит.
// Перевёрнутый отрезок — мусор на входе, а не «везде свободно»: иначе пустой список дней даёт пик 0
export function fits(bookings: Span[], from: string, to: string, limit: number): boolean {
  if (to < from) return false;
  return roomFor(peakLoad(bookings, from, to), limit);
}

// ── Кто держит место (Ф3 §3.1) ──────────────────────────────────────────────────────────
// Всегда: «Ожидает оплаты» и «Подтверждена» (предоплаты нет, решение №3 от 22.09) и «Заехал» (машина стоит).
export const FIRM_STATUSES = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"] as const;
export const isFirm = (s: string) => (FIRM_STATUSES as readonly string[]).includes(s);

// «Новая заявка» держит место, пока создана позже этой границы (parking.newLeadHoldHours, решение 23.09 №2).
// null — не держит (0 часов)
export function holdSinceOf(now: Date, hours: number): Date | null {
  return hours > 0 ? new Date(now.getTime() - hours * 3_600_000) : null;
}

// Держит ли бронь место (без учёта дат — даты решает effectiveSpan). То же условие, что в SQL occupiesWhere
export function holdsSpace(b: { status: string; createdAt: Date | number }, holdSince: Date | number | null): boolean {
  if (isFirm(b.status)) return true;
  return b.status === "NEW" && holdSince != null && +b.createdAt > +holdSince;
}

// Самый загруженный день отрезка; при равенстве — первый
export function worstDay(spans: Span[], from: string, to: string): { day: string; busy: number } {
  let day = from;
  let busy = -1;
  for (const d of daysRange(from, to)) {
    const n = spans.filter((s) => covers(s, d)).length;
    if (n > busy) {
      busy = n;
      day = d;
    }
  }
  return { day, busy: Math.max(0, busy) };
}

// Результат проверки потолка: самый загруженный день отрезка, занятость на нём и сколько из неё — перестой
export type Fit = { ok: boolean; day: string; busy: number; capacity: number; overstay: number };

// Хватает ли места брони на [from, to] (spans — без неё самой). Формула та же, что у fits
export function fitOn(spans: (Span & { overstay?: boolean })[], from: string, to: string, capacity: number): Fit {
  if (to < from) return { ok: false, day: from, busy: 0, capacity, overstay: 0 };
  const { day, busy } = worstDay(spans, from, to);
  const overstay = spans.filter((s) => s.overstay && covers(s, day)).length;
  return { ok: roomFor(busy, capacity), day, busy, capacity, overstay };
}

// Занятость по дням отдельно для каждого типа машины (просмотр категорий, ТЗ 4.1 — без вместимостей)
export function loadByDayByType<T extends Span & { vehicleType: string | null }>(spans: T[], from: string, to: string, types: readonly string[]): { vehicleType: string; days: DayLoad[] }[] {
  return types.map((vt) => ({ vehicleType: vt, days: loadByDay(spans.filter((s) => s.vehicleType === vt), from, to) }));
}

// ── Окно «ближайшие 24 часа» (ТЗ 3.1 и 4.2) — одно правило для панели, табло, доски и охраны (контракт Ф9б) ──
export const DUE_WINDOW_H = 24;
export type Due = "soon" | "late" | null;

// От момента, а не по календарным суткам. "late" — плановый момент прошёл: строка остаётся, пока событие не случилось
export function dueState(plannedAt: Date, now: Date, windowH = DUE_WINDOW_H): Due {
  const diff = plannedAt.getTime() - now.getTime();
  if (diff < 0) return "late";
  return diff <= windowH * 3_600_000 ? "soon" : null;
}

// Опоздавший заезд держится в «заездах за 24 ч» столько же, сколько до автоперехода в «Не приехал» (48 ч, PLAN §1)
export const ARRIVAL_LATE_H = 48;
