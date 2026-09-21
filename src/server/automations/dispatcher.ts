import "server-only";
import type { Booking, BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { renderTemplate } from "./render";
import { siteLinks } from "@/server/services/settings";
import { fmtMoscow } from "@/server/lib/dates";

type Tx = Prisma.TransactionClient;

// Событийные триггеры (STATUS_CHANGED). Создаёт записи Outbox; отправка — в scheduler.
export async function onStatusChanged(booking: Booking, status: BookingStatus, tx: Tx = prisma) {
  const rules = await tx.automationRule.findMany({
    where: { isActive: true, trigger: "STATUS_CHANGED", OR: [{ kind: null }, { kind: booking.kind }] },
    include: { template: true },
  });
  for (const rule of rules) {
    const p = (rule.triggerParams ?? {}) as { status?: string; source?: string; dedupGroup?: string };
    if (p.status !== status) continue;
    if (p.source && p.source !== booking.source) continue;
    if (!rule.template || !rule.template.isActive) continue;
    await enqueue(booking, rule.id, rule.code, rule.template.body, tx, new Date(), p.dedupGroup);
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
  // Номера договора в схеме ещё нет (этап 2): строка «Договор №» выпадет из текста целиком
  const extras = { ...(await siteLinks(tx)), checkedInAt: booking.checkedInAt ? fmtMoscow(booking.checkedInAt) : null };
  const renderedText = renderTemplate(templateBody, { booking, client }, extras);
  const data = {
    ruleId,
    bookingId: booking.id,
    clientId: booking.clientId,
    channel: client?.messenger ?? "WHATSAPP",
    templateCode: ruleCode,
    renderedText,
    scheduledAt,
  };
  if (exists) return tx.outbox.update({ where: { id: exists.id }, data: { ...data, status: "PENDING", attempts: 0, lastError: null, sentAt: null } });
  return tx.outbox.create({ data: { ...data, dedupKey } });
}
