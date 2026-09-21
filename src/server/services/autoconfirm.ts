import "server-only";
import type { BookingStatus, Prisma, VehicleType } from "@prisma/client";
import { toDate, toIso } from "@/server/lib/dates";
import { POOL_TYPES, fits, peakLoad, type Span } from "@/lib/occupancy-math";
import { parkingSettings } from "./settings";

// Автоподтверждение заявок с сайта (ТЗ 21.09, п. 1.1–1.2).
// Решение и создание брони идут в одной транзакции под блокировкой: две одновременные заявки
// не должны занять одно последнее место.

export const OCCUPANCY_LOCK = 24_0921; // произвольный постоянный ключ pg_advisory_xact_lock

export type AutoDecision =
  | { status: "AWAITING_PAYMENT"; reason: "auto" }
  | { status: "REJECTED"; reason: "no_space"; peak: number; limit: number }
  | { status: "NEW"; reason: "manual" | "off" | "truck" | "no_phone" };

const ACTIVE: BookingStatus[] = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"];

// Блокировка держится до конца транзакции; вызывать только внутри prisma.$transaction.
export async function lockOccupancy(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${OCCUPANCY_LOCK})`);
}

// Занятость общего пула на отрезке заявки, посчитанная внутри транзакции.
async function poolPeak(tx: Prisma.TransactionClient, dateFrom: string, dateTo: string): Promise<{ spans: Span[]; peak: number }> {
  const rows = await tx.booking.findMany({
    where: {
      kind: "PARKING",
      status: { in: ACTIVE },
      vehicleType: { in: [...POOL_TYPES] },
      dateFrom: { lte: toDate(dateTo) },
      dateTo: { gte: toDate(dateFrom) },
    },
    select: { dateFrom: true, dateTo: true },
  });
  const spans = rows.map((b) => ({ dateFrom: toIso(b.dateFrom), dateTo: toIso(b.dateTo) }));
  return { spans, peak: peakLoad(spans, dateFrom, dateTo) };
}

// Каким статусом создавать заявку с сайта.
// Автоматически решаются только легковые, кроссоверы и мото с распознанным телефоном:
// у грузовых цена по запросу, а без телефона некуда отправить ответ.
export async function decideSiteBooking(
  tx: Prisma.TransactionClient,
  input: { dateFrom: string; dateTo: string; vehicleType: VehicleType | null; phone: string | null },
): Promise<AutoDecision> {
  const s = await parkingSettings();
  if (!s.autoConfirm) return { status: "NEW", reason: "off" };
  if (input.vehicleType === "TRUCK") return { status: "NEW", reason: "truck" };
  if (!input.vehicleType) return { status: "NEW", reason: "manual" };
  if (!input.phone) return { status: "NEW", reason: "no_phone" };

  await lockOccupancy(tx);
  const { spans, peak } = await poolPeak(tx, input.dateFrom, input.dateTo);
  if (fits(spans, input.dateFrom, input.dateTo, s.autoConfirmLimit)) {
    return { status: "AWAITING_PAYMENT", reason: "auto" };
  }
  return { status: "REJECTED", reason: "no_space", peak, limit: s.autoConfirmLimit };
}

export function decisionComment(d: AutoDecision): string {
  switch (d.reason) {
    case "auto":
      return "Место подтверждено автоматически: на выбранные даты есть свободные места";
    case "no_space":
      return `Автоотклонение: на выбранные даты нет мест (занято ${d.peak} из ${d.limit})`;
    case "truck":
      return "Грузовой транспорт — цена и место подтверждает администратор";
    case "no_phone":
      return "Телефон не распознан — автоподтверждение невозможно";
    default:
      return "";
  }
}
