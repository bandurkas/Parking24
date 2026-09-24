import "server-only";
import type { NoticeKind } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { notify } from "@/server/services/notices";

// Все уведомления Ф14 идут через эту функцию.
// unread: true — не создавать, пока есть непрочитанное того же вида (с бронью — по брони, без брони — по строке match).
// unread: false — событие само по себе единично (смена состояния канала, порог месяца, недоставка записи).
// key — на эпизод, а не на тему: `AdminNotice.dedupKey @unique` навсегда, ключ «на тему» заглушил бы все следующие аварии
export async function notifyOnce(
  kind: NoticeKind,
  text: string,
  o: { key: string; unread: boolean; bookingId?: string | null; match?: string },
): Promise<boolean> {
  const bookingId = o.bookingId ?? null;
  if (o.unread) {
    const where = bookingId ? { kind, readAt: null, bookingId } : { kind, readAt: null, bookingId: null, text: { contains: o.match ?? text } };
    if (await prisma.adminNotice.findFirst({ where, select: { id: true } })) return false;
  }
  return !!(await notify(kind, text, bookingId, { key: o.key }));
}
