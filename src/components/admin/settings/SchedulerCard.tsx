"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Timer } from "lucide-react";
import { setSchedulerPausedAction } from "@/app/admin/actions/settings";

export type SchedulerCardProps = {
  kind: "off" | "never" | "late" | "paused" | "ok";
  lastAt: string | null; // уже по Москве
  ageMin: number | null;
  failed: string[];
  paused: boolean;
};

const TITLE: Record<SchedulerCardProps["kind"], string> = {
  ok: "Работает",
  paused: "На паузе",
  late: "Отстаёт",
  off: "Выключен на этом сервере",
  never: "Ещё не запускался",
};

export default function SchedulerCard({ kind, lastAt, ageMin, failed, paused }: SchedulerCardProps) {
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

  return (
    <section className="adm-card mt-4 flex flex-wrap items-center gap-3 p-4" aria-label="Планировщик">
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
    </section>
  );
}
