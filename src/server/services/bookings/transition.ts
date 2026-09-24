import "server-only";
import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { GUARD_TRANSITIONS, STATUS_LABEL, TRANSITIONS } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { actualParkingDays, overstayDayIso, toDate, toIso } from "@/server/lib/dates";
import { periodsFromMinutes } from "@/lib/periods";
import { chargeUntil, unpaidCheckoutKey, unpaidCheckoutText, type Charge } from "@/lib/overstay";
import { parkingTariffs } from "../pricing";
import { audit } from "../audit";
import { notify } from "../notices";
import { onStatusChanged } from "@/server/automations/dispatcher";
import { BookingError, cancelPendingOutbox, chargeLine, lockBooking, stayOf } from "./shared";

export function canTransition(from: BookingStatus, to: BookingStatus, actor: SessionUser): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  // Водитель и парковщик только смотрят (решение 24.09 п.9)
  if (actor.role !== "OWNER" && actor.role !== "ADMIN" && actor.role !== "GUARD") return false;
  if (actor.role === "GUARD" && !GUARD_TRANSITIONS.includes(to)) return false;
  return true;
}

// Время события — всегда серверное «сейчас» (ТЗ 3.3, решение 22.09). Ручного времени нет ни в UI, ни в действии;
// забытый заезд или выезд — «Исправить статус» датой без времени (решение 23.09)
export async function transition(bookingId: string, to: BookingStatus, actor: SessionUser, opts: { reason?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (!canTransition(b.status, to, actor)) {
      throw new BookingError(`Переход «${STATUS_LABEL[b.status]}» → «${STATUS_LABEL[to]}» недопустим`);
    }
    const at = new Date();
    const data: Prisma.BookingUpdateInput = { status: to };
    if (to === "CONFIRMED") data.confirmedAt = at;
    if (to === "CHECKED_IN") { data.checkedInAt = at; data.checkedInDateOnly = false; }
    // Перестой при выезде (docs/phases/PHASE_02_OVERSTAY.md §4.3): долг сразу в бронь, дата выезда — фактическая,
    // поэтому «Отменить» на доске и повторный выезд второй раз не начисляют
    let charge: Charge | null = null;
    if (to === "CHECKED_OUT") {
      data.checkedOutAt = at;
      data.checkedOutDateOnly = false;
      // Сутки перестоя — с льготным часом: выезд до 01:00 по Москве не начисляет
      const outDate = overstayDayIso(at);
      charge = b.kind === "PARKING" && outDate > toIso(b.dateTo) ? chargeUntil(stayOf(b), outDate, await parkingTariffs(tx)) : null;
      if (charge) {
        data.dateTo = toDate(charge.dateTo);
        data.days = charge.days;
        data.amount = charge.amount;
        // Начисление снимает администратор с причиной (waiveOverstay) — храним его сумму
        if (charge.rate > 0) data.overstayCharge = (b.overstayCharge ?? 0) + charge.extra * charge.rate;
      }
      // Заезд отмечен датой без времени: у не-парковки минуты от синтетического 12:00 — неправда, actualDays не пишем (деньги — Ф10);
      // у парковки счёт по календарным датам — честен и при отметке датой
      if (b.checkedInAt && (b.kind === "PARKING" || !b.checkedInDateOnly)) {
        const actualDays = b.kind === "PARKING" ? actualParkingDays(b.checkedInAt, at, toIso(b.dateTo)) : periodsFromMinutes(Math.round((at.getTime() - b.checkedInAt.getTime()) / 60_000));
        data.actualDays = actualDays;
        // С перестоем баннер «по факту» нужен только при раннем заезде; поздний заезд — место держали, возврата нет
        if (charge ? actualDays <= charge.days : actualDays === b.days) data.recalcDecidedAt = at;
      } else {
        data.actualDays = null;
        if (charge) data.recalcDecidedAt = at;
      }
    }
    if (to === "CANCELLED") {
      data.cancelledAt = at;
      data.cancelReason = opts.reason ?? null;
    }
    if (to === "NO_SHOW") data.noShowAt = at;
    if (to === "REJECTED") {
      data.rejectedAt = at;
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
    await tx.interaction.create({
      data: {
        bookingId,
        clientId: b.clientId,
        type: "STATUS_CHANGE",
        text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL[to]}${opts.reason ? ` · ${opts.reason}` : ""}`,
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
    // Охрана выпускает с долгом (ответ 22.09 п.5) — сигнал администратору сразу; ключ на бронь: «Отменить» и повторный выезд не дублируют
    const due = updated.amount - updated.paidAmount;
    if (to === "CHECKED_OUT" && due > 0) await notify("UNPAID_CHECKOUT", unpaidCheckoutText(updated, due), bookingId, { tx, key: unpaidCheckoutKey(bookingId) });
    if (to === "CANCELLED" || to === "NO_SHOW" || to === "REJECTED") await cancelPendingOutbox(bookingId, tx);
    await onStatusChanged(updated, to, tx);
    return updated;
  });
}
