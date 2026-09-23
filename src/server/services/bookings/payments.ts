import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { STATUS_LABEL } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { overstayDayIso, toIso } from "@/server/lib/dates";
import { chargeLeft, overstayDays, rub } from "@/lib/overstay";
import { applyRefund, type RefundPlan } from "@/lib/refund";
import { recalcLtv } from "../clients";
import { quote } from "../pricing";
import { audit } from "../audit";
import { onStatusChanged } from "@/server/automations/dispatcher";
import { assertMoneyEditable, BookingError, lockBooking } from "./shared";

export async function addPayment(
  input: { bookingId: string; kind: "PAYMENT" | "REFUND"; method: "CASH" | "CARD_TERMINAL" | "TRANSFER" | "ONLINE"; amount: number; note?: string; settle?: boolean },
  actor: SessionUser,
) {
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, input.bookingId);
    let b = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    const note = input.note?.trim() ?? "";
    // Все проверки — до записи платежа, по заблокированной строке (docs/phases/PHASE_SP_URGENT_FIXES.md §3.3)
    let refund: RefundPlan | null = null;
    if (input.kind === "REFUND") {
      if (note.length < 3) throw new BookingError("Укажите причину возврата");
      refund = applyRefund({ status: b.status, amount: b.amount, paid: b.paidAmount }, input.amount);
      if (!refund) throw new BookingError(b.paidAmount > 0 ? `Возврат больше оплаченного: оплачено ${rub(b.paidAmount)}` : "По брони ничего не оплачено — возвращать нечего");
      // После выезда сумму брони возвратом уменьшает только владелец: иначе «оплата + тут же возврат» снимали бы долг без денег
      if (refund.cut > 0 && actor.role !== "OWNER") {
        const head = refund.over > 0 ? `После выезда администратор возвращает только переплату (${rub(refund.over)}).` : "Переплаты нет: после выезда администратор возвращает только переплату.";
        throw new BookingError(`${head} Досрочный выезд — сначала «Пересчитать по факту», затем возврат; уменьшить сумму брони иначе может владелец`);
      }
    }
    const settle = input.kind === "PAYMENT" && !!input.settle;
    const paidAmount = refund ? refund.paid : b.paidAmount + input.amount;
    if (settle) {
      // В перестое сумма брони догонит оплату при выезде; «полная стоимость» сейчас спутала бы начисление
      if (overstayDays({ kind: b.kind, status: b.status, dateTo: toIso(b.dateTo) }, overstayDayIso()) > 0) {
        throw new BookingError("В перестое «Это полная стоимость» недоступно: долг начислится при выезде");
      }
      // «Это полная стоимость» меняет цену — после выезда это может только владелец
      assertMoneyEditable(b, actor);
      if (paidAmount !== b.amount && !note) throw new BookingError("Укажите причину изменения цены в примечании");
    }
    await tx.payment.create({
      data: { bookingId: b.id, kind: input.kind, method: input.method, amount: input.amount, note: note || null, createdById: actor.id },
    });
    // «Это полная стоимость»: сумма брони становится равной фактически оплаченной
    if (settle && paidAmount !== b.amount) {
      await tx.interaction.create({
        data: { bookingId: b.id, clientId: b.clientId, type: "SYSTEM", text: `Цена изменена ${b.amount.toLocaleString("ru-RU")} → ${paidAmount.toLocaleString("ru-RU")} ₽ · ${note}`, userId: actor.id, meta: { priceFrom: b.amount, priceTo: paidAmount } },
      });
      await audit(actor.id, "UPDATE", "Booking", b.id, { priceFrom: b.amount, priceTo: paidAmount, reason: note }, tx);
      b = await tx.booking.update({ where: { id: b.id }, data: { amount: paidAmount, overstayCharge: chargeLeft(b.overstayCharge, b.amount, paidAmount) } });
    }
    const data: Prisma.BookingUpdateInput = { paidAmount };
    let tail = "";
    if (refund && refund.cut > 0) {
      data.amount = refund.amount;
      data.overstayCharge = chargeLeft(b.overstayCharge, b.amount, refund.amount);
      tail = ` · сумма брони ${rub(b.amount)} → ${rub(refund.amount)}`;
      // Сумму решил владелец — «Пересчитать по факту» после этого пересчитал бы по тарифу мимо решения
      if (b.actualDays != null && b.actualDays !== b.days && !b.recalcDecidedAt) {
        data.recalcDecidedAt = new Date();
        tail += " · пересчёт по факту закрыт";
      }
    } else if (refund && refund.amount > refund.paid) tail = ` · не оплачено ${rub(refund.amount - refund.paid)}`;
    let updated = await tx.booking.update({ where: { id: b.id }, data });
    await tx.interaction.create({
      data: {
        bookingId: b.id,
        clientId: b.clientId,
        type: "PAYMENT",
        text: `${input.kind === "PAYMENT" ? "Оплата" : "Возврат"} ${input.amount.toLocaleString("ru-RU")} ₽${note ? ` · ${note}` : ""}${tail}`,
        userId: actor.id,
        meta: { method: input.method, kind: input.kind, amount: input.amount, ...(refund && refund.cut > 0 ? { priceFrom: b.amount, priceTo: refund.amount } : {}) },
      },
    });
    await audit(actor.id, "CREATE", "Payment", b.id, { kind: input.kind, amount: input.amount }, tx);
    if (refund && refund.cut > 0) await audit(actor.id, "UPDATE", "Booking", b.id, { refund: input.amount, priceFrom: b.amount, priceTo: refund.amount, reason: note }, tx);
    if (b.clientId) await recalcLtv(b.clientId, tx);
    if (input.kind === "PAYMENT" && paidAmount >= b.amount && (b.status === "NEW" || b.status === "AWAITING_PAYMENT")) {
      updated = await tx.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
      await tx.interaction.create({
        data: { bookingId: b.id, clientId: b.clientId, type: "STATUS_CHANGE", text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL.CONFIRMED} (оплачено полностью)`, userId: actor.id, meta: { from: b.status, to: "CONFIRMED", at: new Date().toISOString() } },
      });
      await onStatusChanged(updated, "CONFIRMED", tx);
    }
    return updated;
  });
}

export async function changePrice(bookingId: string, amount: number, reason: string, actor: SessionUser) {
  const why = reason.trim();
  if (why.length < 3) throw new BookingError("Укажите причину изменения цены");
  if (amount < 0) throw new BookingError("Сумма не может быть отрицательной");
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    assertMoneyEditable(b, actor);
    if (b.amount === amount) return b;
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { amount, overstayCharge: chargeLeft(b.overstayCharge, b.amount, amount) } });
    await tx.interaction.create({
      data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Цена изменена ${b.amount.toLocaleString("ru-RU")} → ${amount.toLocaleString("ru-RU")} ₽ · ${why}`, userId: actor.id, meta: { priceFrom: b.amount, priceTo: amount } },
    });
    await audit(actor.id, "UPDATE", "Booking", bookingId, { priceFrom: b.amount, priceTo: amount, reason: why }, tx);
    return updated;
  });
}

