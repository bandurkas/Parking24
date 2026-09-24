import "server-only";
import type { Prisma, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { todayIso } from "@/server/lib/dates";
import { fits, peakLoad } from "@/lib/occupancy-math";
import { DECISION_OVERLOAD, noSpaceDecision, preDecision, type AutoDecision } from "@/lib/autoconfirm-decision";
import { canRejectNow, gateFacts, type GateFacts } from "@/lib/autoconfirm-gate";
import { parkingSettings } from "./settings";
import { poolSpans } from "./occupancy";

// Автоподтверждение заявок с сайта (ТЗ 21.09, п. 1.1–1.2; МФ-1).
// Решение и создание брони идут в одной транзакции под блокировкой: две одновременные заявки
// не должны занять одно последнее место.

export { decisionComment, type AutoDecision } from "@/lib/autoconfirm-decision";

export const OCCUPANCY_LOCK = 24_0921; // произвольный постоянный ключ pg_advisory_xact_lock

// Выключатель отправщика (Ф4 шаг 0); ключа нет — отправщика нет
export const SENDER_ENABLED_KEY = "messaging.senderEnabled";

// Блокировка держится до конца транзакции; повторный захват в той же транзакции безопасен.
export async function lockOccupancy(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${OCCUPANCY_LOCK})`);
}

// Есть ли чем ответить клиенту и включён ли отправщик — данные для предохранителя
export async function autoConfirmGate(db: Pick<Prisma.TransactionClient, "automationRule" | "setting"> = prisma): Promise<GateFacts> {
  const rules = await db.automationRule.findMany({
    where: { isActive: true, trigger: "STATUS_CHANGED" },
    select: { triggerParams: true, kind: true, template: { select: { isActive: true } } },
  });
  const sender = await db.setting.findUnique({ where: { key: SENDER_ENABLED_KEY } });
  return gateFacts(
    rules.map((r) => ({ triggerParams: r.triggerParams, kind: r.kind, templateActive: !!r.template?.isActive })),
    sender?.value ?? null,
  );
}

// Каким статусом создавать заявку с сайта. Автоматически решаются только легковые, кроссоверы и мото
// с распознанным телефоном и ненулевой ценой; отказ «мест нет» — только если его есть чем отправить.
// overload — повтор после сбоя: места не проверяем, заявка остаётся администратору
export async function decideSiteBooking(
  tx: Prisma.TransactionClient,
  input: { dateFrom: string; dateTo: string; vehicleType: VehicleType | null; phone: string | null; amount: number },
  overload = false,
): Promise<AutoDecision> {
  const s = await parkingSettings(tx);
  const pre = preDecision({ autoConfirm: s.autoConfirm, vehicleType: input.vehicleType, phone: input.phone, amount: input.amount });
  if (pre) return pre;
  if (overload) return DECISION_OVERLOAD;

  await lockOccupancy(tx);
  // Занятость пула внутри транзакции, по тому же правилу, что на страницах (перестой и ранний заезд — занято)
  const spans = await poolSpans(tx, "POOL", input.dateFrom, input.dateTo, todayIso());
  if (fits(spans, input.dateFrom, input.dateTo, s.autoConfirmLimit)) return { status: "AWAITING_PAYMENT", reason: "auto" };
  const peak = peakLoad(spans, input.dateFrom, input.dateTo);
  return noSpaceDecision(peak, s.autoConfirmLimit, canRejectNow(await autoConfirmGate(tx)));
}
