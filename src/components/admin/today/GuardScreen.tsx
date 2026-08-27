"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Delete, LogOut, Phone, RefreshCw, ShieldCheck } from "lucide-react";
import type { SessionUser } from "@/server/auth/session";
import type { TodayRow } from "./TodayBoard";
import Plate from "../Plate";
import { transitionAction } from "@/app/admin/actions/bookings";
import { logoutAction } from "@/app/admin/login/actions";
import { normalizePlate } from "@/lib/phone";

type Rows = { arrivals: TodayRow[]; departures: TodayRow[]; onSite: TodayRow[] };

export default function GuardScreen({ today, rows, user }: { today: string; rows: Rows; user: SessionUser }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"in" | "out">("in");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const list = useMemo(() => {
    const base = tab === "in" ? rows.arrivals : [...rows.departures, ...rows.onSite];
    const needle = normalizePlate(q);
    if (!needle) return base;
    return base.filter((r) => (r.plate ?? "").includes(needle) || (r.phone ?? "").replace(/\D/g, "").endsWith(needle.replace(/\D/g, "")) || String(r.number) === needle);
  }, [rows, tab, q]);

  function act(r: TodayRow, to: "CHECKED_IN" | "CHECKED_OUT") {
    setBusy(r.id);
    setErr(null);
    start(async () => {
      const res = await transitionAction(r.id, to);
      setBusy(null);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "А", "0", "⌫"];
  const date = new Date(today + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });

  return (
    <div className="admin-root flex min-h-screen flex-col bg-navy-deep text-white">
      <header className="flex items-center gap-3 px-4 py-3">
        <ShieldCheck size={22} className="text-primary" />
        <div className="leading-tight">
          <div className="text-base font-bold">КПП · {date}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">{user.name}</div>
        </div>
        <button onClick={() => router.refresh()} className="ml-auto grid size-11 place-items-center rounded-full bg-white/10" aria-label="Обновить">
          <RefreshCw size={18} className={pending ? "animate-spin" : ""} />
        </button>
        <form action={logoutAction}>
          <button className="grid size-11 place-items-center rounded-full bg-white/10" aria-label="Выйти"><LogOut size={18} /></button>
        </form>
      </header>

      <div className="grid grid-cols-2 gap-2 px-4">
        <button onClick={() => setTab("in")} className={`h-12 rounded-xl font-mono text-sm font-bold uppercase tracking-[0.12em] ${tab === "in" ? "bg-success text-navy-deep" : "bg-white/10 text-white/70"}`}>
          Заезд · {rows.arrivals.length}
        </button>
        <button onClick={() => setTab("out")} className={`h-12 rounded-xl font-mono text-sm font-bold uppercase tracking-[0.12em] ${tab === "out" ? "bg-primary text-navy-deep" : "bg-white/10 text-white/70"}`}>
          Выезд · {rows.departures.length + rows.onSite.length}
        </button>
      </div>

      <div className="px-4 pt-3">
        <div className="flex h-14 items-center rounded-xl bg-white px-4 font-mono text-2xl font-bold uppercase tracking-[0.15em] text-ink">
          {q || <span className="text-base font-normal normal-case tracking-normal text-ink-muted">Номер, телефон или № брони</span>}
        </div>
      </div>

      {err && <div className="mx-4 mt-2 rounded-lg bg-danger px-3 py-2 text-sm font-semibold">{err}</div>}

      <ul className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {list.length === 0 && <li className="py-8 text-center text-white/50">Ничего не найдено</li>}
        {list.map((r) => {
          const to = tab === "in" ? "CHECKED_IN" : "CHECKED_OUT";
          const can = tab === "in" ? r.status === "CONFIRMED" || r.status === "NEW" || r.status === "AWAITING_PAYMENT" : r.status === "CHECKED_IN";
          const overdue = tab === "out" && r.dateTo < today;
          return (
            <li key={r.id} className={`flex items-center gap-3 rounded-2xl bg-white p-3 text-ink ${overdue ? "ring-2 ring-primary" : ""}`}>
              <div className="min-w-0 flex-1">
                <Plate plate={r.plate} size="lg" />
                <div className="mt-1.5 flex items-center gap-2 text-sm">
                  <span className="truncate font-semibold">{r.name ?? "Без имени"}</span>
                  <span className="font-mono text-xs text-ink-muted">№{r.number}</span>
                  {r.phone && <a href={`tel:${r.phone}`} className="grid size-8 place-items-center rounded-full bg-surface" aria-label="Позвонить"><Phone size={14} /></a>}
                </div>
                <div className="font-mono text-xs text-ink-muted tnum">
                  {tab === "in" ? `до ${r.dateTo.slice(8)}.${r.dateTo.slice(5, 7)}` : overdue ? "просрочен выезд" : `выезд ${r.dateTo.slice(8)}.${r.dateTo.slice(5, 7)}`}
                  {r.paidAmount < r.amount && <span className="ml-2 font-semibold text-warning">НЕ ОПЛАЧЕНО</span>}
                </div>
              </div>
              <button
                disabled={!can || busy === r.id}
                onClick={() => act(r, to)}
                className={`h-16 w-28 shrink-0 rounded-xl font-mono text-base font-bold uppercase tracking-wider ${tab === "in" ? "bg-success" : "bg-primary"} text-navy-deep disabled:opacity-40`}
              >
                {busy === r.id ? "…" : tab === "in" ? "Заехал" : "Выехал"}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-6 gap-1.5 bg-black/30 p-3 sm:grid-cols-12">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => (k === "⌫" ? setQ((s) => s.slice(0, -1)) : setQ((s) => (s + k).slice(0, 10)))}
            className="h-12 rounded-lg bg-white/10 font-mono text-lg font-bold active:bg-primary active:text-navy-deep"
            aria-label={k === "⌫" ? "Стереть" : k}
          >
            {k === "⌫" ? <Delete size={18} className="mx-auto" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