// Решение по пересчёту после выезда: применить факт (сумма и сутки по факту) или оставить по плану
export async function decideRecalc(bookingId: string, apply: boolean, actor: SessionUser) {
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    // Решение принимается один раз, после выезда: иначе прямой вызов перепишет начисленный перестой
    if (b.status !== "CHECKED_OUT" || b.recalcDecidedAt) throw new BookingError("Решение по пересчёту уже принято");
    if (b.actualDays == null) throw new BookingError("Фактическое время стоянки неизвестно");
    if (apply && b.actualDays !== b.days) {
      const q = await quote(b.kind, b.actualDays, { vehicleType: b.vehicleType, roomType: b.roomType });
      const amount = q.amount > 0 ? q.amount : b.amount;
      await tx.booking.update({ where: { id: bookingId }, data: { days: b.actualDays, amount, recalcDecidedAt: new Date(), overstayCharge: chargeLeft(b.overstayCharge, b.amount, amount) } });
      await tx.interaction.create({
        data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Пересчёт по факту: ${b.days} → ${b.actualDays} сут., ${b.amount.toLocaleString("ru-RU")} → ${amount.toLocaleString("ru-RU")} ₽`, userId: actor.id, meta: { priceFrom: b.amount, priceTo: amount, daysFrom: b.days, daysTo: b.actualDays } },
      });
      await audit(actor.id, "UPDATE", "Booking", bookingId, { recalc: true, daysFrom: b.days, daysTo: b.actualDays, priceFrom: b.amount, priceTo: amount }, tx);
    } else {
      await tx.booking.update({ where: { id: bookingId }, data: { recalcDecidedAt: new Date() } });
      await tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Оставлено по плану: ${b.days} сут. (по факту ${b.actualDays})`, userId: actor.id } });
    }
  });
}

// Снять начисление за перестой после выезда (ответ пользователя 22.09: льготный час, дальше снимает администратор с причиной)
export async function waiveOverstay(bookingId: string, reason: string, actor: SessionUser) {
  if (actor.role === "GUARD") throw new BookingError("Снимает начисление администратор");
  const why = reason.trim();
  if (why.length < 3) throw new BookingError("Укажите причину");
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status !== "CHECKED_OUT" || !b.overstayCharge) throw new BookingError("Начисления за перестой нет");
    const amount = Math.max(0, b.amount - b.overstayCharge);
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { amount, overstayCharge: 0 } });
    await tx.interaction.create({
      data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Начисление за перестой снято: ${rub(b.overstayCharge)} · ${rub(b.amount)} → ${rub(amount)} · ${why}`, userId: actor.id, meta: { overstayWaived: b.overstayCharge, priceFrom: b.amount, priceTo: amount } },
    });
    await audit(actor.id, "UPDATE", "Booking", bookingId, { overstayWaived: b.overstayCharge, priceFrom: b.amount, priceTo: amount, reason: why }, tx);
    return updated;
  });
}
