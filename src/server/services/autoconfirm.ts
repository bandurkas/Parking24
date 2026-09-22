import "server-only";
import type { Prisma, VehicleType } from "@prisma/client";
import { todayIso } from "@/server/lib/dates";
import { fits, peakLoad } from "@/lib/occupancy-math";
import { parkingSettings } from "./settings";
import { poolSpans } from "./occupancy";

// Автоподтверждение заявок с сайта (ТЗ 21.09, п. 1.1–1.2).
// Решение и создание брони идут в одной транзакции под блокировкой: две одновременные заявки
// не должны занять одно последнее место.

export const OCCUPANCY_LOCK = 24_0921; // произвольный постоянный ключ pg_advisory_xact_lock

export type AutoDecision =
  | { status: "AWAITING_PAYMENT"; reason: "auto" }
  | { status: "REJECTED"; reason: "no_space"; peak: number; limit: number }
  | { status: "NEW"; reason: "manual" | "off" | "truck" | "no_phone" };

// Блокировка держится до конца транзакции; вызывать только внутри prisma.$transaction.
export async function lockOccupancy(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${OCCUPANCY_LOCK})`);
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
  // Занятость пула внутри транзакции, по тому же правилу, что на страницах (перестой и ранний заезд — занято)
  const spans = await poolSpans(tx, "POOL", input.dateFrom, input.dateTo, todayIso());
  const peak = peakLoad(spans, input.dateFrom, input.dateTo);
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
