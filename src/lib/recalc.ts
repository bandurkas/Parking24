// Пересчёт после выезда (Ф10, docs/phases/PHASE_10_REFUNDS.md Р1–Р3). Чистые функции — одинаково на странице, в действии и в тестах.
import { parkingDays } from "./periods";
import { pickTariff } from "./overstay";

export type PriceTariff = { vehicleType: string | null; roomType: string | null; unit: string; price: number; minDays: number | null; code: string };
export type Price = { amount: number; perDay: number; tariffCode: string | null };

// Цена по тарифу — одна для заявки (quote) и пересчёта: парковка — ступень по суткам, комната — тариф «сутки» своего типа.
// tariffs — активные тарифы одного вида ресурса
export function priceFor(tariffs: PriceTariff[], kind: string, days: number, opts: { vehicleType?: string | null; roomType?: string | null }): Price {
  if (days <= 0) return { amount: 0, perDay: 0, tariffCode: null };
  const t = kind === "PARKING" ? pickTariff(tariffs, opts.vehicleType, days) : tariffs.find((x) => x.roomType === opts.roomType && x.unit === "24h") ?? null;
  return t ? { amount: days * t.price, perDay: t.price, tariffCode: t.code } : { amount: 0, perDay: 0, tariffCode: null };
}

// Сутки к оплате (Р1): место держим с плановой даты заезда — поздний заезд их не уменьшает, ранний добавляет.
// actualDays — фактические сутки от отметки заезда, inDate — московская дата отметки. Комнаты — как есть
export function billableDays(b: { kind: string; dateFrom: string; inDate: string | null; actualDays: number }): number {
  if (b.kind !== "PARKING" || !b.inDate || b.inDate <= b.dateFrom) return b.actualDays;
  return b.actualDays + parkingDays(b.dateFrom, b.inDate) - 1;
}

export type PendingRow = { status: string; kind: string; days: number; actualDays: number | null; recalcDecidedAt: Date | string | null; dateFrom: string; inDate: string | null };

// Баннер «Стоянка по факту» открыт: выезд, сутки посчитаны, решения ещё нет и к оплате не столько, сколько по плану
export function recalcPending(b: PendingRow): boolean {
  if (b.status !== "CHECKED_OUT" || b.actualDays == null || b.recalcDecidedAt) return false;
  return billableDays({ kind: b.kind, dateFrom: b.dateFrom, inDate: b.inDate, actualDays: b.actualDays }) !== b.days;
}

export type RecalcMode = "tariff" | "manual" | "none";
export type RecalcCalc = { newAmount: number; perDay: number; mode: RecalcMode; hint: string };

// Р3: цена совпадает с тарифом на плановые сутки — по тарифу на сутки к оплате; задана вручную — пропорционально;
// цена «по запросу» или ручная цена после перестоя — не считаем, решает владелец
export function recalcFrom(
  b: { days: number; billDays: number; amount: number; overstayCharge: number | null },
  t: { plannedAmount: number; billAmount: number; billPerDay: number },
): RecalcCalc {
  if (t.billPerDay <= 0) return { newAmount: b.amount, perDay: 0, mode: "none", hint: "Цена по запросу — сумму меняет владелец через «Изменить цену» с причиной" };
  const manual = t.plannedAmount !== b.amount;
  if (manual && b.overstayCharge != null) return { newAmount: b.amount, perDay: 0, mode: "none", hint: "Сумма задана вручную и был перестой — сумму меняет владелец через «Изменить цену» с причиной" };
  if (manual) return { newAmount: Math.round((b.amount * b.billDays) / b.days), perDay: 0, mode: "manual", hint: "Сумма брони задана вручную — считаем пропорционально суткам" };
  // Ступень тарифа по суткам (от 30 — дешевле) не должна делать досрочный выезд дороже плана, а долгую стоянку — дешевле
  const newAmount = b.billDays < b.days ? Math.min(t.billAmount, b.amount) : Math.max(t.billAmount, b.amount);
  return { newAmount, perDay: t.billPerDay, mode: "tariff", hint: newAmount !== t.billAmount ? "Ступень тарифа сменилась — сумма не выходит за плановую" : "" };
}
