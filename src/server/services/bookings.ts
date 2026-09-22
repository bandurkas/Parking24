import "server-only";
import type { Booking, BookingStatus, Channel, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePhone, normalizePlate } from "@/lib/phone";
import { GUARD_TRANSITIONS, STATUS_LABEL, TRANSITIONS } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { actualParkingDays, bookingDays, fmtDate, fmtDateTime, overstayDayIso, toDate, toIso, todayIso } from "@/server/lib/dates";
import { periodsFromMinutes } from "@/lib/periods";
import { FREE_TRANSFER_MIN_DAYS } from "@/lib/tariffs";
import { chargeLeft, chargeUntil, checkoutDateAllowed, overstayDays, rub, type Charge } from "@/lib/overstay";
import { applyRefund, type RefundPlan } from "@/lib/refund";
import { upsertClientByPhone, recalcLtv } from "./clients";
import { parkingTariffs, quote } from "./pricing";
import { audit } from "./audit";
import { onStatusChanged } from "@/server/automations/dispatcher";
import type { CreateBookingInput } from "@/server/validation/booking";

export class BookingError extends Error {}

// phone может отсутствовать только у лидов с сайта (клиент напишет в WhatsApp сам).
export type CreateBookingData = Omit<CreateBookingInput, "phone"> & { phone?: string | null; utm?: Prisma.InputJsonValue | null; channels?: Channel[]; messenger?: Channel | null };

// decide — решение о стартовом статусе, принимаемое ВНУТРИ транзакции (автоподтверждение заявок с сайта):
// проверка занятости и создание брони должны быть одной операцией под блокировкой.
export type StatusDecider = (tx: Prisma.TransactionClient) => Promise<{ status: BookingStatus; note?: string }>;

export async function createBooking(input: CreateBookingData, actor: SessionUser | null, decide?: StatusDecider) {
  const days = bookingDays(input.dateFrom, input.dateTo, input.timeFrom, input.timeTo, input.kind);
  if (days <= 0) throw new BookingError("Выезд не может быть раньше заезда");
  const board = await prisma.board.findUniqueOrThrow({ where: { kind: input.kind } });
  const plate = input.plate ? normalizePlate(input.plate) : null;
  const q = await quote(input.kind, days, { vehicleType: input.vehicleType ?? null, roomType: input.roomType || null });
  const amount = input.amount ?? q.amount;

  return prisma.$transaction(async (tx) => {
    const decided = decide ? await decide(tx) : null;
    const status = decided?.status ?? input.status;
    const client = input.phone ? await upsertClientByPhone(input.phone, { name: input.name || null, source: input.source, utm: input.utm ?? null, channels: input.channels, messenger: input.messenger }, tx) : null;
    let vehicleId: string | null = null;
    if (client && input.kind === "PARKING" && input.vehicleType) {
      const existing = plate ? await tx.vehicle.findFirst({ where: { clientId: client.id, plate } }) : null;
      const v = existing ?? (await tx.vehicle.create({ data: { clientId: client.id, plate, type: input.vehicleType } }));
      vehicleId = v.id;
    }
    const booking = await tx.booking.create({
      data: {
        boardId: board.id,
        kind: input.kind,
        status,
        clientId: client?.id ?? null,
        contactPhone: client?.phone ?? null,
        contactName: input.name || client?.name || null,
        vehicleId,
        vehicleType: input.vehicleType ?? null,
        plate,
        roomType: input.roomType || null,
        dateFrom: toDate(input.dateFrom),
        dateTo: toDate(input.dateTo),
        timeFrom: input.timeFrom || null,
        timeTo: input.timeTo || null,
        days,
        amount,
        source: input.source,
        confirmedAt: status === "CONFIRMED" ? new Date() : null,
        rejectedAt: status === "REJECTED" ? new Date() : null,
        rejectKind: status === "REJECTED" ? "NO_SPACE" : null,
        utm: input.utm ?? undefined,
        transferNeeded: input.transferNeeded || (input.kind === "PARKING" && days >= FREE_TRANSFER_MIN_DAYS),
        comment: input.comment || null,
        createdById: actor?.id ?? null,
      },
    });
    await tx.interaction.create({
      data: {
        bookingId: booking.id,
        clientId: client?.id ?? null,
        type: input.source === "SITE" ? "SITE_LEAD" : "COMMENT",
        channel: input.source === "SITE" ? "SITE" : input.source === "CALL" ? "PHONE" : null,
        direction: "IN",
        text: input.source === "SITE" ? "Заявка с калькулятора на сайте" : `Заявка создана вручную (${actor?.name ?? "система"})`,
        userId: actor?.id ?? null,
      },
    });
    // Пояснение автоматического решения — отдельной строкой в ленте, автор «система»
    if (decided?.note) {
      await tx.interaction.create({ data: { bookingId: booking.id, clientId: client?.id ?? null, type: "SYSTEM", text: decided.note } });
    }
    await audit(actor?.id ?? null, "CREATE", "Booking", booking.id, { number: booking.number, status: booking.status }, tx);
    await onStatusChanged(booking, booking.status, tx);
    return booking;
  });
}

