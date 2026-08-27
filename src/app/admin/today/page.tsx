import type { Metadata } from "next";
import { requireUser } from "@/server/auth/guard";
import { prisma } from "@/server/db/prisma";
import { todayIso, toDate, addDays } from "@/server/lib/dates";
import { occupancyToday } from "@/server/services/occupancy";
import AdminShell from "@/components/admin/AdminShell";
import TodayBoard, { type TodayRow } from "@/components/admin/today/TodayBoard";
import GuardScreen from "@/components/admin/today/GuardScreen";

export const metadata: Metadata = { title: "Сегодня · Паркинг 24", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function loadRows(today: string): Promise<{ arrivals: TodayRow[]; departures: TodayRow[]; onSite: TodayRow[] }> {
  const t = toDate(today);
  const yesterday = toDate(addDays(today, -1));
  const sel = { id: true, number: true, status: true, contactName: true, contactPhone: true, plate: true, vehicleType: true, dateFrom: true, dateTo: true, timeFrom: true, timeTo: true, amount: true, paidAmount: true, transferNeeded: true, client: { select: { name: true } } } as const;
  const map = (b: { id: string; number: number; status: TodayRow["status"]; contactName: string | null; contactPhone: string | null; plate: string | null; vehicleType: TodayRow["vehicleType"]; dateFrom: Date; dateTo: Date; timeFrom: string | null; timeTo: string | null; amount: number; paidAmount: number; transferNeeded: boolean; client: { name: string | null } | null }): TodayRow => ({
    id: b.id, number: b.number, status: b.status, name: b.contactName ?? b.client?.name ?? null, phone: b.contactPhone, plate: b.plate, vehicleType: b.vehicleType,
    dateFrom: b.dateFrom.toISOString().slice(0, 10), dateTo: b.dateTo.toISOString().slice(0, 10), timeFrom: b.timeFrom, timeTo: b.timeTo, amount: b.amount, paidAmount: b.paidAmount, transferNeeded: b.transferNeeded,
  });
  const [arr, dep, onSite] = await Promise.all([
    prisma.booking.findMany({ where: { kind: "PARKING", dateFrom: { gte: yesterday, lte: t }, status: { in: ["NEW", "AWAITING_PAYMENT", "CONFIRMED"] } }, select: sel, orderBy: [{ dateFrom: "asc" }, { timeFrom: "asc" }] }),
    prisma.booking.findMany({ where: { kind: "PARKING", dateTo: { lte: t }, status: "CHECKED_IN" }, select: sel, orderBy: [{ dateTo: "asc" }, { timeTo: "asc" }] }),
    prisma.booking.findMany({ where: { kind: "PARKING", status: "CHECKED_IN", dateTo: { gt: t } }, select: sel, orderBy: { dateTo: "asc" } }),
  ]);
  return { arrivals: arr.map(map), departures: dep.map(map), onSite: onSite.map(map) };
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ guard?: string }> }) {
  const user = await requireUser();
  const { guard } = await searchParams;
  const today = todayIso();
  const [rows, occ] = await Promise.all([loadRows(today), occupancyToday(today)]);

  if (user.role === "GUARD" || guard === "1") {
    return <GuardScreen today={today} rows={rows} user={user} />;
  }
  return (
    <AdminShell user={user}>
      <TodayBoard today={today} rows={rows} occupancy={occ} role={user.role} />
    </AdminShell>
  );
}
