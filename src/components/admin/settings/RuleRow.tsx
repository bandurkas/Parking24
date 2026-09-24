"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRuleActiveAction } from "@/app/admin/actions/templates";
import type { RuleView } from "@/server/services/automations";
import SaveNote, { type Note } from "./SaveNote";

export default function RuleRow({ r }: { r: RuleView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [warn, setWarn] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);

  function toggle(force = false) {
    setNote(null);
    start(async () => {
      const res = await setRuleActiveAction(r.code, !r.isActive, force);
      if (res.ok) {
        setWarn(null);
        router.refresh();
      } else if (res.confirm) {
        setWarn(res.error);
      } else {
        setWarn(null);
        setNote({ ok: false, text: res.error });
      }
    });
  }

  return (
    <li className="px-4 py-3 sm:px-5" data-rule={r.code}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={`font-semibold ${r.isActive ? "" : "text-ink-muted"}`}>{r.name}</div>
          <div className="text-sm">{r.when}</div>
          <div className="text-xs text-ink-muted">
            Шаблон: {r.template ? `«${r.template.name}»` : "не задан"}
            {r.template && !r.template.isActive && <span className="ml-1 font-semibold text-danger">· шаблон выключен, сообщение не уйдёт</span>}
          </div>
          {r.sameGroup.length > 0 && <div className="text-xs text-ink-muted">Одно сообщение на бронь вместе с: {r.sameGroup.map((n) => `«${n}»`).join(", ")}</div>}
          {r.timed && <div className="text-xs text-ink-muted">По времени: начнёт срабатывать, когда в «Планировщике» включат этот скан</div>}
          {r.edited && (
            <div data-testid="rule-edited" className="text-xs text-[#8a5a00]">
              {r.isActive ? "Включено" : "Выключено"} вручную{r.edited.by ? `: ${r.edited.by}` : ""}, {r.edited.at} — выкатка это не меняет
            </div>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={r.isActive}
          aria-label={`${r.name}: ${r.isActive ? "включено" : "выключено"}`}
          disabled={pending}
          onClick={() => toggle()}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition ${r.isActive ? "bg-primary" : "bg-line"}`}
        >
          <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${r.isActive ? "left-6" : "left-1"}`} />
        </button>
      </div>
      {warn && (
        <div className="mt-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-[#8a5a00]" role="alert">
          <div>{warn}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => toggle(true)} disabled={pending} className="adm-btn-danger h-9 bg-white px-3 text-sm">Выключить всё равно</button>
            <button type="button" onClick={() => setWarn(null)} className="adm-btn h-9 px-3 text-sm">Оставить включённым</button>
          </div>
        </div>
      )}
      <SaveNote note={note} className="mt-1" />
    </li>
  );
}
