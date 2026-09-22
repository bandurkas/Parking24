"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus } from "lucide-react";
import { extendStayAction } from "@/app/admin/actions/bookings";
import { rub } from "@/lib/overstay";

// Перестой: машина на парковке после даты выезда (docs/phases/PHASE_02_OVERSTAY.md §4.4–4.5).
// Все числа и даты приходят готовыми с сервера.
export default function OverstayBanner({ bookingId, days, debt, shown, rate, plannedOut, today }: { bookingId: string; days: number; debt: number; shown: number; rate: number; plannedOut: string; today: string }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const money = rate === 0 ? "стоимость не задана" : shown > 0 ? `ДОЛГ ${rub(shown)}` : `долг ${rub(debt)} оплачен заранее`;

  function extend(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await extendStayAction(bookingId, date);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="mx-5 mb-4 rounded-xl border border-danger/40 bg-danger/8 p-4" data-testid="overstay-banner">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-bold text-danger">ПЕРЕСТОЙ · {days} сут. · {money}</div>
          <p className="mt-0.5 text-ink-muted">
            Выезд был {plannedOut}. Место занято, пока машина на парковке. Выясните причину: продлите бронь или отметьте выезд.
            {rate > 0 && ` Сутки перестоя — ${rub(rate)} по тарифу.`}
          </p>
          <form onSubmit={extend} className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-ink-muted" htmlFor={`extend-${bookingId}`}>Продлить до</label>
            <input id={`extend-${bookingId}`} type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="adm-input h-9 w-40 font-mono text-sm" />
            <button type="submit" disabled={pending || !date} className="adm-btn h-9 gap-1 px-3 text-sm"><CalendarPlus size={14} /> {pending ? "…" : "Продлить"}</button>
          </form>
          {err && <p className="adm-err mt-1">{err}</p>}
        </div>
      </div>
    </div>
  );
}
