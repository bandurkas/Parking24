import "server-only";
import type { BookingStatus, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { toDate, addDays } from "@/server/lib/dates";
import { overstayOf, type OverstayCtx } from "./overstay";

// Строка табло «Сегодня» и экранов поля. Перенесено из today/page.tsx без изменений в логике (МФ-UI §5.4)
export type TodayRow = {
  id: string; number: number; status: BookingStatus; name: string | null; phone: string | null; plate: string | null; vehicleType: VehicleType | null;
  dateFrom: string; dateTo: string; timeFrom: string | null; timeTo: string | null; amount: number; paidAmount: number; transferNeeded: boolean;
  overstay: { days: number; shown: number; rate: number } | null;
};

export async function loadTodayRows(today: string, ctx: OverstayCtx): Promise<{ arrivals: TodayRow[]; departures: TodayRow[]; onSite: TodayRow[] }> {
  const t = toDate(today);
  const yesterday = toDate(addDays(today, -1));
  const sel = { id: true, number: true, kind: true, days: true, status: true, contactName: true, contactPhone: true, plate: true, vehicleType: true, dateFrom: true, dateTo: true, timeFrom: true, timeTo: true, amount: true, paidAmount: true, transferNeeded: true, client: { select: { name: true } } } as const;
  const map = (b: { id: string; number: number; kind: string; days: number; status: TodayRow["status"]; contactName: string | null; contactPhone: string | null; plate: string | null; vehicleType: TodayRow["vehicleType"]; dateFrom: Date; dateTo: Date; timeFrom: string | null; timeTo: string | null; amount: number; paidAmount: number; transferNeeded: boolean; client: { name: string | null } | null }): TodayRow => ({
    id: b.id, number: b.number, status: b.status, name: b.contactName ?? b.client?.name ?? null, phone: b.contactPhone, plate: b.plate, vehicleType: b.vehicleType,
    dateFrom: b.dateFrom.toISOString().slice(0, 10), dateTo: b.dateTo.toISOString().slice(0, 10), timeFrom: b.timeFrom, timeTo: b.timeTo, amount: b.amount, paidAmount: b.paidAmount, transferNeeded: b.transferNeeded,
    overstay: (() => {
      const o = overstayOf(b, ctx);
      return o ? { days: o.days, shown: o.shown, rate: o.rate } : null;
    })(),
  });
  const [arr, dep, onSite] = await Promise.all([
    prisma.booking.findMany({ where: { kind: "PARKING", dateFrom: { gte: yesterday, lte: t }, status: { in: ["NEW", "AWAITING_PAYMENT", "CONFIRMED"] } }, select: sel, orderBy: [{ dateFrom: "asc" }, { timeFrom: "asc" }] }),
    prisma.booking.findMany({ where: { kind: "PARKING", dateTo: { lte: t }, status: "CHECKED_IN" }, select: sel, orderBy: [{ dateTo: "asc" }, { timeTo: "asc" }] }),
    prisma.booking.findMany({ where: { kind: "PARKING", status: "CHECKED_IN", dateTo: { gt: t } }, select: sel, orderBy: { dateTo: "asc" } }),
  ]);
  return { arrivals: arr.map(map), departures: dep.map(map), onSite: onSite.map(map) };
}
