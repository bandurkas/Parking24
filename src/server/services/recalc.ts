import "server-only";
import type { Booking, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { fmtDate, moscowIso, toIso } from "@/server/lib/dates";
import { billableDays, priceFor, recalcFrom, recalcPending, type PendingRow, type RecalcMode } from "@/lib/recalc";
import { activeTariffs } from "./pricing";

// План пересчёта после выезда — один для баннера и для decideRecalc (Р2): баннер ничего не считает сам
export type RecalcPlan = {
  days: number; // по плану
  factDays: number; // по отметкам заезда и выезда
  billDays: number; // к оплате: место держали с плановой даты
  heldFrom: string | null; // «20 сентября», если поздний заезд увеличил сутки к оплате
  amount: number;
  newAmount: number;
  delta: number;
  perDay: number;
  mode: RecalcMode;
  hint: string;
  ownerOnly: boolean; // отметка датой из «Исправить статус»: сутки ввёл человек — пересчитывает владелец
};

type Row = Pick<Booking, "status" | "kind" | "days" | "actualDays" | "recalcDecidedAt" | "dateFrom" | "checkedInAt" | "checkedInDateOnly" | "checkedOutDateOnly" | "amount" | "overstayCharge" | "vehicleType" | "roomType">;

export function pendingRow(b: Pick<Booking, "status" | "kind" | "days" | "actualDays" | "recalcDecidedAt" | "dateFrom" | "checkedInAt">): PendingRow {
  return { status: b.status, kind: b.kind, days: b.days, actualDays: b.actualDays, recalcDecidedAt: b.recalcDecidedAt, dateFrom: toIso(b.dateFrom), inDate: b.checkedInAt ? moscowIso(b.checkedInAt) : null };
}

export function isRecalcPending(b: Parameters<typeof pendingRow>[0]): boolean {
  return recalcPending(pendingRow(b));
}

export async function recalcPlanOf(b: Row, db: Pick<Prisma.TransactionClient, "tariff"> = prisma): Promise<RecalcPlan | null> {
  const row = pendingRow(b);
  if (!recalcPending(row) || b.actualDays == null) return null;
  const billDays = billableDays({ kind: b.kind, dateFrom: row.dateFrom, inDate: row.inDate, actualDays: b.actualDays });
  const tariffs = await activeTariffs(b.kind, db);
  const opts = { vehicleType: b.vehicleType, roomType: b.roomType };
  const bill = priceFor(tariffs, b.kind, billDays, opts);
  const calc = recalcFrom(
    { days: b.days, billDays, amount: b.amount, overstayCharge: b.overstayCharge },
    { plannedAmount: priceFor(tariffs, b.kind, b.days, opts).amount, billAmount: bill.amount, billPerDay: bill.perDay },
  );
  return {
    days: b.days,
    factDays: b.actualDays,
    billDays,
    heldFrom: billDays !== b.actualDays ? fmtDate(b.dateFrom, { day: "numeric", month: "long" }) : null,
    amount: b.amount,
    newAmount: calc.newAmount,
    delta: calc.newAmount - b.amount,
    perDay: calc.perDay,
    mode: calc.mode,
    hint: calc.hint,
    ownerOnly: b.checkedInDateOnly || b.checkedOutDateOnly,
  };
}
