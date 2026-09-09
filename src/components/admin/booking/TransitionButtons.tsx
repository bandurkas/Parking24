"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import type { BookingStatus, Role } from "@prisma/client";
import { GUARD_TRANSITIONS, TRANSITIONS, TRANSITION_VERB, STATUS_LABEL } from "@/lib/crm/labels";
import { transitionAction } from "@/app/admin/actions/bookings";

const PRIMARY: BookingStatus[] = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
const TIMED: BookingStatus[] = ["CHECKED_IN", "CHECKED_OUT"];

// Текущее московское время для datetime-local (ГГГГ-ММ-ДДTЧЧ:ММ)
export function nowMoscowLocal(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
// datetime-local в московской зоне → ISO
export function moscowLocalToIso(v: string): string {
  return new Date(`${v}:00+03:00`).toISOString();
}

export default function TransitionButtons({ bookingId, status, role, size = "md", primaryOnly = false, askTime = true }: { bookingId: string; status: BookingStatus; role: Role; size?: "md" | "lg"; primaryOnly?: boolean; askTime?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [timed, setTimed] = useState<BookingStatus | null>(null);
  const [at, setAt] = useState("");
  const targets = TRANSITIONS[status].filter((t) => role !== "GUARD" || GUARD_TRANSITIONS.includes(t)).filter((t) => !primaryOnly || PRIMARY.includes(t));
  if (targets.length === 0) return null;

  function run(to: BookingStatus, reason?: string, atIso?: string) {
    start(async () => {
      const res = await transitionAction(bookingId, to, reason, atIso);
      if (!res.ok) setErr(res.error);
      else { setTimed(null); router.refresh(); }
    });
  }

  function go(to: BookingStatus) {
    setErr(null);
    let reason: string | undefined;
    if (to === "CANCELLED") {
      const r = window.prompt("Причина отмены (необязательно):", "");
      if (r === null) return;
      reason = r || undefined;
    }
    if (to === "NO_SHOW" && !window.confirm("Отметить как «не приехал»?")) return;
    if (askTime && TIMED.includes(to)) {
      setTimed(to);
      setAt(nowMoscowLocal());
      return;
    }
    run(to, reason);
  }

  const h = size === "lg" ? "h-14 px-6 text-base" : "h-10 px-4 text-sm";

  if (timed) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); run(timed, undefined, moscowLocalToIso(at)); }} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-soft px-3 py-2">
        <Clock size={14} className="text-steel" />
        <span className="text-sm font-semibold">{timed === "CHECKED_IN" ? "Фактически заехал" : "Фактически выехал"}</span>
        <input type="datetime-local" value={at} max={nowMoscowLocal()} onChange={(e) => setAt(e.target.value)} className="adm-input h-9 w-52 font-mono text-sm" aria-label="Фактическое время (МСК)" autoFocus />
        <span className="text-[11px] text-ink-muted">МСК · сейчас по умолчанию</span>
        <button type="submit" disabled={pending || !at} className="adm-btn-primary h-9 px-4 text-sm">{pending ? "…" : TRANSITION_VERB[timed]}</button>
        <button type="button" onClick={() => setTimed(null)} className="adm-btn-ghost h-9 px-3 text-sm">Отмена</button>
        {err && <span className="w-full text-xs text-danger">{err}</span>}
      </form>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${primaryOnly ? "flex-nowrap" : "flex-wrap"}`}>
      {targets.map((t) => (
        <button
          key={t}
          disabled={pending}
          onClick={() => go(t)}
          title={TIMED.includes(t) ? `${STATUS_LABEL[t]}: можно указать фактическое время` : undefined}
          className={`${PRIMARY.includes(t) ? "adm-btn-primary" : t === "CANCELLED" || t === "NO_SHOW" ? "adm-btn-danger" : "adm-btn"} ${h}`}
        >
          {TRANSITION_VERB[t]}
        </button>
      ))}
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
