"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Scale } from "lucide-react";
import { changePriceAction, decideRecalcAction } from "@/app/admin/actions/bookings";

// Баннер после выезда: факт разошёлся с планом — применить или оставить
export function RecalcBanner({ bookingId, days, actualDays, amount, perDay, stayLabel }: { bookingId: string; days: number; actualDays: number; amount: number; perDay: number; stayLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const newAmount = perDay > 0 ? actualDays * perDay : amount;
  const delta = newAmount - amount;
  const decide = (apply: boolean) => start(async () => { const r = await decideRecalcAction(bookingId, apply); if (!r.ok) setErr(r.error); else router.refresh(); });
  return (
    <div className="mx-5 mb-4 rounded-xl border border-warning/50 bg-warning/8 p-4">
      <div className="flex items-start gap-2">
        <Scale size={16} className="mt-0.5 shrink-0 text-[#8a5a00]" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Стоянка по факту: {stayLabel} → {actualDays} сут. (по плану {days})</div>
          <div className="mt-0.5 font-mono tnum">
            {delta > 0 ? `Доплата ${delta.toLocaleString("ru-RU")} ₽` : delta < 0 ? `Переплата ${Math.abs(delta).toLocaleString("ru-RU")} ₽` : "Сумма не меняется"} · итого {newAmount.toLocaleString("ru-RU")} ₽ вместо {amount.toLocaleString("ru-RU")} ₽
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={pending} onClick={() => decide(true)} className="adm-btn-primary h-9 px-3 text-sm">Пересчитать по факту</button>
            <button disabled={pending} onClick={() => decide(false)} className="adm-btn h-9 px-3 text-sm">Оставить по плану</button>
          </div>
          {err && <p className="adm-err mt-1">{err}</p>}
        </div>
      </div>
    </div>
  );
}

export function ChangePrice({ bookingId, amount }: { bookingId: string; amount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(amount));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button onClick={() => { setValue(String(amount)); setOpen(true); }} className="adm-btn-ghost h-9 gap-1 px-2.5 text-xs text-ink-muted"><Pencil size={12} /> Изменить цену</button>;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setErr(null); start(async () => { const r = await changePriceAction(bookingId, Number(value), reason); if (!r.ok) setErr(r.error); else { setOpen(false); setReason(""); router.refresh(); } }); }}
      className="mt-2 grid gap-2 rounded-lg border border-line bg-surface-soft p-3 sm:grid-cols-[7rem_1fr_auto_auto]"
    >
      <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="adm-input h-10 font-mono" aria-label="Новая сумма" autoFocus />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (обязательно): скидка постоянному клиенту…" className="adm-input h-10 text-sm" aria-label="Причина" maxLength={200} />
      <button type="submit" disabled={pending || !value || reason.trim().length < 3} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Сохранить"}</button>
      <button type="button" onClick={() => setOpen(false)} className="adm-btn-ghost h-10 px-3 text-sm">Отмена</button>
      {err && <p className="adm-err sm:col-span-4">{err}</p>}
    </form>
  );
}
