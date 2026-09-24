import "server-only";
import type { Prisma } from "@prisma/client";
import type { Scan } from "../tick-core";
import { overstayDayIso, toDate, toIso } from "@/server/lib/dates";
import { overstayCloseWhere, overstayFeedText, overstayKey, overstayNoticeText, planOverstay } from "@/lib/overstay";

type Tx = Prisma.TransactionClient;

const LIMIT = 50;

// Перестой (docs/phases/PHASE_02_OVERSTAY.md §4.6): уведомление администратору один раз на бронь и дату выезда,
// строка в ленте брони; решённый перестой (выехал, продлили, исправили статус) закрывает своё уведомление сам.
// Основной prisma и notify() сюда не импортируются: скан работает в транзакции клиента планировщика
export const overstayScan: Scan<Tx> = {
  code: "overstay",
  async run(tx, now) {
    const day = overstayDayIso(now); // сутки перестоя — с 01:00 по Москве, как на экранах
    const rows = (
      await tx.booking.findMany({
        where: { kind: "PARKING", status: "CHECKED_IN", dateTo: { lt: toDate(day) } },
        select: { id: true, number: true, plate: true, dateTo: true, clientId: true },
      })
    ).map((b) => ({ ...b, dateTo: toIso(b.dateTo) }));
    const keys = rows.map((r) => overstayKey(r.id, r.dateTo));

    const known = keys.length
      ? (await tx.adminNotice.findMany({ where: { dedupKey: { in: keys } }, select: { dedupKey: true } })).map((n) => n.dedupKey as string)
      : [];
    const fresh = planOverstay(rows, known, LIMIT);

    let created = 0;
    if (fresh.length) {
      const inserted = await tx.adminNotice.createManyAndReturn({
        data: fresh.map((b) => ({ kind: "OVERSTAY" as const, bookingId: b.id, text: overstayNoticeText(b), dedupKey: overstayKey(b.id, b.dateTo) })),
        skipDuplicates: true,
        select: { bookingId: true },
      });
      const ids = new Set(inserted.map((n) => n.bookingId));
      const done = fresh.filter((b) => ids.has(b.id));
      // Системная запись: автор не человек
      if (done.length) await tx.interaction.createMany({ data: done.map((b) => ({ bookingId: b.id, clientId: b.clientId, type: "SYSTEM" as const, text: overstayFeedText(b.dateTo), userId: null, meta: { overstayNotice: overstayKey(b.id, b.dateTo) } })) });
      created = done.length;
    }

    await tx.adminNotice.updateMany({ where: overstayCloseWhere(keys), data: { readAt: now, readById: null } });
    return created;
  },
};
