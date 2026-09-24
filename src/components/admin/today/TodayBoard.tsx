import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Bus, Clock, PlaneTakeoff } from "lucide-react";
import type { Role, VehicleType } from "@prisma/client";
import type { TodayRow } from "@/server/services/today";
import Plate from "../Plate";
import StatusChip from "../StatusChip";
import { overstayLabel } from "@/lib/overstay";
import TransitionButtons from "../booking/TransitionButtons";
import { VEHICLE_SHORT } from "@/lib/crm/labels";
import { formatPhone } from "@/lib/phone";

// Тип строки переехал в сервис (МФ-UI §5.4) — ре-экспорт, чтобы импорты GuardScreen и страниц не менялись
export type { TodayRow } from "@/server/services/today";
// Шапка (Ф3): пул и фуры — занято бронями со знаменателем, категории — только «занято», на стоянке — машины пула
type Part = { onSite: number; held: number; capacity: number };
type Occ = { pool: Part; truck: Part; byType: { vehicleType: VehicleType; busy: number }[] };

function human(today: string) {
  return new Date(today + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
}

export default function TodayBoard({ today, rows, occupancy, role }: { today: string; rows: { arrivals: TodayRow[]; departures: TodayRow[]; onSite: TodayRow[] }; occupancy: Occ; role: Role }) {
  const late = (r: TodayRow) => (r.dateFrom < today ? "ожидался вчера" : null);
  const overdue = (r: TodayRow) => (r.overstay ? overstayLabel(r.overstay) : null);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Табло</div>
          <h1 className="text-2xl font-bold capitalize leading-tight">{human(today)}</h1>
        </div>
        <div className="adm-card flex items-center gap-4 px-4 py-2">
          {[{ label: "пул", v: occupancy.pool }, { label: "фуры", v: occupancy.truck }].map(({ label, v }) => {
            const pct = v.capacity ? Math.round((v.held / v.capacity) * 100) : 0;
            return (
              <div key={label} className="text-center">
                <div className="font-mono text-lg font-bold leading-none tnum">
                  {v.held}<span className="text-ink-muted">/{v.capacity}</span>
                </div>
                <div className={`text-[10px] font-semibold uppercase tracking-wide ${pct >= 100 ? "text-danger" : pct >= 80 ? "text-warning" : "text-ink-muted"}`}>{label}</div>
              </div>
            );
          })}
          {occupancy.byType.map((o) => (
            <div key={o.vehicleType} className="text-center">
              <div className="font-mono text-sm font-bold leading-none tnum">{o.busy}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{VEHICLE_SHORT[o.vehicleType]}</div>
            </div>
          ))}
          <div className="h-8 w-px bg-line" />
          <div className="text-center">
            <div className="font-mono text-lg font-bold leading-none tnum">{occupancy.pool.onSite}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">на стоянке</div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Board title="Прибытие" icon={<ArrowDownToLine size={16} />} tone="text-success" rows={rows.arrivals} role={role} flag={late} empty="Сегодня заездов нет" />
        <Board title="Отправление" icon={<ArrowUpFromLine size={16} />} tone="text-primary" rows={rows.departures} role={role} flag={overdue} danger empty="Сегодня выездов нет" />
      </div>

      {rows.onSite.length > 0 && (
        <section className="adm-card">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <PlaneTakeoff size={16} className="text-steel" />
            <h2 className="font-bold">Сейчас на стоянке</h2>
            <span className="ml-auto font-mono text-xs text-ink-muted">{rows.onSite.length}</span>
          </header>
          <ul className="grid gap-x-6 gap-y-1 px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {rows.onSite.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                <Link href={`/admin/bookings/${r.id}`} className="flex items-center gap-2 hover:underline">
                  <Plate plate={r.plate} size="sm" />
                  <span className="truncate">{r.name ?? "—"}</span>
                </Link>
                <span className="font-mono text-xs text-ink-muted tnum">до {r.dateTo.slice(8)}.{r.dateTo.slice(5, 7)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Board({ title, icon, tone, rows, role, flag, danger = false, empty }: { title: string; icon: React.ReactNode; tone: string; rows: TodayRow[]; role: Role; flag: (r: TodayRow) => string | null; danger?: boolean; empty: string }) {
  return (
    <section className="adm-card overflow-hidden">
      <header className="flex items-center gap-2 bg-navy-deep px-4 py-2.5 text-white">
        <span className={tone}>{icon}</span>
        <h2 className="font-mono text-sm font-bold uppercase tracking-[0.15em]">{title}</h2>
        <span className="ml-auto font-mono text-sm tnum text-white/60">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-ink-muted">{empty}</div>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r, i) => {
            const flagLabel = flag(r);
            const flagged = flagLabel !== null;
            return (
              <li key={r.id} className={`board-row relative flex items-center gap-3 px-4 py-3 ${flagged ? "bg-surface-warm" : ""}`} style={{ animationDelay: `${i * 30}ms` }}>
                {flagged && <span className={`absolute inset-y-0 left-0 w-1 ${danger ? "bg-danger" : "bg-primary"}`} />}
                <div className="w-12 shrink-0 font-mono text-sm font-bold tnum">
                  {r.timeFrom ?? r.timeTo ?? <span className="text-ink-muted">—:—</span>}
                </div>
                <Plate plate={r.plate} size="md" className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/bookings/${r.id}`} className="block truncate text-sm font-semibold hover:underline">
                    {r.name ?? "Без имени"} <span className="font-mono text-xs font-normal text-ink-muted">№{r.number}</span>
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
                    <span className="whitespace-nowrap font-mono">{formatPhone(r.phone)}</span>
                    {r.vehicleType && <span>{VEHICLE_SHORT[r.vehicleType]}</span>}
                    {r.transferNeeded && <span className="flex items-center gap-0.5 text-primary-deep"><Bus size={11} /> трансфер</span>}
                    {flagged && <span className={`flex items-center gap-0.5 font-semibold ${danger ? "text-danger" : "text-primary-deep"}`} data-testid={danger ? "overstay-label" : undefined}><Clock size={11} /> {flagLabel}</span>}
                    {r.paidAmount < r.amount && <span className="text-warning">не оплачено</span>}
                  </div>
                </div>
                <div className="hidden shrink-0 xl:block"><StatusChip status={r.status} short /></div>
                <div className="shrink-0"><TransitionButtons bookingId={r.id} status={r.status} role={role} primaryOnly overstayDue={r.overstay ? { days: r.overstay.days, rate: r.overstay.rate || null } : null} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
