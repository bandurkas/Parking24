import type { VehicleType } from "@prisma/client";
import { occupancy, parkingDashboard, poolLoad } from "@/server/services/occupancy";
import { todayIso, addDays } from "@/server/lib/dates";
import { prisma } from "@/server/db/prisma";
import { requireUser, STAFF } from "@/server/auth/guard";
import { VEHICLE_LABEL } from "@/lib/crm/labels";
import ParkingSummary from "@/components/admin/occupancy/ParkingSummary";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";
const TYPES: VehicleType[] = ["CAR", "SUV", "MOTO", "TRUCK"];

export default async function OccupancyPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await requireUser(STAFF); // явный список вместо «любой вошедший» (ревью МФ-UI)
  const { from } = await searchParams;
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : todayIso();
  const end = addDays(start, 21);
  const today = todayIso();
  const [rows, placeholder, dash, pool] = await Promise.all([
    Promise.all(TYPES.map((vt) => occupancy("PARKING", start, end, { vehicleType: vt }))),
    prisma.setting.findUnique({ where: { key: "capacityIsPlaceholder" } }),
    parkingDashboard(today),
    poolLoad("POOL", start, addDays(end, -1)),
  ]);
  const days = rows[0].map((d) => d.date);
  const poolByDate = new Map(pool.days.map((d) => [d.date, d.busy]));
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Сетка</div>
          <h1 className="text-xl font-bold">Занятость на 3 недели</h1>
        </div>
        <form className="ml-auto flex items-center gap-2">
          <input type="date" name="from" defaultValue={start} className="adm-input h-9 w-40 font-mono text-sm" />
          <button className="adm-btn h-9 px-3 text-sm">Показать</button>
        </form>
      </div>
      <ParkingSummary
        onSite={dash.onSite}
        arrivals={dash.arrivals}
        departures={dash.departures}
        freeNow={dash.freeNow}
        capacity={dash.capacity}
        held={dash.held}
        autoConfirm={dash.autoConfirm}
        autoConfirmLimit={dash.autoConfirmLimit}
        canEdit={user.role === "OWNER"}
      />

      {placeholder?.value === true && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-[#8a5a00]">
          <AlertTriangle size={16} /> Ёмкость по типам ТС — плейсхолдер, схема стоянки от заказчика ещё не получена. Изменить: Настройки → Ёмкость.
        </p>
      )}
      <div className="adm-card mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-3 py-2 text-left">Тип</th>
              {days.map((d) => (
                <th key={d} className={`px-1 py-2 font-mono font-semibold tnum ${d === today ? "bg-primary-soft text-primary-deep" : "text-ink-muted"}`}>
                  {d.slice(8)}<div className="text-[9px] font-normal">{new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "short" })}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t-2 border-navy-deep/20 bg-surface-soft">
              <td className="sticky left-0 bg-surface-soft px-3 py-2 font-bold">
                Всего в пуле <span className="font-mono text-ink-muted">/{dash.capacityPool}</span>
              </td>
              {days.map((d) => {
                const busy = poolByDate.get(d) ?? 0;
                const over = dash.autoConfirm && busy >= dash.autoConfirmLimit;
                return (
                  <td
                    key={d}
                    title={over ? `Занято ${busy} — заявки с сайта отклоняются` : `Занято ${busy} из ${dash.capacityPool}`}
                    className={`h-10 min-w-9 border-l border-line text-center font-mono font-bold tnum ${over ? "bg-danger text-white" : ""} ${d === today ? "ring-1 ring-inset ring-primary" : ""}`}
                  >
                    {busy || ""}
                  </td>
                );
              })}
            </tr>
            {TYPES.map((vt, i) => (
              <tr key={vt} className="border-t border-line">
                <td className="sticky left-0 bg-white px-3 py-2 font-semibold">{VEHICLE_LABEL[vt]} <span className="font-mono text-ink-muted">/{rows[i][0]?.capacity}</span></td>
                {rows[i].map((d) => {
                  const pct = d.capacity ? d.busy / d.capacity : 0;
                  const bg = d.busy === 0 ? "" : pct >= 1 ? "bg-danger text-white" : pct >= 0.8 ? "bg-warning/60" : pct >= 0.5 ? "bg-success/30" : "bg-success/12";
                  return (
                    <td key={d.date} className={`h-10 min-w-9 border-l border-line text-center font-mono tnum ${bg} ${d.date === today ? "ring-1 ring-inset ring-primary" : ""}`}>
                      {d.busy || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
