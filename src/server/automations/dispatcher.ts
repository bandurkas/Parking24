import "server-only";
import type { Booking, BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { renderTemplate } from "./render";

type Tx = Prisma.TransactionClient;

// Событийные триггеры (STATUS_CHANGED). Создаёт записи Outbox; отправка — в scheduler.
export async function onStatusChanged(booking: Booking, status: BookingStatus, tx: Tx = prisma) {
  const rules = await tx.automationRule.findMany({
    where: { isActive: true, trigger: "STATUS_CHANGED", OR: [{ kind: null }, { kind: booking.kind }] },
    include: { template: true },
  });
  for (const rule of rules) {
    const p = (rule.triggerParams ?? {}) as { status?: string; source?: string };
    if (p.status !== status) continue;
    if (p.source && p.source !== booking.source) continue;
    if (!rule.template || !rule.template.isActive) continue;
    await enqueue(booking, rule.id, rule.code, rule.template.body, tx);
  }
}

export async function enqueue(booking: Booking, ruleId: string | null, ruleCode: string, templateBody: string, tx: Tx = prisma, scheduledAt = new Date()) {
  const dedupKey = `${ruleCode}:${booking.id}`;
  const exists = await tx.outbox.findUnique({ where: { dedupKey } });
  if (exists) return null;
  const client = booking.clientId ? await tx.client.findUnique({ where: { id: booking.clientId } }) : null;
  const renderedText = renderTemplate(templateBody, { booking, client });
  return tx.outbox.create({
    data: {
      ruleId,
      bookingId: booking.id,
      clientId: booking.clientId,
      channel: client?.messenger ?? "WHATSAPP",
      templateCode: ruleCode,
      renderedText,
      scheduledAt,
      dedupKey,
    },
  });
}
