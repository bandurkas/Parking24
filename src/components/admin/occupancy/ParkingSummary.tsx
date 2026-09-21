import Link from "next/link";
import { Car, LogIn, LogOut, ParkingSquare, Layers, AlertTriangle } from "lucide-react";

type Props = {
  onSite: number;
  arrivals: number;
  departures: number;
  freeNow: number;
  capacity: number;
  held: number;
  autoConfirm: boolean;
  autoConfirmLimit: number;
  canEdit: boolean;
};

// Общая панель занятости (ТЗ 21.09, п. 4.2): пять показателей.
export default function ParkingSummary(p: Props) {
  const tiles = [
    { icon: Car, label: "Авто на парковке", value: p.onSite, hint: "фактически заехали" },
    { icon: LogIn, label: "Заезды за 24 ч", value: p.arrivals, hint: "подтверждены, ещё не заехали" },
    { icon: LogOut, label: "Выезды за 24 ч", value: p.departures, hint: "по плану покидают стоянку" },
    { icon: ParkingSquare, label: "Свободно сейчас", value: p.freeNow, hint: `занято бронями ${p.held}` },
    { icon: Layers, label: "Всего мест", value: p.capacity, hint: "с грузовыми" },
  ];
  const nearLimit = p.held >= p.autoConfirmLimit;
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
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        {p.autoConfirm ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 font-semibold text-[#0b7a4c]">
              Автоподтверждение включено
            </span>
            заявки с сайта подтверждаются, пока занято меньше {p.autoConfirmLimit}; дальше — резерв администратора
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
      {p.autoConfirm && nearLimit && (
        <p className="mt-2 flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-[#8a5a00]">
          <AlertTriangle size={16} /> Занято {p.held} мест из {p.capacity} — новые заявки с сайта отклоняются автоматически.
        </p>
      )}
    </section>
  );
}
