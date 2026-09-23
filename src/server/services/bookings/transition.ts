import "server-only";
import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { GUARD_TRANSITIONS, STATUS_LABEL, TRANSITIONS } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { actualParkingDays, fmtDateTime, overstayDayIso, toDate, toIso } from "@/server/lib/dates";
import { periodsFromMinutes } from "@/lib/periods";
import { chargeUntil, checkoutDateAllowed, type Charge } from "@/lib/overstay";
import { parkingTariffs } from "../pricing";
import { audit } from "../audit";
import { onStatusChanged } from "@/server/automations/dispatcher";
import { BookingError, cancelPendingOutbox, chargeLine, lockBooking, stayOf } from "./shared";

export function canTransition(from: BookingStatus, to: BookingStatus, actor: SessionUser): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (actor.role === "GUARD" && !GUARD_TRANSITIONS.includes(to)) return false;
  return true;
}

// opts.at — фактическое время события (заехал/выехал/подтверждена); системное время остаётся в ленте (occurredAt)
export async function transition(bookingId: string, to: BookingStatus, actor: SessionUser, opts: { reason?: string; at?: Date } = {}) {
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (!canTransition(b.status, to, actor)) {
      throw new BookingError(`Переход «${STATUS_LABEL[b.status]}» → «${STATUS_LABEL[to]}» недопустим`);
    }
    const now = new Date();
    const given = opts.at && !isNaN(opts.at.getTime()) ? opts.at : now;
    if (given.getTime() > now.getTime() + 5 * 60_000) throw new BookingError("Фактическое время не может быть в будущем");
    // Допуск — только на расхождение часов: дата события не уходит в завтра (в 23:58 выезд не начислит лишние сутки)
    const at = given.getTime() > now.getTime() ? now : given;
    const data: Prisma.BookingUpdateInput = { status: to };
    if (to === "CONFIRMED") data.confirmedAt = at;
    if (to === "CHECKED_IN") data.checkedInAt = at;
    // Перестой при выезде (docs/phases/PHASE_02_OVERSTAY.md §4.3): долг сразу в бронь, дата выезда — фактическая,
    // поэтому «Отменить» на доске и повторный выезд второй раз не начисляют
    let charge: Charge | null = null;
    if (to === "CHECKED_OUT") {
      data.checkedOutAt = at;
      // Сутки перестоя — с льготным часом: выезд до 01:00 по Москве не начисляет
      const outDate = overstayDayIso(at);
      if (!checkoutDateAllowed({ kind: b.kind, status: b.status, dateTo: toIso(b.dateTo) }, outDate, overstayDayIso(now))) {
        throw new BookingError("В перестое выезд отмечается текущими сутками (с 01:00 по Москве). Если машина уехала раньше, а выезд не отметили — «Исправить статус» в карточке брони, с причиной");
      }
      charge = b.kind === "PARKING" && outDate > toIso(b.dateTo) ? chargeUntil(stayOf(b), outDate, await parkingTariffs(tx)) : null;
      if (charge) {
        data.dateTo = toDate(charge.dateTo);
        data.days = charge.days;
        data.amount = charge.amount;
        // Начисление снимает администратор с причиной (waiveOverstay) — храним его сумму
        if (charge.rate > 0) data.overstayCharge = (b.overstayCharge ?? 0) + charge.extra * charge.rate;
      }
      if (b.checkedInAt) {
        const actualDays = b.kind === "PARKING" ? actualParkingDays(b.checkedInAt, at, toIso(b.dateTo)) : periodsFromMinutes(Math.round((at.getTime() - b.checkedInAt.getTime()) / 60_000));
        data.actualDays = actualDays;
        // С перестоем баннер «по факту» нужен только при раннем заезде; поздний заезд — место держали, возврата нет
        if (charge ? actualDays <= charge.days : actualDays === b.days) data.recalcDecidedAt = now;
      } else if (charge) data.recalcDecidedAt = now;
    }
    if (to === "CANCELLED") {
      data.cancelledAt = now;
      data.cancelReason = opts.reason ?? null;
    }
    if (to === "NO_SHOW") data.noShowAt = now;
    if (to === "REJECTED") {
      data.rejectedAt = now;
      data.rejectKind = "OTHER";
      data.rejectReason = opts.reason ?? null;
    }
    // Подтверждение места из отклонённой заявки (резерв) — отметки отклонения снимаются
    if (b.status === "REJECTED" && to !== "REJECTED") {
      data.rejectedAt = null;
      data.rejectKind = null;
      data.rejectReason = null;
    }
    const updated = await tx.booking.update({ where: { id: bookingId }, data });
    const factual = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(to) && Math.abs(at.getTime() - now.getTime()) > 60_000 ? ` · по факту ${fmtDateTime(at)}` : "";
    await tx.interaction.create({
      data: {
        bookingId,
        clientId: b.clientId,
        type: "STATUS_CHANGE",
        text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL[to]}${factual}${opts.reason ? ` · ${opts.reason}` : ""}`,
        userId: actor.id,
        meta: { from: b.status, to, at: at.toISOString() },
      },
    });
    await audit(actor.id, "STATUS_CHANGE", "Booking", bookingId, { from: b.status, to, at: at.toISOString() }, tx);
    if (charge) {
      await tx.interaction.create({
        data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: chargeLine(b, charge, "Начислен перестой"), userId: actor.id, meta: { overstay: charge.extra, rate: charge.rate, priceFrom: b.amount, priceTo: charge.amount } },
      });
      await audit(actor.id, "UPDATE", "Booking", bookingId, { overstay: charge.extra, rate: charge.rate, dateToFrom: toIso(b.dateTo), dateTo: charge.dateTo, daysFrom: b.days, daysTo: charge.days, priceFrom: b.amount, priceTo: charge.amount }, tx);
    }
    if (to === "CANCELLED" || to === "NO_SHOW" || to === "REJECTED") await cancelPendingOutbox(bookingId, tx);
    await onStatusChanged(updated, to, tx);
    return updated;
  });
}
