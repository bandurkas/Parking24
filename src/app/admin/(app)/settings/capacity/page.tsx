import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/server/auth/guard";
import { parkingSettings } from "@/server/services/settings";
import { parkingDashboard } from "@/server/services/occupancy";
import { todayIso } from "@/server/lib/dates";
import CapacityForm from "@/components/admin/settings/CapacityForm";

export const dynamic = "force-dynamic";

export default async function CapacityPage() {
  await requireUser(["OWNER"]);
  const [settings, dash] = await Promise.all([parkingSettings(), parkingDashboard(todayIso())]);
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ChevronLeft size={15} /> Настройки
      </Link>
      <h1 className="mt-1 text-xl font-bold">Ёмкость стоянки и автоподтверждение</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Легковые, кроссоверы и мотоциклы делят общий пул мест. Грузовые считаются отдельно и подтверждаются только вручную.
      </p>
      <CapacityForm settings={settings} occupiedNow={dash.held} />
    </div>
  );
}
