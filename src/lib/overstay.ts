// Перестой: машина «Заехал» после даты выезда (docs/phases/PHASE_02_OVERSTAY.md).
// Чистые функции — одинаково на страницах, при выезде, при продлении и в тестах.
import { parkingDays } from "./periods";

export type TariffRow = { vehicleType: string | null; price: number; minDays: number | null };

export type StayRow = { kind: string; status: string; dateTo: string; vehicleType: string | null; days: number; amount: number; paidAmount: number };

// shown — ДОЛГ за вычетом переплаты: долг, принятый заранее, гасит красную строку
export type Overstay = { days: number; rate: number; debt: number; shown: number };

export type Charge = { extra: number; rate: number; dateTo: string; days: number; amount: number };

export const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

// Льготный час (ответ пользователя 22.09): сутки перестоя начинаются в 01:00 по Москве, выезд до 01:00 их не начисляет
export const OVERSTAY_GRACE_MIN = 60;

// Сутки после даты: to позже from (иначе parkingDays даёт 0 и результат −1 — вызывающие это исключают)
const daysAfter = (from: string, to: string) => parkingDays(from, to) - 1;

// День выезда оплачен (сутки по датам включительно) — перестой с первого дня после него
export function overstayDays(b: Pick<StayRow, "kind" | "status" | "dateTo">, today: string): number {
  if (b.kind !== "PARKING" || b.status !== "CHECKED_IN" || b.dateTo >= today) return 0;
  return daysAfter(b.dateTo, today);
}

// Тариф типа ТС с наибольшим minDays, не превышающим сутки брони. Общее правило с quote()
export function pickTariff<T extends TariffRow>(tariffs: T[], vehicleType: string | null | undefined, days: number): T | null {
  return tariffs.filter((t) => t.vehicleType === vehicleType && (t.minDays ?? 0) <= days).sort((a, b) => (b.minDays ?? 0) - (a.minDays ?? 0))[0] ?? null;
}

// Цена суток долга — текущий тариф по плановым суткам брони (ответ пользователя 22.09); 0 — «по запросу»
export function dayRate(tariffs: TariffRow[], b: Pick<StayRow, "vehicleType" | "days">): number {
  return pickTariff(tariffs, b.vehicleType, b.days)?.price ?? 0;
}

export function overstayDebt(b: StayRow, today: string, tariffs: TariffRow[]): Overstay | null {
  const days = overstayDays(b, today);
  if (!days) return null;
  const rate = dayRate(tariffs, b);
  const debt = days * rate;
  const overpaid = Math.max(0, b.paidAmount - b.amount);
  return { days, rate, debt, shown: Math.max(0, debt - overpaid) };
}

export type OverstayDue = { days: number; rate: number | null };

// Подтверждение выезда в перестое — карточка, «Сегодня», доска (Ф9а §12 в.1): промах стоит денег
export function overstayConfirmText(due: OverstayDue): string {
  if (!due.rate) return `Бронь в перестое: при выезде в сумму брони войдёт ДОЛГ ${due.days} сут., тариф не задан, сумму уточните после выезда. Отметить выезд?`;
  return `Бронь в перестое: при выезде в сумму брони войдёт ДОЛГ ${due.days} сут. × ${rub(due.rate)} = ${rub(due.days * due.rate)}. Отметить выезд?`;
}

// «перестой 2 сут. · долг 700 ₽» — для «Сегодня» и экрана охраны
export function overstayLabel(o: Pick<Overstay, "days" | "rate" | "shown">): string {
  if (o.rate === 0) return `перестой ${o.days} сут. · стоимость не задана`;
  return o.shown > 0 ? `перестой ${o.days} сут. · долг ${rub(o.shown)}` : `перестой ${o.days} сут. · долг оплачен`;
}

// Сколько начисления за перестой ещё можно снять, когда сумму брони уменьшили (владелец): снижение съедает его первым
export function chargeLeft(charge: number | null, from: number, to: number): number | null {
  return charge ? Math.max(0, charge - Math.max(0, from - to)) : charge;
}

// Бронь до новой даты выезда: лишние сутки по цене тарифа. Выезд в перестое и «Продлить» — одно правило.
export function chargeUntil(b: Pick<StayRow, "kind" | "dateTo" | "vehicleType" | "days" | "amount">, date: string, tariffs: TariffRow[]): Charge | null {
  if (b.kind !== "PARKING" || date <= b.dateTo) return null;
  const extra = daysAfter(b.dateTo, date);
  const rate = dayRate(tariffs, b);
  return { extra, rate, dateTo: date, days: b.days + extra, amount: b.amount + extra * rate };
}

// ── Ф2б: уведомление администратору о перестое (скан overstay, docs/phases/PHASE_02_OVERSTAY.md §4.6) ──

// Один перестой — одно уведомление; после «Продлить» и новой задержки дата другая — и ключ новый
export const overstayKey = (bookingId: string, dateTo: string) => `overstay:${bookingId}:${dateTo}`;

// Новые перестои без уведомления: старые по дате выезда первыми, не больше limit за тик (контракт скана)
export function planOverstay<T extends { id: string; dateTo: string }>(rows: T[], existing: Iterable<string>, limit = 50): T[] {
  const known = new Set(existing);
  return rows
    .filter((r) => !known.has(overstayKey(r.id, r.dateTo)))
    .sort((a, b) => (a.dateTo === b.dateTo ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.dateTo < b.dateTo ? -1 : 1))
    .slice(0, limit);
}

// Само закрытие: непрочитанные уведомления о перестое, которого больше нет. Вид обязателен, а notIn — только
// с непустым списком: в Prisma 6.19 пустой notIn выпадает из условия и погасил бы все непрочитанные
export function overstayCloseWhere(activeKeys: string[]) {
  return { kind: "OVERSTAY" as const, readAt: null, ...(activeKeys.length ? { dedupKey: { notIn: activeKeys } } : {}) };
}

const dayMonth = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`));

// «Перестой: бронь №12, А123ВС777 — выезд был 25 сент., машина на парковке. Выясните причину и освободите место»
export function overstayNoticeText(b: { number: number; plate: string | null; dateTo: string }): string {
  return `Перестой: бронь №${b.number}${b.plate ? `, ${b.plate}` : ""} — выезд был ${dayMonth(b.dateTo)}, машина на парковке. Выясните причину и освободите место`;
}

// Строка в ленте брони: «Перестой с 26 сент.: …»
export function overstayFeedText(dateTo: string): string {
  return `Перестой с ${dayMonth(daysAfterIso(dateTo))}: машина на парковке после даты выезда. Уведомлён администратор`;
}

function daysAfterIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// «Машина выехала, не оплачено 350 ₽ — бронь №12, А123ВС777». Дата выезда в ключе (после начисления — фактическая):
// «Отменить» и повторный выезд в тот же день не дублируют, а выезд после ещё одних суток на парковке — новый сигнал
export const unpaidCheckoutKey = (bookingId: string, dateTo: string) => `unpaid-out:${bookingId}:${dateTo}`;
export function unpaidCheckoutText(b: { kind: string; number: number; plate: string | null }, due: number): string {
  return `${b.kind === "PARKING" ? "Машина выехала" : "Выезд"}, не оплачено ${rub(due)} — бронь №${b.number}${b.plate ? `, ${b.plate}` : ""}`;
}
