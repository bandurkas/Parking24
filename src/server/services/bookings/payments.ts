import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { STATUS_LABEL } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { fmtDateTime, overstayDayIso, toIso } from "@/server/lib/dates";
import { chargeLeft, overstayDays, rub } from "@/lib/overstay";
import { applyRefund, demoteAfterRefund, reversalError, type RefundPlan } from "@/lib/refund";
import { recalcLtv } from "../clients";
import { shiftForPayment } from "../cash";
import { isRecalcPending, recalcPlanOf } from "../recalc";
import { audit } from "../audit";
import { onStatusChanged } from "@/server/automations/dispatcher";
import { assertMoneyActor, assertMoneyEditable, BookingError, guardCapacity, lockBooking, noteOverCapacity } from "./shared";

type Method = "CASH" | "CARD_TERMINAL" | "TRANSFER" | "ONLINE";

// reason — причина возврата и сторно (Payment.reason); note — примечание к оплате и причина «полной стоимости».
// reversalOf — сторно ошибочной оплаты: отдельная запись REFUND с суммой и способом исходной, исходная не меняется
export type PaymentInput = { bookingId: string; kind: "PAYMENT" | "REFUND"; method: Method; amount: number; note?: string; reason?: string; settle?: boolean; reversalOf?: string };

