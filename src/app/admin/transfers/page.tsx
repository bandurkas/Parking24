import type { Metadata } from "next";
import { requireUser } from "@/server/auth/guard";
import { overstayCtx } from "@/server/services/overstay";
import { loadTodayRows } from "@/server/services/today";
import TransferScreen, { type TransferRow } from "@/components/admin/field/TransferScreen";

export const metadata: Metadata = { title: "Трансферы · Паркинг 24", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const user = await requireUser(["DRIVER"]);
  const ctx = await overstayCtx();
  const rows = await loadTodayRows(ctx.today, ctx);
  // Клиенту — только безопасные поля: без телефона и сумм (решение 24.09 п. 6)
  const transfers: TransferRow[] = rows.arrivals
    .filter((r) => r.transferNeeded)
    .map((r) => ({ id: r.id, name: r.name, plate: r.plate, dateFrom: r.dateFrom, timeFrom: r.timeFrom }));
  return <TransferScreen today={ctx.today} userName={user.name} rows={transfers} />;
}
