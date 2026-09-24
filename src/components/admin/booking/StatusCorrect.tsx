"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2, X } from "lucide-react";
import type { BookingStatus, Role } from "@prisma/client";
import { correctStatusAction } from "@/app/admin/actions/bookings";
import { PIPELINE, STATUS_LABEL, TERMINAL } from "@/lib/crm/labels";
import { checkCorrection, CLOSED_STATUSES } from "@/lib/correction";

const ALL: BookingStatus[] = [...PIPELINE, ...TERMINAL];

// Ручное исправление статуса (ошибка перетаскивания, забытая отметка): любой статус + обязательная причина.
// today/minDate/отметки считает серверная страница по Москве — клиент по своему поясу ничего не вычисляет
export default function StatusCorrect({ bookingId, status, role, today, minDate, checkedInDate, checkedOutDate, autoOpen = false }: {
  bookingId: string; status: BookingStatus; role: Role; today: string; minDate: string; checkedInDate: string | null; checkedOutDate: string | null; autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [to, setTo] = useState<BookingStatus | "">("");
  const [reason, setReason] = useState("");
  const [dateIn, setDateIn] = useState("");
  const [dateOut, setDateOut] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (CLOSED_STATUSES.includes(status) && role !== "OWNER") {
    return <span className="text-xs text-ink-muted">Исправить статус закрытой брони может только владелец</span>;
  }

  const check = to ? checkCorrection(to, { in: checkedInDate, out: checkedOutDate }, { in: dateIn, out: dateOut }, today, minDate) : null;
  const need = check?.need ?? { in: false, out: false };
  const filled = (!need.in || !!dateIn) && (!need.out || !!dateOut);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!to) return;
    setErr(null);
    start(async () => {
      const dates = { in: need.in ? dateIn : undefined, out: need.out ? dateOut : undefined };
      let r = await correctStatusAction(bookingId, to, reason, dates);
      // Мест нет — владельцу предлагаем подтвердить сверх вместимости (Ф3)
      if (!r.ok && r.overCapacity?.canOverride && window.confirm(`${r.error}\n\nПодтвердить сверх вместимости?`)) r = await correctStatusAction(bookingId, to, reason, dates, true);
      if (!r.ok) return setErr(r.error);
      setOpen(false); setTo(""); setReason(""); setDateIn(""); setDateOut("");
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
      <div className="mt-2 grid gap-2 sm:grid-cols-[14rem_1fr]">
        <select value={to} onChange={(e) => { setTo(e.target.value as BookingStatus); setDateIn(""); setDateOut(""); }} className="adm-input h-10 text-sm" aria-label="Новый статус" autoFocus>
          <option value="">Новый статус…</option>
          {ALL.filter((s) => s !== status).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (обязательно): перетащил не ту карточку…" className="adm-input h-10 text-sm" maxLength={300} aria-label="Причина" />
      </div>
      {(need.in || need.out) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          {need.in && (
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold">
              Дата заезда
              <input type="date" value={dateIn} min={minDate} max={today} onChange={(e) => setDateIn(e.target.value)} className="adm-input h-10 w-auto text-sm" aria-label="Дата заезда" />
            </label>
          )}
          {need.out && (
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold">
              Дата выезда
              <input type="date" value={dateOut} min={minDate} max={today} onChange={(e) => setDateOut(e.target.value)} className="adm-input h-10 w-auto text-sm" aria-label="Дата выезда" />
            </label>
          )}
          <p className="w-full text-[11px] text-ink-muted">Время не ставим: в карточке будет только дата.</p>
          {filled && check?.error && <p className="adm-err w-full">{check.error}</p>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-[11px] text-ink-muted">Запись попадёт в ленту и журнал. Запланированные сообщения клиенту по прежнему статусу будут отменены.</p>
        <button type="submit" disabled={pending || !to || reason.trim().length < 3 || !!check?.error} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Исправить"}</button>
      </div>
      {err && <p className="adm-err mt-1">{err}</p>}
    </form>
  );
}