// Единственная точка записи денег (PLAN §3): оплата, возврат и сторно
export async function addPayment(input: PaymentInput, actor: SessionUser) {
  assertMoneyActor(actor);
  if (input.reversalOf && actor.role !== "OWNER") throw new BookingError("Сторно оформляет владелец");
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, input.bookingId);
    let b = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    const note = input.note?.trim() ?? "";
    const reason = input.reason?.trim() ?? "";
    let { kind, method, amount } = input;
    // Все проверки — до записи платежа, по заблокированной строке (docs/phases/PHASE_SP_URGENT_FIXES.md §3.3)
    let refund: RefundPlan | null = null;
    let reversed: { id: string; paidAt: Date } | null = null;
    if (input.reversalOf) {
      const p = await tx.payment.findUnique({ where: { id: input.reversalOf }, include: { reversal: { select: { id: true } } } });
      if (!p || p.bookingId !== b.id) throw new BookingError("Платёж не найден");
      const err = reversalError({ kind: p.kind, status: p.status, reversalOfId: p.reversalOfId, reversed: !!p.reversal, amount: p.amount }, b.paidAmount, true);
      if (err) throw new BookingError(err);
      if (reason.length < 3) throw new BookingError("Укажите причину сторно");
      kind = "REFUND";
      method = p.method;
      amount = p.amount;
      reversed = { id: p.id, paidAt: p.paidAt };
    } else if (kind === "REFUND") {
      if (reason.length < 3) throw new BookingError("Укажите причину возврата");
      refund = applyRefund({ status: b.status, amount: b.amount, paid: b.paidAmount }, amount);
      if (!refund) throw new BookingError(b.paidAmount > 0 ? `Возврат больше оплаченного: оплачено ${rub(b.paidAmount)}` : "По брони ничего не оплачено — возвращать нечего");
      // После выезда сумму брони возвратом уменьшает только владелец: иначе «оплата + тут же возврат» снимали бы долг без денег
      if (refund.cut > 0 && actor.role !== "OWNER") {
        const head = refund.over > 0 ? `После выезда администратор возвращает только переплату (${rub(refund.over)}).` : "Переплаты нет: после выезда администратор возвращает только переплату.";
        throw new BookingError(`${head} Досрочный выезд — сначала «Пересчитать по факту», затем возврат; уменьшить сумму брони иначе может владелец`);
      }
    }
    const settle = kind === "PAYMENT" && !!input.settle;
    const paidAmount = reversed ? b.paidAmount - amount : refund ? refund.paid : b.paidAmount + amount;
    if (settle) {
      // В перестое сумма брони догонит оплату при выезде; «полная стоимость» сейчас спутала бы начисление
      if (overstayDays({ kind: b.kind, status: b.status, dateTo: toIso(b.dateTo) }, overstayDayIso()) > 0) {
        throw new BookingError("В перестое «Это полная стоимость» недоступно: долг начислится при выезде");
      }
      // «Это полная стоимость» меняет цену — после выезда это может только владелец
      assertMoneyEditable(b, actor);
      if (paidAmount !== b.amount && !note) throw new BookingError("Укажите причину изменения цены в примечании");
    }
    // Способ — тот, что указал человек (у сторно — способ исходной оплаты): касса Ф11 вычитает только наличные.
    // Платёж, возврат и сторно — в открытую кассовую смену (сторно тоже в текущую: закрытая смена неизменна)
    const cashShiftId = await shiftForPayment(tx);
    const created = await tx.payment.create({
      data: { bookingId: b.id, kind, method, amount, note: note || null, reason: kind === "REFUND" ? reason || null : null, reversalOfId: reversed?.id ?? null, createdById: actor.id, cashShiftId },
    });
    // «Это полная стоимость»: сумма брони становится равной фактически оплаченной
    if (settle && paidAmount !== b.amount) {
      // Сумму решил владелец (после выезда «полная стоимость» — только он) — баннер «Стоянка по факту» закрывается
      const closeRecalc = isRecalcPending(b);
      await tx.interaction.create({
        data: { bookingId: b.id, clientId: b.clientId, type: "SYSTEM", text: `Цена изменена ${b.amount.toLocaleString("ru-RU")} → ${paidAmount.toLocaleString("ru-RU")} ₽ · ${note}${closeRecalc ? " · пересчёт по факту закрыт" : ""}`, userId: actor.id, meta: { priceFrom: b.amount, priceTo: paidAmount } },
      });
      await audit(actor.id, "UPDATE", "Booking", b.id, { priceFrom: b.amount, priceTo: paidAmount, reason: note, ...(closeRecalc ? { recalcClosed: true } : {}) }, tx);
      b = await tx.booking.update({ where: { id: b.id }, data: { amount: paidAmount, overstayCharge: chargeLeft(b.overstayCharge, b.amount, paidAmount), ...(closeRecalc ? { recalcDecidedAt: new Date() } : {}) } });
    }
    const data: Prisma.BookingUpdateInput = { paidAmount };
    let tail = "";
    if (refund && refund.cut > 0) {
      data.amount = refund.amount;
      data.overstayCharge = chargeLeft(b.overstayCharge, b.amount, refund.amount);
      tail = ` · сумма брони ${rub(b.amount)} → ${rub(refund.amount)}`;
      // Сумму решил владелец — «Пересчитать по факту» после этого пересчитал бы мимо решения
      if (isRecalcPending(b)) {
        data.recalcDecidedAt = new Date();
        tail += " · пересчёт по факту закрыт";
      }
    } else if (refund && refund.amount > refund.paid) tail = ` · не оплачено ${rub(refund.amount - refund.paid)}`;
    let updated = await tx.booking.update({ where: { id: b.id }, data });
    const why = [reason, note].filter(Boolean).join(" · ");
    const text = reversed
      ? `Сторно оплаты ${rub(amount)} от ${fmtDateTime(reversed.paidAt)} · ${reason} · оплачено ${rub(b.paidAmount)} → ${rub(paidAmount)}`
      : `${kind === "PAYMENT" ? "Оплата" : "Возврат"} ${amount.toLocaleString("ru-RU")} ₽${why ? ` · ${why}` : ""}${tail}`;
    await tx.interaction.create({
      data: {
        bookingId: b.id,
        clientId: b.clientId,
        type: "PAYMENT",
        text,
        userId: actor.id,
        meta: { method, kind, amount, paymentId: created.id, ...(reversed ? { reversalOf: reversed.id } : {}), ...(refund && refund.cut > 0 ? { priceFrom: b.amount, priceTo: refund.amount } : {}) },
      },
    });
    await audit(actor.id, "CREATE", "Payment", b.id, { kind, amount, method, paymentId: created.id, ...(kind === "REFUND" ? { reason } : {}), ...(reversed ? { reversalOf: reversed.id } : {}) }, tx);
    if (refund && refund.cut > 0) await audit(actor.id, "UPDATE", "Booking", b.id, { refund: amount, priceFrom: b.amount, priceTo: refund.amount, reason }, tx);
    if (b.clientId) await recalcLtv(b.clientId, tx);
    // Цена 0 («по запросу») — сначала цена, потом оплата: иначе любой 1 ₽ делал бы бронь «Подтверждена» (Р6)
    if (kind === "PAYMENT" && b.amount > 0 && paidAmount >= b.amount && (b.status === "NEW" || b.status === "AWAITING_PAYMENT")) {
      // Потолок (Ф3): «Новая заявка» место ещё не подтверждала — мягкая проверка без общей блокировки
      // (здесь уже взята строка брони; деньги приняты, блокировать нечего — только запись в ленту)
      const over = b.status === "NEW" ? await guardCapacity(tx, { id: b.id, kind: b.kind, vehicleType: b.vehicleType, dateFrom: toIso(b.dateFrom), dateTo: toIso(b.dateTo) }, "confirm", actor, { soft: true }) : null;
      if (over) await noteOverCapacity(tx, b, over, "soft", "Подтверждена оплатой", actor);
      updated = await tx.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
      await tx.interaction.create({
        data: { bookingId: b.id, clientId: b.clientId, type: "STATUS_CHANGE", text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL.CONFIRMED} (оплачено полностью)`, userId: actor.id, meta: { from: b.status, to: "CONFIRMED", at: new Date().toISOString() } },
      });
      await onStatusChanged(updated, "CONFIRMED", tx);
    }
    // Исправление учёта, не событие для клиента: автоматизации не запускаются
    const demote = kind === "REFUND" ? demoteAfterRefund({ status: b.status, paid: paidAmount }) : null;
    if (demote) {
      const at = new Date();
      updated = await tx.booking.update({ where: { id: b.id }, data: { status: demote, confirmedAt: null } });
      await tx.interaction.create({
        data: { bookingId: b.id, clientId: b.clientId, type: "STATUS_CHANGE", text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL[demote]} (${reversed ? "оплата сторнирована" : "оплата возвращена полностью"})`, userId: actor.id, meta: { from: b.status, to: demote, at: at.toISOString() } },
      });
      await audit(actor.id, "STATUS_CHANGE", "Booking", b.id, { from: b.status, to: demote, at: at.toISOString(), paidToZero: true }, tx);
    }
    return updated;
  });
}

