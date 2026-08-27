import "server-only";
import type { ResourceKind, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { addDays, daysBetweenIso, toDate } from "@/server/lib/dates";

const ACTIVE = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"] as const;

export type DayOccupancy = { date: string; busy: number; capacity: number; free: number; overbooked: boolean };

export async function capacityFor(kind: ResourceKind, vehicleType?: VehicleType | null, roomType?: string | null): Promise<number> {
  const rows = await prisma.capacityConfig.findMany({
    where: { kind, ...(kind === "PARKING" ? { vehicleType: vehicleType ?? undefined } : { roomType: roomType ?? undefined }) },
  });
  return rows.reduce((s, r) => s + r.capacity, 0);
}

// Занятость по дням в диапазоне [from, to) для типа ТС / комнаты
export async function occupancy(kind: ResourceKind, from: string, to: string, opts: { vehicleType?: VehicleType | null; roomType?: string | null; excludeBookingId?: string } = {}): Promise<DayOccupancy[]> {
  const capacity = await capacityFor(kind, opts.vehicleType, opts.roomType);
  const bookings = await prisma.booking.findMany({
    where: {
      kind,
      status: { in: [...ACTIVE] },
      dateFrom: { lt: toDate(to) },
      dateTo: { gt: toDate(from) },
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
    const busy = bookings.filter((b) => b.dateFrom.getTime() <= t && b.dateTo.getTime() > t).length;
    out.push({ date: day, busy, capacity, free: Math.max(0, capacity - busy), overbooked: capacity > 0 && busy >= capacity });
  }
  return out;
}

export async function occupancySummary(kind: ResourceKind, from: string, to: string, opts: { vehicleType?: VehicleType | null; roomType?: string | null; excludeBookingId?: string } = {}) {
  const days = await occupancy(kind, from, to, opts);
  const minFree = Math.min(...days.map((d) => d.free));
  const capacity = days[0]?.capacity ?? 0;
  return { capacity, minFree, overbooked: days.some((d) => d.overbooked), days };
}

// Сводка на дату по всем типам ТС (для полосы занятости)
export async function occupancyToday(date: string) {
  const types: VehicleType[] = ["CAR", "SUV", "MOTO", "TRUCK"];
  const caps = await prisma.capacityConfig.findMany({ where: { kind: "PARKING" } });
  const t = toDate(date);
  const busyRows = await prisma.booking.groupBy({
    by: ["vehicleType"],
    where: { kind: "PARKING", status: { in: ["CONFIRMED", "CHECKED_IN"] }, dateFrom: { lte: t }, dateTo: { gt: t } },
    _count: { _all: true },
  });
  return types.map((vt) => {
    const capacity = caps.filter((c) => c.vehicleType === vt).reduce((s, c) => s + c.capacity, 0);
    const busy = busyRows.find((r) => r.vehicleType === vt)?._count._all ?? 0;
    return { vehicleType: vt, capacity, busy, free: Math.max(0, capacity - busy) };
  });
}
