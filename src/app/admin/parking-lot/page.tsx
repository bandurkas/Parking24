import type { Metadata } from "next";
import { requireUser } from "@/server/auth/guard";
import { overstayCtx } from "@/server/services/overstay";
import { loadTodayRows } from "@/server/services/today";
import { myShiftState } from "@/server/services/staff";
import MyShift from "@/components/admin/staff/MyShift";
import ParkingLotScreen, { type LotArrival, type LotExit } from "@/components/admin/field/ParkingLotScreen";

export const metadata: Metadata = { title: "Машины · Паркинг 24", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ParkingLotPage() {
  const user = await requireUser(["PARKER"]);
  const ctx = await overstayCtx();
  const [rows, my] = await Promise.all([loadTodayRows(ctx.today, ctx), myShiftState(user)]);
  // Клиенту — только безопасные поля: без сумм, телефона и денег перестоя (решение 24.09 п. 6)
  const exits: LotExit[] = [...rows.departures, ...rows.onSite].map((r) => ({ id: r.id, plate: r.plate, vehicleType: r.vehicleType, dateTo: r.dateTo, overstayDays: r.overstay?.days ?? null }));
  const expected: LotArrival[] = rows.arrivals.map((r) => ({ id: r.id, plate: r.plate, vehicleType: r.vehicleType, dateFrom: r.dateFrom, timeFrom: r.timeFrom }));
  return <ParkingLotScreen today={ctx.today} userName={user.name} exits={exits} expected={expected} shift={<MyShift state={my} variant="dark" />} />;
}
