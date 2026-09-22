// Перестой: машина «Заехал» после даты выезда (docs/phases/PHASE_02_OVERSTAY.md).
// Чистые функции — одинаково на страницах, при выезде, при продлении и в тестах.

export type TariffRow = { vehicleType: string | null; price: number; minDays: number | null };

export type StayRow = { kind: string; status: string; dateTo: string; vehicleType: string | null; days: number; amount: number; paidAmount: number };

// shown — ДОЛГ за вычетом переплаты: долг, принятый заранее, гасит красную строку
export type Overstay = { days: number; rate: number; debt: number; shown: number };

export type Charge = { extra: number; rate: number; dateTo: string; days: number; amount: number };

function diffDays(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

// День выезда оплачен (сутки по датам включительно) — перестой с первого дня после него
export function overstayDays(b: Pick<StayRow, "kind" | "status" | "dateTo">, today: string): number {
  if (b.kind !== "PARKING" || b.status !== "CHECKED_IN" || b.dateTo >= today) return 0;
  return diffDays(b.dateTo, today);
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

// Бронь до новой даты выезда: лишние сутки по цене тарифа. Выезд в перестое и «Продлить» — одно правило.
export function chargeUntil(b: Pick<StayRow, "kind" | "dateTo" | "vehicleType" | "days" | "amount">, date: string, tariffs: TariffRow[]): Charge | null {
  if (b.kind !== "PARKING" || date <= b.dateTo) return null;
  const extra = diffDays(b.dateTo, date);
  const rate = dayRate(tariffs, b);
  return { extra, rate, dateTo: date, days: b.days + extra, amount: b.amount + extra * rate };
}
