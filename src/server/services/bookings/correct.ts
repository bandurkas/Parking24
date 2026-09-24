import "server-only";
import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { STATUS_LABEL } from "@/lib/crm/labels";
import type { SessionUser } from "@/server/auth/session";
import { actualParkingDays, fmtDate, moscowIso, overstayDayIso, plannedMoment, toDate, toIso, todayIso } from "@/server/lib/dates";
import { chargeUntil, overstayDays, rub } from "@/lib/overstay";
import { checkCorrection, CLOSED_STATUSES, STATUS_RANK } from "@/lib/correction";
import { billableDays } from "@/lib/recalc";
import { parkingTariffs } from "../pricing";
import { audit } from "../audit";
import { statusCheck, takesSpace } from "@/lib/capacity";
import { lockOccupancy } from "../autoconfirm";
import { BookingError, guardCapacity, lockBooking, nextContractNumber, noteOverCapacity, rejectClearedLine, stayOf } from "./shared";

// Исправление ошибки: любой статус → любой, причина обязательна, автоматизации не запускаются,
// запланированные сообщения по ошибочному статусу отменяются. Забытая отметка — датой без времени (решение 23.09)
export async function correctStatus(bookingId: string, to: BookingStatus, reason: string, actor: SessionUser, dates: { in?: string; out?: string } = {}, opts: { overCapacity?: boolean } = {}) {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") throw new BookingError("Исправлять статус может только администратор");
  const why = reason.trim();
  if (why.length < 3) throw new BookingError("Укажите причину исправления");
  return prisma.$transaction(async (tx) => {
    // Потолок мест (Ф3): общая блокировка занятости — первой, до строки брони
    const { kind } = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { kind: true } });
    if (kind === "PARKING" && takesSpace(to)) await lockOccupancy(tx);
    await lockBooking(tx, bookingId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status === to) throw new BookingError("Бронь уже в этом статусе");
    // Закрытые брони уже могли попасть в отчёт (DECISIONS §2)
    if (CLOSED_STATUSES.includes(b.status) && actor.role !== "OWNER") throw new BookingError("Исправить статус закрытой брони может только владелец");
    const saved = { in: b.checkedInAt ? moscowIso(b.checkedInAt) : null, out: b.checkedOutAt ? moscowIso(b.checkedOutAt) : null };
    const { need, error } = checkCorrection(to, saved, dates, todayIso(), moscowIso(b.createdAt));
    if (error) throw new BookingError(error);
    // Исправление в «Ожидает оплаты»/«Подтверждена» из статуса без места — как подтверждение; в «Заехал» — только запись (как кнопкой)
    const mode = b.kind === "PARKING" ? statusCheck(b.status, to, toIso(b.dateFrom), todayIso()) : null;
    const over = mode ? await guardCapacity(tx, { id: b.id, kind: b.kind, vehicleType: b.vehicleType, dateFrom: toIso(b.dateFrom), dateTo: toIso(b.dateTo) }, mode, actor, { override: opts.overCapacity }) : null;
    const data: Prisma.BookingUpdateInput = { status: to };
    if (STATUS_RANK[to] < 3) { data.checkedInAt = null; data.checkedInDateOnly = false; }
    if (STATUS_RANK[to] < 4) { data.checkedOutAt = null; data.checkedOutDateOnly = false; }
    // Сутки и решение по пересчёту принадлежат снятому выезду: иначе баннер «Стоянка по факту» всплывёт
    // (или не всплывёт) у следующего выезда по чужим данным. «Выехал» → «Отменена» — тоже выход из выезда
    if (STATUS_RANK[to] < 4 || b.status === "CHECKED_OUT") { data.actualDays = null; data.recalcDecidedAt = null; }
    if (to !== "CANCELLED") { data.cancelledAt = null; data.cancelReason = null; }
    if (to !== "NO_SHOW") data.noShowAt = null;
    // Отметки отклонения не стираются (Ф10 Р12): отчёт Ф12 за прошлый период не меняется задним числом
    if (to === "REJECTED") { data.rejectedAt = new Date(); data.rejectKind = "OTHER"; data.rejectReason = why; data.rejectClearedAt = null; }
    else if (b.status === "REJECTED") data.rejectClearedAt = new Date();
    if (to === "CANCELLED") { data.cancelledAt = new Date(); data.cancelReason = why; }
    if (to === "NO_SHOW") data.noShowAt = new Date();
    // Дата без времени хранится как 12:00 по Москве: календарный день не уезжает ни в UTC, ни в льготный час до 01:00
    if (need.in) { data.checkedInAt = plannedMoment(dates.in!); data.checkedInDateOnly = true; }
    if (need.out) { data.checkedOutAt = plannedMoment(dates.out!); data.checkedOutDateOnly = true; }
    // Сутки по отметкам (Р7): баннер — только при досрочном выезде, и пересчёт по датам делает владелец (decideRecalc).
    // Доплату за ранний заезд и перестой исправление не начисляет — путь для забытой отметки (решение 22.09)
    if (to === "CHECKED_OUT") {
      const inAt = need.in ? plannedMoment(dates.in!) : b.checkedInAt;
      const outAt = need.out ? plannedMoment(dates.out!) : b.checkedOutAt;
      if (b.kind === "PARKING" && inAt && outAt) {
        const fact = actualParkingDays(inAt, outAt, toIso(b.dateTo));
        const bill = billableDays({ kind: b.kind, dateFrom: toIso(b.dateFrom), inDate: moscowIso(inAt), actualDays: fact });
        data.actualDays = fact;
        data.recalcDecidedAt = bill < b.days ? null : new Date();
      } else data.actualDays = null;
    }
    // Забытый заезд: бумажный договор подписан — номер выдаём, как при обычном заезде (Ф5 Р8). Сообщение клиенту
    // исправление не шлёт. Обратное исправление номер не снимает: он уже на бумаге у клиента
    const contract = to === "CHECKED_IN" && b.kind === "PARKING" && b.contractNumber == null ? await nextContractNumber(tx) : null;
    if (contract) data.contractNumber = contract;
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
        meta: { from: b.status, to, correction: true, reason: why, ...applied, ...(contract ? { contract } : {}) },
      },
    });
    await audit(actor.id, "STATUS_CHANGE", "Booking", bookingId, { from: b.status, to, correction: true, reason: why, ...applied, ...(contract ? { contract } : {}) }, tx);
    const system = (text: string) => tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "SYSTEM", text, userId: actor.id } });
    // Выход из «Выехал» (владелец, Р8): деньги по выезду уже посчитаны и не откатываются — это видно в ленте
    if (b.status === "CHECKED_OUT") {
      const charge = b.overstayCharge ? ` и начисление за перестой ${rub(b.overstayCharge)}` : "";
      await system(STATUS_RANK[to] < 4
        ? `Бронь открыта заново: сумма ${rub(b.amount)}${charge ? `${charge} остаются — при повторном выезде начислятся только новые сутки` : " остаётся"}`
        : `Сумма ${rub(b.amount)}${charge} после выезда не ${charge ? "пересчитываются" : "пересчитывается"}`);
    }
    if (b.status === "REJECTED") await system(rejectClearedLine(b));
    if (over) await noteOverCapacity(tx, b, over, mode === "checkin" ? "soft" : "override", mode === "checkin" ? "Заезд" : `Исправление ${STATUS_LABEL[b.status]} → ${STATUS_LABEL[to]}`, actor);
    // Исправление в «Выехал» перестой не начисляет (путь для забытого выезда) — но это видно в ленте,
    // и сутки считаются по введённой дате выезда, из любого исходного статуса
    if (to === "CHECKED_OUT" && need.out) {
      const c = chargeUntil(stayOf(b), dates.out!, await parkingTariffs(tx));
      if (c) {
        const sum = c.rate > 0 ? ` (${rub(c.extra * c.rate)})` : "";
        await system(`Перестой ${c.extra} сут. не начислен${sum} · по дате выезда ${day(dates.out!)} · ${why}`);
      }
    }
    // Машина в перестое, а бронь исправляют не в «Выехал» (там своя строка по дате выезда) — начисления нет, и это видно (бэклог СП).
    // Любой исходящий статус, иначе строку обходят через «Подтверждена»
    if (to !== "CHECKED_OUT" && overstayDays({ kind: b.kind, status: b.status, dateTo: toIso(b.dateTo) }, overstayDayIso()) > 0) {
      const c = chargeUntil(stayOf(b), overstayDayIso(), await parkingTariffs(tx));
      if (c) {
        const sum = c.rate > 0 ? ` (${rub(c.extra * c.rate)})` : "";
        await system(`Перестой ${c.extra} сут. не начислен${sum} · исправление в «${STATUS_LABEL[to]}» · ${why}`);
      }
    }
    const cancelled = await tx.outbox.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (cancelled.count > 0) {
      await tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "SYSTEM", text: `Отменено запланированных сообщений: ${cancelled.count}`, userId: actor.id } });
    }
    return updated;
  });
}
