import "server-only";
import type { NoticeKind } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { notify } from "@/server/services/notices";

// Все уведомления Ф14 идут через эту функцию. До Ф2б — дедупликация по непрочитанному:
// с бронью — одно непрочитанное этого вида на бронь, без брони — по строке match в тексте.
// После Ф2б тело заменяется на notify(kind, text, bookingId ?? null, { key }) — ключи уже переданы
export async function notifyOnce(kind: NoticeKind, text: string, o: { key: string; bookingId?: string | null; match?: string }): Promise<boolean> {
  const bookingId = o.bookingId ?? null;
  const where = bookingId ? { kind, readAt: null, bookingId } : { kind, readAt: null, bookingId: null, text: { contains: o.match ?? text } };
  if (await prisma.adminNotice.findFirst({ where, select: { id: true } })) return false;
  await notify(kind, text, bookingId);
  return true;
}
