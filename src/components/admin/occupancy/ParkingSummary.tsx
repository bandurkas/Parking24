import Link from "next/link";
import { Car, LogIn, LogOut, ParkingSquare, Layers, AlertTriangle } from "lucide-react";
import { plural } from "@/lib/tariffs";

type Part = { onSite: number; held: number; capacity: number; free: number; open: number };
type Window = { total: number; overdue: number };

type Props = {
  pool: Part;
  truck: Part;
  arrivals: Window;
  departures: Window;
  autoConfirm: boolean;
  autoConfirmLimit: number;
  limitDays: number;
  canEdit: boolean;
};

// Общая панель занятости (ТЗ 21.09, п. 4.2): пять показателей по пулу 405, фуры отдельной строкой (Ф3 §3.4).
// Эталон ТЗ: одна машина на стоянке → 1 / — / — / 404 / 405
export default function ParkingSummary(p: Props) {
  const tiles = [
    { icon: Car, label: "Авто на парковке", value: p.pool.onSite, hint: "фактически заехали" },
    { icon: LogIn, label: "Заезды за 24 ч", value: p.arrivals.total, hint: p.arrivals.overdue ? `подтверждены · опаздывают ${p.arrivals.overdue}` : "подтверждены, ещё не заехали" },
    { icon: LogOut, label: "Выезды за 24 ч", value: p.departures.total, hint: p.departures.overdue ? `из них в перестое ${p.departures.overdue}` : "по плану покидают стоянку" },
    { icon: ParkingSquare, label: "Свободно сейчас", value: p.pool.free, hint: `занято бронями ${p.pool.held}` },
    { icon: Layers, label: "Всего мест", value: p.pool.capacity, hint: "без грузовых" },
  ];
  const rows = [
    { label: "Пул", v: p.pool },
    { label: "Фуры", v: p.truck },
  ];
  return (
    <section className="mt-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="adm-card p-4">
            <div className="flex items-center gap-2 text-ink-muted">
              <t.icon size={15} />
              <span className="text-xs">{t.label}</span>
            </div>
            <div className="mt-1 font-mono text-2xl font-bold tnum">{t.value}</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">{t.hint}</div>
          </div>
        ))}
      </div>
      <div className="adm-card mt-3 divide-y divide-line text-sm">
        {rows.map((r) => (
          <p key={r.label} data-testid={`occupancy-${r.label === "Пул" ? "pool" : "truck"}`} className="flex flex-wrap items-center gap-x-2 px-4 py-2">
            <b className="w-12">{r.label}</b>
            <span className="text-ink-muted">·</span> на стоянке <b className="font-mono tnum">{r.v.onSite}</b>
            <span className="text-ink-muted">·</span> занято бронями <b className="font-mono tnum">{r.v.held}</b> из <span className="font-mono tnum">{r.v.capacity}</span>
            <span className="text-ink-muted">·</span> под новые заявки <b className="font-mono tnum">{r.v.open}</b>
          </p>
        ))}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        {p.autoConfirm ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 font-semibold text-[#0b7a4c]">
              Автоподтверждение включено
            </span>
            заявки с сайта подтверждаются, пока на их даты занято меньше {p.autoConfirmLimit}; дальше — резерв администратора
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-semibold text-ink-muted ring-1 ring-line">
              Автоподтверждение выключено
            </span>
            все заявки с сайта подтверждает администратор
          </>
        )}
        {p.canEdit && (
          <Link href="/admin/settings/capacity" className="font-semibold text-primary-deep underline-offset-2 hover:underline">
            Настроить
          </Link>
        )}
      </p>
      {p.autoConfirm && p.limitDays > 0 && (
        <p className="mt-2 flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-[#8a5a00]">
          <AlertTriangle size={16} /> Ближайшие 3 недели: {p.limitDays} {plural(p.limitDays, "день занят", "дня заняты", "дней заняты")} на {p.autoConfirmLimit} и больше — заявки с сайта на эти даты отклоняются автоматически.
        </p>
      )}
    </section>
  );
}
