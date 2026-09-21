import "server-only";
import type { NoticeKind, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

// Уведомления администратору в CRM (колокольчик в шапке).
export async function notify(kind: NoticeKind, text: string, bookingId?: string | null, tx: Prisma.TransactionClient = prisma) {
  return tx.adminNotice.create({ data: { kind, text, bookingId: bookingId ?? null } });
}

export async function unreadNotices(take = 20) {
  return prisma.adminNotice.findMany({
    where: { readAt: null },
    orderBy: { createdAt: "desc" },
    take,
    include: { booking: { select: { id: true, number: true } } },
  });
}

export async function unreadCount(): Promise<number> {
  return prisma.adminNotice.count({ where: { readAt: null } });
}

export async function markNoticesRead(userId: string, ids?: string[]) {
  await prisma.adminNotice.updateMany({
    where: { readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date(), readById: userId },
  });
}
