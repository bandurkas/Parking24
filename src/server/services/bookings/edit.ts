import "server-only";
import type { Booking } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePlate } from "@/lib/phone";
import type { SessionUser } from "@/server/auth/session";
import { bookingDays, fmtDate, overstayDayIso, toDate, toIso, todayIso } from "@/server/lib/dates";
import { chargeLeft, chargeUntil, overstayDays } from "@/lib/overstay";
import { parkingTariffs } from "../pricing";
import { audit } from "../audit";
import { assertMoneyEditable, BookingError, chargeLine, lockBooking, stayOf } from "./shared";

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
