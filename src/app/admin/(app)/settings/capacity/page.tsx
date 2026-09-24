import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/server/auth/guard";
import { SETTINGS, parkingSettings } from "@/server/services/settings";
import { parkingDashboard } from "@/server/services/occupancy";
import { autoConfirmGate } from "@/server/services/autoconfirm";
import { prisma } from "@/server/db/prisma";
import { fmtMoscow, todayIso } from "@/server/lib/dates";
import { gateChecks } from "@/lib/autoconfirm-gate";
import CapacityForm from "@/components/admin/settings/CapacityForm";
import AutoConfirmPanel from "@/components/admin/settings/AutoConfirmPanel";

export const dynamic = "force-dynamic";

// Кто и когда последним включил или выключил автоподтверждение (журнал setAutoConfirmAction)
async function lastAutoConfirmChange(on: boolean): Promise<string | null> {
  const row = await prisma.auditLog.findFirst({
    where: { entity: "Setting", entityId: SETTINGS.autoConfirm.key },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });
  const wasOn = (row?.diff as { autoConfirm?: boolean } | null)?.autoConfirm === true;
  // Запись журнала не про текущее состояние (меняли в обход панели) — не выдаём её за него
  if (!row || wasOn !== on) return on ? "Кто включил — неизвестно: настройка изменена не через эту панель" : null;
  return `${wasOn ? "Включил" : "Выключил"} ${row.user?.name ?? "неизвестный пользователь"}, ${fmtMoscow(row.createdAt)}`;
}

export default async function CapacityPage() {
  await requireUser(["OWNER"]);
  const [settings, dash, gate] = await Promise.all([parkingSettings(), parkingDashboard(todayIso()), autoConfirmGate()]);
  const changed = await lastAutoConfirmChange(settings.autoConfirm);
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
      <AutoConfirmPanel
        on={settings.autoConfirm}
        limit={settings.autoConfirmLimit}
        capacity={settings.capacityTotal}
        checks={gateChecks(gate)}
        changed={changed}
      />
    </div>
  );
}
