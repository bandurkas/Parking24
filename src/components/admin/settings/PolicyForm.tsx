"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePolicyAction } from "@/app/admin/actions/links";
import SaveNote, { type Note } from "./SaveNote";

export default function PolicyForm({ autoNoShowAfterHours, min, max }: { autoNoShowAfterHours: number; min: number; max: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hours, setHours] = useState(String(autoNoShowAfterHours));
  const [note, setNote] = useState<Note>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    start(async () => {
      const res = await savePolicyAction({ autoNoShowAfterHours: Number(hours) });
      setNote(res.ok ? { ok: true, text: "Сохранено" } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="adm-card mt-3 divide-y divide-line" aria-label="Политика">
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-56 flex-1">
          <div className="font-semibold">Автопереход в «Не приехал», часов после планового заезда</div>
          <div className="text-xs text-ink-muted">От {min} до {max}. Автопереход начнёт работать со сканом «не приехали» в «Планировщике».</div>
        </div>
        <input
          value={hours}
          onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          aria-label="Часов до «Не приехал»"
          className="adm-input h-11 w-28 font-mono tnum"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button type="submit" disabled={pending} className="adm-btn-primary h-11 px-5">{pending ? "Сохраняем…" : "Сохранить"}</button>
        <SaveNote note={note} />
      </div>
    </form>
  );
}
