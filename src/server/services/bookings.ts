import "server-only";
import type { Booking, BookingStatus, Channel, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePhone, normalizePlate } from "@/lib/phone";
import { GUARD_TRANSITIONS, STATUS_LABEL, TRANSITIONS } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { bookingDays, fmtDateTime, toDate } from "@/server/lib/dates";
import { periodsFromMinutes } from "@/lib/periods";
import { upsertClientByPhone, recalcLtv } from "./clients";
import { quote } from "./pricing";
import { audit } from "./audit";
import { onStatusChanged } from "@/server/automations/dispatcher";
import type { CreateBookingInput } from "@/server/validation/booking";

export class BookingError extends Error {}

// phone может отсутствовать только у лидов с сайта (клиент напишет в WhatsApp сам).
export type CreateBookingData = Omit<CreateBookingInput, "phone"> & { phone?: string | null; utm?: Prisma.InputJsonValue | null; channels?: Channel[]; messenger?: Channel | null };

export async function createBooking(input: CreateBookingData, actor: SessionUser | null) {
  const days = bookingDays(input.dateFrom, input.dateTo, input.timeFrom, input.timeTo);
  if (days <= 0) throw new BookingError("Выезд должен быть позже заезда");
  const board = await prisma.board.findUniqueOrThrow({ where: { kind: input.kind } });
  const plate = input.plate ? normalizePlate(input.plate) : null;
  const q = await quote(input.kind, days, { vehicleType: input.vehicleType ?? null, roomType: input.roomType || null });
  const amount = input.amount ?? q.amount;
  const freeTransferDays = 4;

  return prisma.$transaction(async (tx) => {
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
        status: input.status,
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
        confirmedAt: input.status === "CONFIRMED" ? new Date() : null,
        utm: input.utm ?? undefined,
        transferNeeded: input.transferNeeded || (input.kind === "PARKING" && days >= freeTransferDays),
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
    await audit(actor?.id ?? null, "CREATE", "Booking", booking.id, { number: booking.number, status: booking.status }, tx);
    await onStatusChanged(booking, booking.status, tx);
    return booking;
  });
}

export function canTransition(from: BookingStatus, to: BookingStatus, actor: SessionUser): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (actor.role === "GUARD" && !GUARD_TRANSITIONS.includes(to)) return false;
  return true;
}

