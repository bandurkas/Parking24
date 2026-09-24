import type { VehicleType } from "@prisma/client";
import { occupancyGrid, parkingDashboard } from "@/server/services/occupancy";
import { todayIso, addDays, fmtDate } from "@/server/lib/dates";
import { requireUser, STAFF } from "@/server/auth/guard";
import { VEHICLE_LABEL } from "@/lib/crm/labels";
import ParkingSummary from "@/components/admin/occupancy/ParkingSummary";

export const dynamic = "force-dynamic";

export default async function OccupancyPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await requireUser(STAFF); // явный список вместо «любой вошедший» (ревью МФ-UI)
  const { from } = await searchParams;
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : todayIso();
  const end = addDays(start, 20);
  const today = todayIso();
  const [dash, grid] = await Promise.all([parkingDashboard(), occupancyGrid(start, end)]);
  const days = grid.pool.map((d) => d.date);
  // Пул и фуры — со знаменателем и подсветкой; категории — только «занято» (ТЗ 4.1, Ф3 §3.6)
  const totals = [
    { label: "Всего в пуле", days: grid.pool, capacity: dash.pool.capacity, limit: dash.autoConfirmLimit },
    { label: "Фуры", days: grid.truck, capacity: dash.truck.capacity, limit: null },
  ];
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
        pool={dash.pool}
        truck={dash.truck}
        arrivals={dash.arrivals}
        departures={dash.departures}
        autoConfirm={dash.autoConfirm}
        autoConfirmLimit={dash.autoConfirmLimit}
        limitDays={grid.limitDays}
        canEdit={user.role === "OWNER"}
      />

      <div className="adm-card mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-3 py-2 text-left">Тип</th>
              {days.map((d) => (
                <th key={d} className={`px-1 py-2 font-mono font-semibold tnum ${d === today ? "bg-primary-soft text-primary-deep" : "text-ink-muted"}`}>
                  {d.slice(8)}<div className="text-[9px] font-normal">{fmtDate(d, { weekday: "short" })}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {totals.map((row) => (
              <tr key={row.label} className="border-t-2 border-navy-deep/20 bg-surface-soft">
                <td className="sticky left-0 bg-surface-soft px-3 py-2 font-bold">
                  {row.label} <span className="font-mono text-ink-muted">/{row.capacity}</span>
                </td>
                {row.days.map(({ date, busy }) => {
                  const full = busy >= row.capacity;
                  const atLimit = row.limit != null && busy >= row.limit;
                  return (
                    <td
                      key={date}
                      title={`Занято ${busy} из ${row.capacity}${atLimit && dash.autoConfirm ? " — заявки с сайта отклоняются" : ""}`}
                      className={`h-10 min-w-9 border-l border-line text-center font-mono font-bold tnum ${full ? "bg-danger text-white" : atLimit ? "bg-warning/60" : ""} ${date === today ? "ring-1 ring-inset ring-primary" : ""}`}
                    >
                      {busy || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
            {grid.byType.map((row) => (
              <tr key={row.vehicleType} className="border-t border-line">
                <td className="sticky left-0 bg-white px-3 py-2 font-semibold">{VEHICLE_LABEL[row.vehicleType as VehicleType]}</td>
                {row.days.map((d) => (
                  <td key={d.date} className={`h-10 min-w-9 border-l border-line text-center font-mono tnum ${d.date === today ? "ring-1 ring-inset ring-primary" : ""}`}>
                    {d.busy || ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
