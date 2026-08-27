import "server-only";
import type { BookingSource, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePhone } from "@/lib/phone";

export async function upsertClientByPhone(
  rawPhone: string,
  data: { name?: string | null; source?: BookingSource; utm?: Prisma.InputJsonValue | null },
  tx: Prisma.TransactionClient = prisma,
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Некорректный телефон");
  const existing = await tx.client.findUnique({ where: { phone } });
  if (existing) {
    if (!existing.name && data.name) await tx.client.update({ where: { id: existing.id }, data: { name: data.name } });
    return existing;
  }
  return tx.client.create({
    data: { phone, name: data.name || null, firstSource: data.source ?? "OTHER", firstUtm: data.utm ?? undefined },
  });
}

export async function recalcLtv(clientId: string, tx: Prisma.TransactionClient = prisma) {
  const agg = await tx.payment.aggregate({
    where: { booking: { clientId }, status: "SUCCEEDED" },
    _sum: { amount: true },
  });
  const refunds = await tx.payment.aggregate({
    where: { booking: { clientId }, status: "SUCCEEDED", kind: "REFUND" },
    _sum: { amount: true },
  });
  const ltv = (agg._sum.amount ?? 0) - 2 * (refunds._sum.amount ?? 0);
  await tx.client.update({ where: { id: clientId }, data: { ltv: Math.max(0, ltv) } });
}

export async function searchClients(q: string, take = 8) {
  const digits = q.replace(/\D/g, "");
  return prisma.client.findMany({
    where: {
      OR: [
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        { name: { contains: q, mode: "insensitive" as const } },
        { vehicles: { some: { plate: { contains: q.toUpperCase() } } } },
      ],
    },
    include: { vehicles: { orderBy: { createdAt: "desc" }, take: 3 }, _count: { select: { bookings: true } } },
    take,
    orderBy: { updatedAt: "desc" },
  });
}
