import type { Metadata } from "next";
import { ALL, requireUser } from "@/server/auth/guard";
import { parkingToday } from "@/server/services/occupancy";
import { overstayCtx } from "@/server/services/overstay";
import { loadTodayRows } from "@/server/services/today";
import { openShiftBrief } from "@/server/services/cash";
import AdminShell from "@/components/admin/AdminShell";
import TodayBoard from "@/components/admin/today/TodayBoard";
import GuardScreen from "@/components/admin/today/GuardScreen";

export const metadata: Metadata = { title: "Сегодня · Паркинг 24", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ guard?: string }> }) {
  const user = await requireUser(ALL); // OWNER/ADMIN — табло, GUARD — КПП; полевые роли уходят на свой экран (МФ-UI §5.3)
  const { guard } = await searchParams;
  const ctx = await overstayCtx();
  const today = ctx.today;
  const [rows, occ] = await Promise.all([loadTodayRows(today, ctx), parkingToday()]);

  if (user.role === "GUARD" || guard === "1") {
    // Администратор и владелец на экране КПП: при выходе то же напоминание о незакрытой кассовой смене (Ф11)
    const shift = user.role === "GUARD" ? null : await openShiftBrief();
    return <GuardScreen today={today} rows={rows} user={user} shift={shift} />;
  }
  return (
    <AdminShell user={user}>
      <TodayBoard today={today} rows={rows} occupancy={occ} role={user.role} />
    </AdminShell>
  );
}
