"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Timer } from "lucide-react";
import { setScanModeAction, setSchedulerPausedAction } from "@/app/admin/actions/settings";

type Mode = "off" | "dry" | "on";

export type ScanRow = { code: string; label: string; mode: Mode; last: string | null };

export type SchedulerCardProps = {
  kind: "off" | "never" | "late" | "paused" | "ok";
  lastAt: string | null; // уже по Москве
  ageMin: number | null;
  failed: string[];
  paused: boolean;
  scans?: ScanRow[];
};

const MODES: { mode: Mode; label: string }[] = [
  { mode: "off", label: "Выкл" },
  { mode: "dry", label: "Пробно" },
  { mode: "on", label: "Вкл" },
];

const TITLE: Record<SchedulerCardProps["kind"], string> = {
  ok: "Работает",
  paused: "На паузе",
  late: "Отстаёт",
  off: "Выключен на этом сервере",
  never: "Ещё не запускался",
};

export default function SchedulerCard({ kind, lastAt, ageMin, failed, paused, scans = [] }: SchedulerCardProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const bad = kind === "late" || failed.length > 0;
  const detail = kind === "late" ? `последний тик ${ageMin} мин назад` : lastAt ? `последний тик ${lastAt}` : null;

  function toggle() {
    setErr(null);
    start(async () => {
      const res = await setSchedulerPausedAction(!paused);
      if (res.ok) router.refresh();
      else setErr(res.error);
    });
  }

  function setMode(code: string, mode: Mode) {
    setErr(null);
    start(async () => {
      const res = await setScanModeAction(code, mode);
      if (res.ok) router.refresh();
      else setErr(res.error);
    });
  }

  return (
    <section className="adm-card mt-4 p-4" aria-label="Планировщик">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`grid size-10 place-items-center rounded-lg ${bad ? "bg-danger/10 text-danger" : "bg-primary-soft text-primary-deep"}`}>
          <Timer size={18} />
        </span>
        <div className="min-w-48 flex-1">
          <div className="font-semibold">Планировщик</div>
          <div className={`text-sm ${bad ? "text-danger" : "text-ink-muted"}`} data-testid="scheduler-state">
            {TITLE[kind]}
            {detail && <> · {detail}</>}
          </div>
          {failed.length > 0 && <div className="mt-1 text-xs text-danger">Сбой в последнем тике: {failed.join(", ")}</div>}
          {err && <div className="mt-1 text-xs text-danger">{err}</div>}
        </div>
        <button onClick={toggle} disabled={pending} className={`${paused ? "adm-btn-primary" : "adm-btn"} h-10 px-4 text-sm`}>
          {pending ? "…" : paused ? "Снять с паузы" : "Поставить на паузу"}
        </button>
      </div>
      {scans.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {scans.map((s) => (
            <li key={s.code} className="flex flex-wrap items-center gap-3 py-2.5" data-testid={`scan-${s.code}`}>
              <div className="min-w-48 flex-1">
                <div className="text-sm font-medium">{s.label}</div>
                {s.last && <div className="text-xs text-ink-muted" data-testid={`scan-${s.code}-last`}>{s.last}</div>}
              </div>
              <div role="group" aria-label={`Режим: ${s.label}`} className="inline-flex overflow-hidden rounded-lg ring-1 ring-line">
                {MODES.map((m) => (
                  <button
                    key={m.mode}
                    onClick={() => setMode(s.code, m.mode)}
                    disabled={pending || s.mode === m.mode}
                    aria-pressed={s.mode === m.mode}
                    className={`h-9 px-3 text-sm ${s.mode === m.mode ? (m.mode === "on" ? "bg-primary font-semibold text-navy-deep" : "bg-surface font-semibold text-ink") : "bg-white text-ink-muted hover:bg-surface-soft"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
