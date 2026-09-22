import "server-only";
import type { BookingStatus, Prisma, ResourceKind, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { addDays, daysBetweenIso, toDate, toIso, todayIso } from "@/server/lib/dates";
import { POOL_TYPES, effectiveSpan, loadByDay, peakLoad, type Span } from "@/lib/occupancy-math";
import { parkingSettings } from "./settings";

const ACTIVE: readonly BookingStatus[] = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"];

// Брони парковки, которые могут занимать место на [from, to] (docs/phases/PHASE_02_OVERSTAY.md §4.1):
// «Заехал» — всегда (машина стоит; ранний заезд и перестой), остальные — по датам. Лишнее отсеивает effectiveSpan.
// Для одного дня — сегодняшнего — условие точное: сегодня любая «Заехал» занимает место.
export function occupiesWhere(from: string, to: string, statuses: readonly BookingStatus[] = ACTIVE): Prisma.BookingWhereInput {
  const dated = statuses.filter((s) => s !== "CHECKED_IN");
  const or: Prisma.BookingWhereInput[] = [];
  if (statuses.includes("CHECKED_IN")) or.push({ status: "CHECKED_IN" });
  if (dated.length) or.push({ status: { in: dated }, dateFrom: { lte: toDate(to) }, dateTo: { gte: toDate(from) } });
  return { OR: or };
}

function spanOf(b: { status: BookingStatus; dateFrom: Date; dateTo: Date }, today: string): Span {
  return effectiveSpan({ status: b.status, dateFrom: toIso(b.dateFrom), dateTo: toIso(b.dateTo) }, today);
}

export type DayOccupancy = { date: string; busy: number; capacity: number; free: number; overbooked: boolean };

export async function capacityFor(kind: ResourceKind, vehicleType?: VehicleType | null, roomType?: string | null): Promise<number> {
  const rows = await prisma.capacityConfig.findMany({
    where: { kind, ...(kind === "PARKING" ? { vehicleType: vehicleType ?? undefined } : { roomType: roomType ?? undefined }) },
  });
  return rows.reduce((s, r) => s + r.capacity, 0);
}

type OccupancyOpts = { vehicleType?: VehicleType | null; roomType?: string | null; excludeBookingId?: string; today?: string };

// Занятость по дням в диапазоне [from, to) для типа ТС / комнаты.
// Парковка занимает место и в день выезда (сутки считаются включительно), комната — до дня выезда.
export async function occupancy(kind: ResourceKind, from: string, to: string, opts: OccupancyOpts = {}): Promise<DayOccupancy[]> {
  const capacity = await capacityFor(kind, opts.vehicleType, opts.roomType);
  const n = Math.max(1, daysBetweenIso(from, to));
  const days = Array.from({ length: n }, (_, i) => addDays(from, i));
  let busyOn: (day: string) => number;
  if (kind === "PARKING") {
    const today = opts.today ?? todayIso();
    const rows = await prisma.booking.findMany({
      where: {
        kind,
        ...occupiesWhere(from, days[days.length - 1]),
        ...(opts.vehicleType ? { vehicleType: opts.vehicleType } : {}),
        ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
      },
      select: { status: true, dateFrom: true, dateTo: true },
    });
    const spans = rows.map((b) => spanOf(b, today));
    busyOn = (day) => spans.filter((s) => s.dateFrom <= day && s.dateTo >= day).length;
  } else {
    const rows = await prisma.booking.findMany({
      where: {
        kind,
        status: { in: [...ACTIVE] },
        dateFrom: { lt: toDate(to) },
        dateTo: { gt: toDate(from) },
        ...(opts.roomType ? { roomType: opts.roomType } : {}),
        ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
      },
      select: { dateFrom: true, dateTo: true },
    });
    busyOn = (day) => {
      const t = toDate(day).getTime();
      return rows.filter((b) => b.dateFrom.getTime() <= t && b.dateTo.getTime() > t).length;
    };
  }
  return days.map((day) => {
    const busy = busyOn(day);
    return { date: day, busy, capacity, free: Math.max(0, capacity - busy), overbooked: capacity > 0 && busy >= capacity };
  });
}

export async function occupancySummary(kind: ResourceKind, from: string, to: string, opts: OccupancyOpts = {}) {
  const days = await occupancy(kind, from, kind === "PARKING" ? addDays(to, 1) : to, opts);
  const minFree = Math.min(...days.map((d) => d.free));
  const capacity = days[0]?.capacity ?? 0;
  return { capacity, minFree, overbooked: days.some((d) => d.overbooked), days };
}

// ── Общий пул мест (ТЗ 21.09, п. 4; решение пользователя 22.09) ──────────────────────
// Легковые, кроссоверы и мото делят 405 мест; грузовые считаются отдельно (10 мест).
// Место занимают брони в статусах «Ожидает оплаты», «Подтверждена» и «Заехал» — см. ACTIVE.

type PoolKind = "POOL" | "TRUCK";

function poolWhere(pool: PoolKind) {
  return pool === "TRUCK" ? { vehicleType: "TRUCK" as const } : { vehicleType: { in: [...POOL_TYPES] } };
}

// Отрезки броней пула для [from, to] включительно — одно правило для страниц и автоподтверждения.
// db — транзакция автоподтверждения (под блокировкой занятости) или основной клиент.
export async function poolSpans(db: Pick<Prisma.TransactionClient, "booking">, pool: PoolKind, from: string, to: string, today: string, excludeBookingId?: string): Promise<Span[]> {
  const rows = await db.booking.findMany({
    where: {
      kind: "PARKING",
      ...occupiesWhere(from, to),
      ...poolWhere(pool),
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    select: { status: true, dateFrom: true, dateTo: true },
  });
  return rows.map((b) => spanOf(b, today));
}

export async function poolCapacity(pool: PoolKind): Promise<number> {
  const s = await parkingSettings();
  return pool === "TRUCK" ? s.capacityTruck : s.capacityTotal;
}

// Пик занятости пула на отрезке брони и свободный минимум.
export async function poolLoad(pool: PoolKind, from: string, to: string, excludeBookingId?: string, today = todayIso()) {
  const [spans, capacity] = await Promise.all([poolSpans(prisma, pool, from, to, today, excludeBookingId), poolCapacity(pool)]);
  const peak = peakLoad(spans, from, to);
  return { peak, capacity, minFree: Math.max(0, capacity - peak), days: loadByDay(spans, from, to) };
}

// Пять показателей общей панели (ТЗ п. 4.2). «На парковке» — только фактически заехавшие.
export async function parkingDashboard(today: string) {
  const t = toDate(today);
  const tomorrow = toDate(addDays(today, 1));
  const [settings, onSite, arrivals, departures, heldNow] = await Promise.all([
    parkingSettings(),
    prisma.booking.count({ where: { kind: "PARKING", status: "CHECKED_IN" } }),
    // заезды в ближайшие 24 часа: подтверждённые и ждущие оплаты, которые ещё не заехали
    prisma.booking.count({ where: { kind: "PARKING", status: { in: ["AWAITING_PAYMENT", "CONFIRMED"] }, dateFrom: { gte: t, lte: tomorrow } } }),
    // плановые выезды в ближайшие 24 часа среди стоящих, вместе с перестоем
    prisma.booking.count({ where: { kind: "PARKING", status: "CHECKED_IN", dateTo: { lte: tomorrow } } }),
    // места, занятые на сегодня (включая ещё не заехавших и перестой) — из них считается свободное
    prisma.booking.count({ where: { kind: "PARKING", ...occupiesWhere(today, today) } }),
  ]);
  const capacity = settings.capacityTotal + settings.capacityTruck;
  return {
    onSite,
    arrivals,
    departures,
    held: heldNow,
    freeNow: Math.max(0, capacity - heldNow),
    capacity,
    capacityPool: settings.capacityTotal,
    capacityTruck: settings.capacityTruck,
    autoConfirm: settings.autoConfirm,
    autoConfirmLimit: settings.autoConfirmLimit,
  };
}

// Сводка на сегодня по всем типам ТС (для полосы занятости). Статусы — как были; «Заехал» — с перестоем и ранним заездом.
// Условие точное только для сегодняшнего дня.
export async function occupancyToday(today: string) {
  const types: VehicleType[] = ["CAR", "SUV", "MOTO", "TRUCK"];
  const caps = await prisma.capacityConfig.findMany({ where: { kind: "PARKING" } });
  const busyRows = await prisma.booking.groupBy({
    by: ["vehicleType"],
    where: { kind: "PARKING", ...occupiesWhere(today, today, ["CONFIRMED", "CHECKED_IN"]) },
    _count: { _all: true },
  });
  return types.map((vt) => {
    const capacity = caps.filter((c) => c.vehicleType === vt).reduce((s, c) => s + c.capacity, 0);
    const busy = busyRows.find((r) => r.vehicleType === vt)?._count._all ?? 0;
    return { vehicleType: vt, capacity, busy, free: Math.max(0, capacity - busy) };
  });
}
