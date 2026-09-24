import "server-only";
import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { STATUS_LABEL } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { fmtDate, moscowIso, plannedMoment, toDate, todayIso } from "@/server/lib/dates";
import { chargeUntil, rub } from "@/lib/overstay";
import { checkCorrection, CLOSED_STATUSES, STATUS_RANK } from "@/lib/correction";
import { parkingTariffs } from "../pricing";
import { audit } from "../audit";
import { BookingError, lockBooking, stayOf } from "./shared";

// Исправление ошибки: любой статус → любой, причина обязательна, автоматизации не запускаются,
// запланированные сообщения по ошибочному статусу отменяются. Забытая отметка — датой без времени (решение 23.09)
export async function correctStatus(bookingId: string, to: BookingStatus, reason: string, actor: SessionUser, dates: { in?: string; out?: string } = {}) {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") throw new BookingError("Исправлять статус может только администратор");
  const why = reason.trim();
  if (why.length < 3) throw new BookingError("Укажите причину исправления");
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status === to) throw new BookingError("Бронь уже в этом статусе");
    // Закрытые брони уже могли попасть в отчёт (DECISIONS §2)
    if (CLOSED_STATUSES.includes(b.status) && actor.role !== "OWNER") throw new BookingError("Исправить статус закрытой брони может только владелец");
    const saved = { in: b.checkedInAt ? moscowIso(b.checkedInAt) : null, out: b.checkedOutAt ? moscowIso(b.checkedOutAt) : null };
    const { need, error } = checkCorrection(to, saved, dates, todayIso(), moscowIso(b.createdAt));
    if (error) throw new BookingError(error);
    const data: Prisma.BookingUpdateInput = { status: to };
    if (STATUS_RANK[to] < 3) { data.checkedInAt = null; data.checkedInDateOnly = false; }
    // Фактические сутки принадлежат снятому выезду: иначе они всплывут в баннере «Стоянка по факту» у следующего выезда
    if (STATUS_RANK[to] < 4) { data.checkedOutAt = null; data.checkedOutDateOnly = false; data.actualDays = null; }
    if (to !== "CANCELLED") { data.cancelledAt = null; data.cancelReason = null; }
    if (to !== "NO_SHOW") data.noShowAt = null;
    if (to !== "REJECTED") { data.rejectedAt = null; data.rejectKind = null; data.rejectReason = null; }
    else { data.rejectedAt = new Date(); data.rejectKind = "OTHER"; data.rejectReason = why; }
    if (to === "CANCELLED") { data.cancelledAt = new Date(); data.cancelReason = why; }
    if (to === "NO_SHOW") data.noShowAt = new Date();
    // Дата без времени хранится как 12:00 по Москве: календарный день не уезжает ни в UTC, ни в льготный час до 01:00
    if (need.in) { data.checkedInAt = plannedMoment(dates.in!); data.checkedInDateOnly = true; }
    if (need.out) { data.checkedOutAt = plannedMoment(dates.out!); data.checkedOutDateOnly = true; }
    const updated = await tx.booking.update({ where: { id: bookingId }, data });
    const day = (iso: string) => fmtDate(toDate(iso), { day: "numeric", month: "long" });
    const stamp = [need.in && `заезд ${day(dates.in!)}`, need.out && `выезд ${day(dates.out!)}`].filter(Boolean).join(", ");
    // В meta — только применённые даты: действие — публичная точка входа, лишним полям не верим
    const applied = { checkedInDate: need.in ? dates.in! : null, checkedOutDate: need.out ? dates.out! : null };
    await tx.interaction.create({
      data: {
        bookingId,
        clientId: b.clientId,
        type: "STATUS_CHANGE",
        text: `Исправление: ${STATUS_LABEL[b.status]} → ${STATUS_LABEL[to]}${stamp ? ` · ${stamp}, без времени` : ""} · ${why}`,
        userId: actor.id,
        meta: { from: b.status, to, correction: true, reason: why, ...applied },
      },
    });
    await audit(actor.id, "STATUS_CHANGE", "Booking", bookingId, { from: b.status, to, correction: true, reason: why, ...applied }, tx);
    // Исправление в «Выехал» перестой не начисляет (путь для забытого выезда) — но это видно в ленте,
    // и сутки считаются по введённой дате выезда, из любого исходного статуса
    if (to === "CHECKED_OUT" && need.out) {
      const c = chargeUntil(stayOf(b), dates.out!, await parkingTariffs(tx));
      if (c) {
        const sum = c.rate > 0 ? ` (${rub(c.extra * c.rate)})` : "";
        await tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Перестой ${c.extra} сут. не начислен${sum} · по дате выезда ${day(dates.out!)} · ${why}`, userId: actor.id } });
      }
    }
    const cancelled = await tx.outbox.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (cancelled.count > 0) {
      await tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Отменено запланированных сообщений: ${cancelled.count}`, userId: actor.id } });
    }
    return updated;
  });
}
