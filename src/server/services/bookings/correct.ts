import "server-only";
import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { STATUS_LABEL } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { overstayDayIso } from "@/server/lib/dates";
import { chargeUntil, rub } from "@/lib/overstay";
import { parkingTariffs } from "../pricing";
import { audit } from "../audit";
import { BookingError, lockBooking, stayOf } from "./shared";

// Исправление ошибки: любой статус → любой, только OWNER/ADMIN, причина обязательна, автоматизации не запускаются,
// запланированные сообщения по ошибочному статусу отменяются.
export async function correctStatus(bookingId: string, to: BookingStatus, reason: string, actor: SessionUser) {
  if (actor.role === "GUARD") throw new BookingError("Исправлять статус может только администратор");
  const why = reason.trim();
  if (why.length < 3) throw new BookingError("Укажите причину исправления");
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status === to) throw new BookingError("Бронь уже в этом статусе");
    const rank: Record<BookingStatus, number> = { NEW: 0, AWAITING_PAYMENT: 1, CONFIRMED: 2, CHECKED_IN: 3, CHECKED_OUT: 4, CANCELLED: 9, NO_SHOW: 9, REJECTED: 9 };
    const data: Prisma.BookingUpdateInput = { status: to };
    if (rank[to] < 3) data.checkedInAt = null;
    if (rank[to] < 4) data.checkedOutAt = null;
    if (to !== "CANCELLED") { data.cancelledAt = null; data.cancelReason = null; }
    if (to !== "NO_SHOW") data.noShowAt = null;
    if (to !== "REJECTED") { data.rejectedAt = null; data.rejectKind = null; data.rejectReason = null; }
    else { data.rejectedAt = new Date(); data.rejectKind = "OTHER"; data.rejectReason = why; }
    if (to === "CHECKED_IN" && !b.checkedInAt) data.checkedInAt = new Date();
    if (to === "CHECKED_OUT" && !b.checkedOutAt) data.checkedOutAt = new Date();
    if (to === "CANCELLED") { data.cancelledAt = new Date(); data.cancelReason = why; }
    if (to === "NO_SHOW") data.noShowAt = new Date();
    const updated = await tx.booking.update({ where: { id: bookingId }, data });
    await tx.interaction.create({
      data: {
        bookingId,
        clientId: b.clientId,
        type: "STATUS_CHANGE",
        text: `Исправление: ${STATUS_LABEL[b.status]} → ${STATUS_LABEL[to]} · ${why}`,
        userId: actor.id,
        meta: { from: b.status, to, correction: true, reason: why },
      },
    });
    await audit(actor.id, "STATUS_CHANGE", "Booking", bookingId, { from: b.status, to, correction: true, reason: why }, tx);
    // Исправление в «Выехал» перестой не начисляет (путь для забытого выезда) — но это видно в ленте
    if (to === "CHECKED_OUT" && b.status === "CHECKED_IN") {
      const c = chargeUntil(stayOf(b), overstayDayIso(), await parkingTariffs(tx));
      if (c) {
        const sum = c.rate > 0 ? ` (${rub(c.extra * c.rate)})` : "";
        await tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Перестой ${c.extra} сут. не начислен${sum} · ${why}`, userId: actor.id } });
      }
    }
    const cancelled = await tx.outbox.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (cancelled.count > 0) {
      await tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Отменено запланированных сообщений: ${cancelled.count}`, userId: actor.id } });
    }
    return updated;
  });
}