// Сторно ошибочной оплаты (владелец) — через addPayment, чтобы запись денег оставалась одной
export async function reversePayment(paymentId: string, reason: string, actor: SessionUser) {
  if (actor.role !== "OWNER") throw new BookingError("Сторно оформляет владелец");
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } });
  if (!p) throw new BookingError("Платёж не найден");
  return addPayment({ bookingId: p.bookingId, kind: "REFUND", method: "CASH", amount: 0, reason, reversalOf: paymentId }, actor);
}

export async function changePrice(bookingId: string, amount: number, reason: string, actor: SessionUser) {
  assertMoneyActor(actor);
  const why = reason.trim();
  if (why.length < 3) throw new BookingError("Укажите причину изменения цены");
  if (amount < 0) throw new BookingError("Сумма не может быть отрицательной");
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    assertMoneyEditable(b, actor);
    if (b.amount === amount) return b;
    // Сумму решил владелец — «Пересчитать по факту» после этого переписал бы её (правило СП §3.3 п.15)
    const closeRecalc = isRecalcPending(b);
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { amount, overstayCharge: chargeLeft(b.overstayCharge, b.amount, amount), ...(closeRecalc ? { recalcDecidedAt: new Date() } : {}) } });
    await tx.interaction.create({
      data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Цена изменена ${b.amount.toLocaleString("ru-RU")} → ${amount.toLocaleString("ru-RU")} ₽ · ${why}${closeRecalc ? " · пересчёт по факту закрыт" : ""}`, userId: actor.id, meta: { priceFrom: b.amount, priceTo: amount } },
    });
    await audit(actor.id, "UPDATE", "Booking", bookingId, { priceFrom: b.amount, priceTo: amount, reason: why, ...(closeRecalc ? { recalcClosed: true } : {}) }, tx);
    return updated;
  });
}

// Решение по пересчёту после выезда: применить план (docs/phases/PHASE_10_REFUNDS.md Р1–Р3) или оставить по плану.
// expected — сумма, которую человек видел в баннере: иначе применился бы другой расчёт
export async function decideRecalc(bookingId: string, apply: boolean, actor: SessionUser, expected?: number) {
  assertMoneyActor(actor);
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    // Решение принимается один раз, после выезда: иначе прямой вызов перепишет начисленный перестой
    if (b.status !== "CHECKED_OUT" || b.recalcDecidedAt) throw new BookingError("Решение по пересчёту уже принято");
    if (b.actualDays == null) throw new BookingError("Фактические сутки стоянки неизвестны");
    const plan = await recalcPlanOf(b, tx);
    if (apply) {
      if (!plan) throw new BookingError("Пересчитывать нечего: сутки к оплате совпадают с планом");
      if (plan.mode === "none") throw new BookingError(`Пересчитать нельзя. ${plan.hint}`);
      // Сутки из дат, введённых вручную: уменьшить по ним сумму закрытой брони может только владелец (критика Ф10, блокер Р7)
      if (plan.ownerOnly && actor.role !== "OWNER") throw new BookingError("Сутки посчитаны по датам из «Исправить статус» — пересчитать может владелец");
      if (expected !== undefined && expected !== plan.newAmount) throw new BookingError("Бронь изменилась, пока был открыт расчёт — обновите страницу");
      await tx.booking.update({ where: { id: bookingId }, data: { days: plan.billDays, amount: plan.newAmount, recalcDecidedAt: new Date(), overstayCharge: chargeLeft(b.overstayCharge, b.amount, plan.newAmount) } });
      const how = `${plan.mode === "manual" ? " · цена задана вручную, пропорционально" : ""}${plan.heldFrom ? ` · место держали с ${plan.heldFrom}` : ""}`;
      await tx.interaction.create({
        data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Пересчёт по факту: ${b.days} → ${plan.billDays} сут., ${b.amount.toLocaleString("ru-RU")} → ${plan.newAmount.toLocaleString("ru-RU")} ₽${how}`, userId: actor.id, meta: { priceFrom: b.amount, priceTo: plan.newAmount, daysFrom: b.days, daysTo: plan.billDays, mode: plan.mode } },
      });
      await audit(actor.id, "UPDATE", "Booking", bookingId, { recalc: true, mode: plan.mode, daysFrom: b.days, daysTo: plan.billDays, priceFrom: b.amount, priceTo: plan.newAmount }, tx);
    } else {
      await tx.booking.update({ where: { id: bookingId }, data: { recalcDecidedAt: new Date() } });
      await tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Оставлено по плану: ${b.days} сут. (по факту ${plan?.billDays ?? b.actualDays})`, userId: actor.id } });
    }
  });
}

// Снять начисление за перестой после выезда (ответ пользователя 22.09: льготный час, дальше снимает администратор с причиной)
export async function waiveOverstay(bookingId: string, reason: string, actor: SessionUser) {
  assertMoneyActor(actor);
  const why = reason.trim();
  if (why.length < 3) throw new BookingError("Укажите причину");
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status !== "CHECKED_OUT" || !b.overstayCharge) throw new BookingError("Начисления за перестой нет");
    // Иначе «Пересчитать по факту» после снятия вернул бы снятые сутки (СП §13, Р11)
    if (isRecalcPending(b)) throw new BookingError("Сначала решите «Стоянка по факту»: пересчёт после снятия вернул бы снятые сутки");
    const amount = Math.max(0, b.amount - b.overstayCharge);
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { amount, overstayCharge: 0 } });
    await tx.interaction.create({
      data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Начисление за перестой снято: ${rub(b.overstayCharge)} · ${rub(b.amount)} → ${rub(amount)} · ${why}`, userId: actor.id, meta: { overstayWaived: b.overstayCharge, priceFrom: b.amount, priceTo: amount } },
    });
    await audit(actor.id, "UPDATE", "Booking", bookingId, { overstayWaived: b.overstayCharge, priceFrom: b.amount, priceTo: amount, reason: why }, tx);
    return updated;
  });
}
