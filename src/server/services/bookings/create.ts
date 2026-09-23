import "server-only";
import type { BookingStatus, Channel, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePlate } from "@/lib/phone";
import type { SessionUser } from "@/server/auth/session";
import { bookingDays, toDate } from "@/server/lib/dates";
import { FREE_TRANSFER_MIN_DAYS } from "@/lib/tariffs";
import { upsertClientByPhone } from "../clients";
import { quote } from "../pricing";
import { audit } from "../audit";
import { onStatusChanged } from "@/server/automations/dispatcher";
import type { CreateBookingInput } from "@/server/validation/booking";
import { BookingError } from "./shared";

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
