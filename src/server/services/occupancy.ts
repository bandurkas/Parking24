import "server-only";
import type { ResourceKind, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { addDays, daysBetweenIso, toDate, toIso } from "@/server/lib/dates";
import { POOL_TYPES, loadByDay, peakLoad, type Span } from "@/lib/occupancy-math";
import { parkingSettings } from "./settings";

const ACTIVE = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"] as const;

export type DayOccupancy = { date: string; busy: number; capacity: number; free: number; overbooked: boolean };

export async function capacityFor(kind: ResourceKind, vehicleType?: VehicleType | null, roomType?: string | null): Promise<number> {
  const rows = await prisma.capacityConfig.findMany({
    where: { kind, ...(kind === "PARKING" ? { vehicleType: vehicleType ?? undefined } : { roomType: roomType ?? undefined }) },
  });
  return rows.reduce((s, r) => s + r.capacity, 0);
}

// Занятость по дням в диапазоне [from, to) для типа ТС / комнаты.
// Парковка занимает место и в день выезда (сутки считаются включительно), комната — до дня выезда.
export async function occupancy(kind: ResourceKind, from: string, to: string, opts: { vehicleType?: VehicleType | null; roomType?: string | null; excludeBookingId?: string } = {}): Promise<DayOccupancy[]> {
  const capacity = await capacityFor(kind, opts.vehicleType, opts.roomType);
  const bookings = await prisma.booking.findMany({
    where: {
      kind,
      status: { in: [...ACTIVE] },
      dateFrom: { lt: toDate(to) },
      dateTo: kind === "PARKING" ? { gte: toDate(from) } : { gt: toDate(from) },
      ...(kind === "PARKING" && opts.vehicleType ? { vehicleType: opts.vehicleType } : {}),
      ...(kind === "ROOM" && opts.roomType ? { roomType: opts.roomType } : {}),
      ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
    },
    select: { dateFrom: true, dateTo: true },
  });
  const n = Math.max(1, daysBetweenIso(from, to));
  const out: DayOccupancy[] = [];
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i);
    const t = toDate(day).getTime();
    const busy = bookings.filter((b) => b.dateFrom.getTime() <= t && (kind === "PARKING" ? b.dateTo.getTime() >= t : b.dateTo.getTime() > t)).length;
    out.push({ date: day, busy, capacity, free: Math.max(0, capacity - busy), overbooked: capacity > 0 && busy >= capacity });
  }
  return out;
}

export async function occupancySummary(kind: ResourceKind, from: string, to: string, opts: { vehicleType?: VehicleType | null; roomType?: string | null; excludeBookingId?: string } = {}) {
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

// Брони пула, пересекающие отрезок [from, to] включительно.
async function poolSpans(pool: PoolKind, from: string, to: string, excludeBookingId?: string): Promise<Span[]> {
  const rows = await prisma.booking.findMany({
    where: {
      kind: "PARKING",
      status: { in: [...ACTIVE] },
      dateFrom: { lte: toDate(to) },
      dateTo: { gte: toDate(from) },
      ...poolWhere(pool),
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    select: { dateFrom: true, dateTo: true },
  });
  return rows.map((b) => ({ dateFrom: toIso(b.dateFrom), dateTo: toIso(b.dateTo) }));
}

export async function poolCapacity(pool: PoolKind): Promise<number> {
  const s = await parkingSettings();
  return pool === "TRUCK" ? s.capacityTruck : s.capacityTotal;
}

// Пик занятости пула на отрезке брони и свободный минимум.
export async function poolLoad(pool: PoolKind, from: string, to: string, excludeBookingId?: string) {
  const [spans, capacity] = await Promise.all([poolSpans(pool, from, to, excludeBookingId), poolCapacity(pool)]);
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
    // плановые выезды в ближайшие 24 часа среди стоящих
    prisma.booking.count({ where: { kind: "PARKING", status: "CHECKED_IN", dateTo: { gte: t, lte: tomorrow } } }),
    // места, занятые бронями на сегодня (включая ещё не заехавших) — из них считается свободное
    prisma.booking.count({ where: { kind: "PARKING", status: { in: [...ACTIVE] }, dateFrom: { lte: t }, dateTo: { gte: t } } }),
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

// Сводка на дату по всем типам ТС (для полосы занятости)
export async function occupancyToday(date: string) {
  const types: VehicleType[] = ["CAR", "SUV", "MOTO", "TRUCK"];
  const caps = await prisma.capacityConfig.findMany({ where: { kind: "PARKING" } });
  const t = toDate(date);
  const busyRows = await prisma.booking.groupBy({
    by: ["vehicleType"],
    where: { kind: "PARKING", status: { in: ["CONFIRMED", "CHECKED_IN"] }, dateFrom: { lte: t }, dateTo: { gte: t } },
    _count: { _all: true },
  });
  return types.map((vt) => {
    const capacity = caps.filter((c) => c.vehicleType === vt).reduce((s, c) => s + c.capacity, 0);
    const busy = busyRows.find((r) => r.vehicleType === vt)?._count._all ?? 0;
    return { vehicleType: vt, capacity, busy, free: Math.max(0, capacity - busy) };
  });
}
