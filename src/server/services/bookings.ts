import "server-only";
import type { Booking, BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePhone, normalizePlate } from "@/lib/phone";
import { GUARD_TRANSITIONS, STATUS_LABEL, TRANSITIONS } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { daysBetweenIso, toDate } from "@/server/lib/dates";
import { upsertClientByPhone, recalcLtv } from "./clients";
import { quote } from "./pricing";
import { audit } from "./audit";
import { onStatusChanged } from "@/server/automations/dispatcher";
import type { CreateBookingInput } from "@/server/validation/booking";

export class BookingError extends Error {}

export async function createBooking(input: CreateBookingInput, actor: SessionUser | null) {
  const days = daysBetweenIso(input.dateFrom, input.dateTo);
  const board = await prisma.board.findUniqueOrThrow({ where: { kind: input.kind } });
  const plate = input.plate ? normalizePlate(input.plate) : null;
  const q = await quote(input.kind, days, { vehicleType: input.vehicleType ?? null, roomType: input.roomType || null });
  const amount = input.amount ?? q.amount;
  const freeTransferDays = 4;

  return prisma.$transaction(async (tx) => {
    const client = await upsertClientByPhone(input.phone, { name: input.name || null, source: input.source }, tx);
    let vehicleId: string | null = null;
    if (input.kind === "PARKING" && input.vehicleType) {
      const existing = plate ? await tx.vehicle.findFirst({ where: { clientId: client.id, plate } }) : null;
      const v = existing ?? (await tx.vehicle.create({ data: { clientId: client.id, plate, type: input.vehicleType } }));
      vehicleId = v.id;
    }
    const booking = await tx.booking.create({
      data: {
        boardId: board.id,
        kind: input.kind,
        status: input.status,
        clientId: client.id,
        contactPhone: client.phone,
        contactName: input.name || client.name,
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
        transferNeeded: input.transferNeeded || (input.kind === "PARKING" && days >= freeTransferDays),
        comment: input.comment || null,
        createdById: actor?.id ?? null,
      },
    });
    await tx.interaction.create({
      data: {
        bookingId: booking.id,
        clientId: client.id,
        type: input.source === "SITE" ? "SITE_LEAD" : "COMMENT",
        channel: input.source === "SITE" ? "SITE" : input.source === "CALL" ? "PHONE" : null,
        direction: "IN",
        text: input.source === "SITE" ? "Заявка с сайта" : `Заявка создана вручную (${actor?.name ?? "система"})`,
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

export async function transition(bookingId: string, to: BookingStatus, actor: SessionUser, opts: { reason?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (!canTransition(b.status, to, actor)) {
      throw new BookingError(`Переход «${STATUS_LABEL[b.status]}» → «${STATUS_LABEL[to]}» недопустим`);
    }
    const now = new Date();
    const data: Prisma.BookingUpdateInput = { status: to };
    if (to === "CHECKED_IN") data.checkedInAt = now;
    if (to === "CHECKED_OUT") data.checkedOutAt = now;
    if (to === "CANCELLED") {
      data.cancelledAt = now;
      data.cancelReason = opts.reason ?? null;
    }
    if (to === "NO_SHOW") data.noShowAt = now;
    const updated = await tx.booking.update({ where: { id: bookingId }, data });
    await tx.interaction.create({
      data: {
        bookingId,
        clientId: b.clientId,
        type: "STATUS_CHANGE",
        text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL[to]}${opts.reason ? ` · ${opts.reason}` : ""}`,
        userId: actor.id,
        meta: { from: b.status, to },
      },
    });
    await audit(actor.id, "STATUS_CHANGE", "Booking", bookingId, { from: b.status, to }, tx);
    if (to === "CANCELLED" || to === "NO_SHOW") await cancelPendingOutbox(bookingId, tx);
    await onStatusChanged(updated, to, tx);
    return updated;
  });
}

async function cancelPendingOutbox(bookingId: string, tx: Prisma.TransactionClient) {
  await tx.outbox.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "CANCELLED" } });
}

export async function addPayment(
  input: { bookingId: string; kind: "PAYMENT" | "REFUND"; method: "CASH" | "CARD_TERMINAL" | "TRANSFER" | "ONLINE"; amount: number; note?: string },
  actor: SessionUser,
) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    await tx.payment.create({
      data: { bookingId: b.id, kind: input.kind, method: input.method, amount: input.amount, note: input.note || null, createdById: actor.id },
    });
    const delta = input.kind === "PAYMENT" ? input.amount : -input.amount;
    const paidAmount = Math.max(0, b.paidAmount + delta);
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
      updated = await tx.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
      await tx.interaction.create({
        data: { bookingId: b.id, clientId: b.clientId, type: "STATUS_CHANGE", text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL.CONFIRMED} (оплачено полностью)`, userId: actor.id, meta: { from: b.status, to: "CONFIRMED" } },
      });
      await onStatusChanged(updated, "CONFIRMED", tx);
    }
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
  },
  actor: SessionUser,
) {
  const days = daysBetweenIso(input.dateFrom, input.dateTo);
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
  client: { select: { id: true, name: true, phone: true, ltv: true, messenger: true, _count: { select: { bookings: true } } } },
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