// Строка брони под блокировкой до конца транзакции: два одновременных «Выехал» (охрана и администратор,
// двойное нажатие) иначе оба проходят проверку статуса и задваивают начисление перестоя.
// NO KEY UPDATE: вставки в ленту и платежи по этой брони из других транзакций не ждут
async function lockBooking(tx: Prisma.TransactionClient, bookingId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR NO KEY UPDATE`;
}

// Действующее правило (changePrice): после выезда, отмены и «не приехал» деньги брони меняет только владелец
const CLOSED: BookingStatus[] = ["CHECKED_OUT", "CANCELLED", "NO_SHOW"];
function assertMoneyEditable(b: Booking, actor: SessionUser) {
  if (CLOSED.includes(b.status) && actor.role !== "OWNER") throw new BookingError("После выезда цену меняет только владелец");
}

// «Начислен перестой: 2 сут. × 350 ₽ = 700 ₽ · выезд 25 сент → 27 сент, 3 → 5 сут., 1 050 → 1 750 ₽»
function chargeLine(b: { dateTo: Date; days: number; amount: number }, c: Charge, head: string): string {
  const moved = `${fmtDate(b.dateTo)} → ${fmtDate(c.dateTo)}, ${b.days} → ${c.days} сут.`;
  if (c.rate === 0) return `${head}: ${c.extra} сут., тариф не задан — уточните сумму · выезд ${moved}`;
  return `${head}: ${c.extra} сут. × ${rub(c.rate)} = ${rub(c.extra * c.rate)} · выезд ${moved}, ${rub(b.amount)} → ${rub(c.amount)}`;
}

function stayOf(b: Booking) {
  return { kind: b.kind, dateTo: toIso(b.dateTo), vehicleType: b.vehicleType, days: b.days, amount: b.amount };
}

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

async function cancelPendingOutbox(bookingId: string, tx: Prisma.TransactionClient) {
  await tx.outbox.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "CANCELLED" } });
}

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

// «Продлить» из плашки перестоя: сумма растёт на сутки × тариф тем же правилом, что при выезде.
// Только бронь в перестое — она и так занимает все будущие дни, поэтому проверка мест не нужна.
export async function extendStay(bookingId: string, dateTo: string, actor: SessionUser) {
  if (actor.role === "GUARD") throw new BookingError("Продлевает администратор");
  const d = toDate(dateTo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || Number.isNaN(d.getTime()) || toIso(d) !== dateTo) throw new BookingError("Укажите дату выезда");
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const today = todayIso();
    if (!overstayDays({ kind: b.kind, status: b.status, dateTo: toIso(b.dateTo) }, overstayDayIso())) throw new BookingError("Продлить здесь можно только бронь в перестое");
    if (dateTo < today) throw new BookingError("Новая дата выезда — не раньше сегодня");
    const c = chargeUntil(stayOf(b), dateTo, await parkingTariffs(tx));
    if (!c) throw new BookingError("Новая дата выезда — позже прежней");
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { dateTo: toDate(c.dateTo), days: c.days, amount: c.amount } });
    await tx.interaction.create({
      data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: chargeLine(b, c, `Продлено до ${fmtDate(c.dateTo)}`), userId: actor.id, meta: { overstay: c.extra, rate: c.rate, priceFrom: b.amount, priceTo: c.amount } },
    });
    await audit(actor.id, "UPDATE", "Booking", bookingId, { extend: c.extra, rate: c.rate, dateToFrom: toIso(b.dateTo), dateTo: c.dateTo, daysFrom: b.days, daysTo: c.days, priceFrom: b.amount, priceTo: c.amount }, tx);
    return updated;
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

export async function addComment(bookingId: string, text: string, actor: SessionUser) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { clientId: true } });
  return prisma.interaction.create({ data: { bookingId, clientId: b.clientId, type: "COMMENT", text, userId: actor.id } });
}

export async function updateBooking(
  input: {
    bookingId: string; name?: string; plate?: string; vehicleType?: Booking["vehicleType"]; dateFrom: string; dateTo: string; timeFrom?: string; timeTo?: string;
    amount: number; transferNeeded: boolean; source: Booking["source"]; comment?: string; resourceId?: string;
    seenUpdatedAt?: string; // когда форма открыта: бронь, изменённую с тех пор (выезд, начисление), не перезаписываем
  },
  actor: SessionUser,
) {
  const { kind } = await prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId }, select: { kind: true } });
  const days = bookingDays(input.dateFrom, input.dateTo, input.timeFrom, input.timeTo, kind);
  if (days <= 0) throw new BookingError("Выезд не может быть раньше заезда");
  const plate =input.plate ? normalizePlate(input.plate) : null;
  return prisma.$transaction(async (tx) => {
    await lockBooking(tx, input.bookingId);
    const before = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    if (input.seenUpdatedAt && before.updatedAt.toISOString() !== input.seenUpdatedAt) {
      throw new BookingError("Бронь изменилась, пока была открыта форма — обновите страницу");
    }
    const spanChanged = toIso(before.dateFrom) !== input.dateFrom || toIso(before.dateTo) !== input.dateTo || (before.timeFrom ?? "") !== (input.timeFrom ?? "") || (before.timeTo ?? "") !== (input.timeTo ?? "");
    if (spanChanged || before.amount !== input.amount) assertMoneyEditable(before, actor);
    // В перестое правка дат, суммы или типа машины (цена суток долга) сняла бы долг без причины
    const typeChanged = input.vehicleType != null && input.vehicleType !== before.vehicleType;
    if ((spanChanged || before.amount !== input.amount || typeChanged) && overstayDays({ kind: before.kind, status: before.status, dateTo: toIso(before.dateTo) }, overstayDayIso()) > 0) {
      throw new BookingError("В перестое даты, сумму и тип машины здесь не меняют: продление — «Продлить», цена — «Изменить цену» с причиной, забытый выезд — «Исправить статус»");
    }
    // Машина на парковке: «Продлить» и тут же уменьшить сумму здесь — тот же снятый долг, только в обход причины
    if (before.status === "CHECKED_IN") {
      if (input.amount < before.amount) throw new BookingError("Машина на парковке: уменьшить сумму — «Изменить цену» с причиной");
      if (spanChanged && input.dateTo < todayIso()) throw new BookingError("Машина на парковке: дата выезда — не раньше сегодня");
    }
    const updated = await tx.booking.update({
      where: { id: input.bookingId },
      data: {
        contactName: input.name || null,
        plate,
        vehicleType: input.vehicleType ?? before.vehicleType,
        dateFrom: toDate(input.dateFrom),
        dateTo: toDate(input.dateTo),
        timeFrom: input.timeFrom || null,
        timeTo: input.timeTo || null,
        // сутки пересчитываются, только когда менялись даты: начисленные при выезде не теряются при правке госномера
        days: spanChanged ? days : before.days,
        amount: input.amount,
        overstayCharge: chargeLeft(before.overstayCharge, before.amount, input.amount),
        transferNeeded: input.transferNeeded,
        source: input.source,
        comment: input.comment || null,
        resourceId: input.resourceId || null,
      },
    });
    if (before.clientId && input.name && !(await tx.client.findUnique({ where: { id: before.clientId } }))?.name) {
      await tx.client.update({ where: { id: before.clientId }, data: { name: input.name } });
    }
    const changes: string[] = [];
    if (before.amount !== updated.amount) changes.push(`сумма ${before.amount} → ${updated.amount} ₽`);
    if (before.dateFrom.getTime() !== updated.dateFrom.getTime() || before.dateTo.getTime() !== updated.dateTo.getTime()) changes.push("даты");
    if (before.plate !== updated.plate) changes.push(`номер ${before.plate ?? "—"} → ${updated.plate ?? "—"}`);
    await tx.interaction.create({
      data: { bookingId: updated.id, clientId: updated.clientId, type: "SYSTEM", text: `Изменено: ${changes.length ? changes.join(", ") : "данные брони"}`, userId: actor.id },
    });
    await audit(actor.id, "UPDATE", "Booking", updated.id, { changes }, tx);
    return updated;
  });
}

export const bookingInclude = {
  client: { select: { id: true, name: true, phone: true, ltv: true, messenger: true, channels: true, telegram: true, _count: { select: { bookings: true } } } },
  vehicle: true,
  resource: true,
  payments: { orderBy: { paidAt: "desc" as const } },
  interactions: { orderBy: { occurredAt: "desc" as const }, include: { user: { select: { name: true } } } },
  outbox: { orderBy: { scheduledAt: "asc" as const } },
  createdBy: { select: { name: true } },
} satisfies Prisma.BookingInclude;

export type BookingFull = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export async function findByPhoneOrPlate(q: string) {
  const digits = q.replace(/\D/g, "");
  const num = /^\d{1,6}$/.test(q.trim()) ? Number(q.trim()) : null;
  return prisma.booking.findMany({
    where: {
      OR: [
        ...(num ? [{ number: num }] : []),
        ...(digits.length >= 4 ? [{ contactPhone: { contains: digits.slice(-Math.min(10, digits.length)) } }] : []),
        { plate: { contains: normalizePlate(q) } },
        { contactName: { contains: q, mode: "insensitive" as const } },
      ],
    },
    include: { client: { select: { name: true, phone: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}

export function normalizeContact(phone: string) {
  return normalizePhone(phone);
}