// opts.at — фактическое время события (заехал/выехал/подтверждена); системное время остаётся в ленте (occurredAt)
export async function transition(bookingId: string, to: BookingStatus, actor: SessionUser, opts: { reason?: string; at?: Date } = {}) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (!canTransition(b.status, to, actor)) {
      throw new BookingError(`Переход «${STATUS_LABEL[b.status]}» → «${STATUS_LABEL[to]}» недопустим`);
    }
    const now = new Date();
    const at = opts.at && !isNaN(opts.at.getTime()) ? opts.at : now;
    if (at.getTime() > now.getTime() + 5 * 60_000) throw new BookingError("Фактическое время не может быть в будущем");
    const data: Prisma.BookingUpdateInput = { status: to };
    if (to === "CONFIRMED") data.confirmedAt = at;
    if (to === "CHECKED_IN") data.checkedInAt = at;
    if (to === "CHECKED_OUT") {
      data.checkedOutAt = at;
      if (b.checkedInAt) {
        const actualDays = periodsFromMinutes(Math.round((at.getTime() - b.checkedInAt.getTime()) / 60_000));
        data.actualDays = actualDays;
        if (actualDays === b.days) data.recalcDecidedAt = now;
      }
    }
    if (to === "CANCELLED") {
      data.cancelledAt = now;
      data.cancelReason = opts.reason ?? null;
    }
    if (to === "NO_SHOW") data.noShowAt = now;
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
    if (to === "CANCELLED" || to === "NO_SHOW") await cancelPendingOutbox(bookingId, tx);
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
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status === to) throw new BookingError("Бронь уже в этом статусе");
    const rank: Record<BookingStatus, number> = { NEW: 0, AWAITING_PAYMENT: 1, CONFIRMED: 2, CHECKED_IN: 3, CHECKED_OUT: 4, CANCELLED: 9, NO_SHOW: 9 };
    const data: Prisma.BookingUpdateInput = { status: to };
    if (rank[to] < 3) data.checkedInAt = null;
    if (rank[to] < 4) data.checkedOutAt = null;
    if (to !== "CANCELLED") { data.cancelledAt = null; data.cancelReason = null; }
    if (to !== "NO_SHOW") data.noShowAt = null;
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
    let b = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    await tx.payment.create({
      data: { bookingId: b.id, kind: input.kind, method: input.method, amount: input.amount, note: input.note || null, createdById: actor.id },
    });
    const delta = input.kind === "PAYMENT" ? input.amount : -input.amount;
    const paidAmount = Math.max(0, b.paidAmount + delta);
    // «Это полная стоимость»: сумма брони становится равной фактически оплаченной
    if (input.kind === "PAYMENT" && input.settle && paidAmount !== b.amount) {
      if (!input.note?.trim()) throw new BookingError("Укажите причину изменения цены в примечании");
      await tx.interaction.create({
        data: { bookingId: b.id, clientId: b.clientId, type: "SYSTEM", text: `Цена изменена ${b.amount.toLocaleString("ru-RU")} → ${paidAmount.toLocaleString("ru-RU")} ₽ · ${input.note.trim()}`, userId: actor.id, meta: { priceFrom: b.amount, priceTo: paidAmount } },
      });
      await audit(actor.id, "UPDATE", "Booking", b.id, { priceFrom: b.amount, priceTo: paidAmount, reason: input.note.trim() }, tx);
      b = await tx.booking.update({ where: { id: b.id }, data: { amount: paidAmount } });
    }
    let updated = await tx.booking.update({ where: { id: b.id }, data: { paidAmount } });
    await tx.interaction.create({
      data: {
        bookingId: b.id,
        clientId: b.clientId,
        type: "PAYMENT",
        text: `${input.kind === "PAYMENT" ? "Оплата" : "Возврат"} ${input.amount.toLocaleString("ru-RU")} ₽${input.note ? ` · ${input.note}` : ""}`,
        userId: actor.id,
        meta: { method: input.method, kind: input.kind, amount: input.amount },
      },
    });
    await audit(actor.id, "CREATE", "Payment", b.id, { kind: input.kind, amount: input.amount }, tx);
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
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (["CHECKED_OUT", "CANCELLED", "NO_SHOW"].includes(b.status) && actor.role !== "OWNER") throw new BookingError("После выезда цену меняет только владелец");
    if (b.amount === amount) return b;
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { amount } });
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
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.actualDays == null) throw new BookingError("Фактическое время стоянки неизвестно");
    if (apply && b.actualDays !== b.days) {
      const q = await quote(b.kind, b.actualDays, { vehicleType: b.vehicleType, roomType: b.roomType });
      const amount = q.amount > 0 ? q.amount : b.amount;
      await tx.booking.update({ where: { id: bookingId }, data: { days: b.actualDays, amount, recalcDecidedAt: new Date() } });
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

export async function addComment(bookingId: string, text: string, actor: SessionUser) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { clientId: true } });
  return prisma.interaction.create({ data: { bookingId, clientId: b.clientId, type: "COMMENT", text, userId: actor.id } });
}

export async function updateBooking(
  input: {
    bookingId: string; name?: string; plate?: string; vehicleType?: Booking["vehicleType"]; dateFrom: string; dateTo: string; timeFrom?: string; timeTo?: string;
    amount: number; transferNeeded: boolean; source: Booking["source"]; comment?: string; resourceId?: string;
  },
  actor: SessionUser,
) {
  const days = bookingDays(input.dateFrom, input.dateTo, input.timeFrom, input.timeTo);
  if (days <= 0) throw new BookingError("Выезд должен быть позже заезда");
  const plate = input.plate ? normalizePlate(input.plate) : null;
  return prisma.$transaction(async (tx) => {
    const before = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
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
        days,
        amount: input.amount,
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
