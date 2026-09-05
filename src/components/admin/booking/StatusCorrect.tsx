"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2, X } from "lucide-react";
import type { BookingStatus } from "@prisma/client";
import { correctStatusAction } from "@/app/admin/actions/bookings";
import { PIPELINE, STATUS_LABEL, TERMINAL } from "@/lib/crm/labels";

const ALL: BookingStatus[] = [...PIPELINE, ...TERMINAL];

// Ручное исправление статуса (ошибка перетаскивания, человеческий фактор): любой статус + обязательная причина.
export default function StatusCorrect({ bookingId, status, autoOpen = false }: { bookingId: string; status: BookingStatus; autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [to, setTo] = useState<BookingStatus | "">("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!to) return;
    setErr(null);
    start(async () => {
      const r = await correctStatusAction(bookingId, to, reason);
      if (!r.ok) return setErr(r.error);
      setOpen(false); setTo(""); setReason("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="adm-btn-ghost h-8 gap-1.5 px-2.5 text-xs text-ink-muted" title="Поставить любой статус вручную, если карточку переместили по ошибке">
        <Undo2 size={13} /> Исправить статус
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="w-full rounded-xl border border-warning/50 bg-warning/8 p-3">
      <div className="flex items-center gap-2">
        <Undo2 size={14} className="text-[#8a5a00]" />
        <span className="text-sm font-semibold">Исправить статус вручную</span>
        <span className="text-xs text-ink-muted">сейчас: {STATUS_LABEL[status]}</span>
        <button type="button" onClick={() => setOpen(false)} className="adm-btn-ghost ml-auto size-8 p-0" aria-label="Закрыть"><X size={14} /></button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[14rem_1fr_auto]">
        <select value={to} onChange={(e) => setTo(e.target.value as BookingStatus)} className="adm-input h-10 text-sm" aria-label="Новый статус" autoFocus>
          <option value="">Новый статус…</option>
          {ALL.filter((s) => s !== status).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (обязательно): перетащил не ту карточку…" className="adm-input h-10 text-sm" maxLength={300} aria-label="Причина" />
        <button type="submit" disabled={pending || !to || reason.trim().length < 3} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Исправить"}</button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-muted">Запись попадёт в ленту и журнал. Запланированные сообщения клиенту по прежнему статусу будут отменены.</p>
      {err && <p className="adm-err mt-1">{err}</p>}
    </form>
  );
}
