import "server-only";
import type { Booking, BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { renderTemplate } from "./render";
import { siteLinks } from "@/server/services/settings";
import { fmtMoscowEvent } from "@/server/lib/dates";
import { channelForClient } from "./sender-core";
import { scheduledFor, statusRuleMatches, type StatusRuleParams } from "@/lib/status-rules";
import { formatContract } from "@/lib/contract";

type Tx = Prisma.TransactionClient;

// Событийные триггеры (STATUS_CHANGED). Создаёт записи Outbox; отправка — в scheduler.
export async function onStatusChanged(booking: Booking, status: BookingStatus, tx: Tx = prisma) {
  const rules = await tx.automationRule.findMany({
    where: { isActive: true, trigger: "STATUS_CHANGED", OR: [{ kind: null }, { kind: booking.kind }] },
    include: { template: true },
  });
  const now = new Date();
  for (const rule of rules) {
    const p = (rule.triggerParams ?? {}) as StatusRuleParams;
    if (!statusRuleMatches(p, { status, source: booking.source, rejectKind: booking.rejectKind })) continue;
    if (!rule.template || !rule.template.isActive) continue;
    await enqueue(booking, rule.id, rule.code, rule.template.body, tx, scheduledFor(p, now), p.dedupGroup);
  }
}

// dedupGroup: правила одной группы шлют одно сообщение на бронь. «Ожидает оплаты» и «Подтверждена» — группа
// confirmation: после оплаты на ресепшене второе «место забронировано» клиенту не уходит
export async function enqueue(booking: Booking, ruleId: string | null, ruleCode: string, templateBody: string, tx: Tx = prisma, scheduledAt = new Date(), dedupGroup?: string) {
  const dedupKey = `${dedupGroup ?? ruleCode}:${booking.id}`;
  const exists = await tx.outbox.findUnique({ where: { dedupKey } });
  // Отменённое (откат статуса, отклонение) ключ не держит: новое подтверждение должно уйти
  if (exists && exists.status !== "CANCELLED") return null;
  const client = booking.clientId ? await tx.client.findUnique({ where: { id: booking.clientId } }) : null;
  // Номер договора выдан при заезде в той же транзакции (Ф5); нет номера — строка «Договор №» выпадает целиком
  const extras = { ...(await siteLinks(tx)), checkedInAt: booking.checkedInAt ? fmtMoscowEvent(booking.checkedInAt, booking.checkedInDateOnly) : null, contract: formatContract(booking.contractNumber) };
  const renderedText = renderTemplate(templateBody, { booking, client }, extras);
  const data = {
    ruleId,
    bookingId: booking.id,
    clientId: booking.clientId,
    channel: channelForClient(client).channel,
    templateCode: ruleCode,
    renderedText,
    scheduledAt,
  };
  if (exists) return tx.outbox.update({ where: { id: exists.id }, data: { ...data, status: "PENDING", attempts: 0, lastError: null, sentAt: null, nextAttemptAt: null, lockedUntil: null, sendingAt: null, providerMessageId: null } });
  return tx.outbox.create({ data: { ...data, dedupKey } });
}
