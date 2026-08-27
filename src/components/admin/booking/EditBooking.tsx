"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { BookingSource, VehicleType } from "@prisma/client";
import { quoteAction, updateBookingAction, type Quote } from "@/app/admin/actions/bookings";
import { SOURCE_LABEL, VEHICLE_LABEL } from "@/lib/crm/labels";

type B = { id: string; name: string; plate: string; vehicleType: VehicleType | null; dateFrom: string; dateTo: string; timeFrom: string; timeTo: string; amount: number; transferNeeded: boolean; source: BookingSource; comment: string };
const VTS: VehicleType[] = ["CAR", "SUV", "MOTO", "TRUCK"];
const SOURCES: BookingSource[] = ["SITE", "CALL", "WHATSAPP", "TELEGRAM", "TWO_GIS", "INSTAGRAM", "ADS", "BUSINESS_CARD", "REFERRAL", "OTHER"];

export default function EditBooking({ booking }: { booking: B }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(booking);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof B>(k: K, v: B[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!open || !f.vehicleType) return;
    const t = setTimeout(() => quoteAction("PARKING", f.dateFrom, f.dateTo, f.vehicleType!, undefined, booking.id).then(setQuote), 200);
    return () => clearTimeout(t);
  }, [open, f.dateFrom, f.dateTo, f.vehicleType, booking.id]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateBookingAction({ bookingId: booking.id, ...f, vehicleType: f.vehicleType ?? undefined });
      if (!res.ok) return setErrors(res.fieldErrors ?? { _: res.error });
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="border-t border-line px-5 py-3">
        <button onClick={() => { setF(booking); setOpen(true); }} className="adm-btn-ghost h-9 gap-2 px-3 text-sm"><Pencil size={14} /> Изменить бронь</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line bg-surface-soft px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="adm-label">Имя</label>
          <input value={f.name} onChange={(e) => set("name", e.target.value)} className="adm-input h-10" />
        </div>
        <div>
          <label className="adm-label">Госномер</label>
          <input value={f.plate} onChange={(e) => set("plate", e.target.value.toUpperCase())} className="adm-input h-10 font-mono uppercase" />
        </div>
        <div>
          <label className="adm-label">Даты</label>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={f.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} className="adm-input h-10 font-mono text-sm" />
            <input type="date" value={f.dateTo} onChange={(e) => set("dateTo", e.target.value)} className="adm-input h-10 font-mono text-sm" aria-invalid={!!errors.dateTo} />
          </div>
          {errors.dateTo && <p className="adm-err">{errors.dateTo}</p>}
          {quote && <p className="mt-1 text-xs text-ink-muted">{quote.days} сут. · по тарифу {quote.amount.toLocaleString("ru-RU")} ₽ · свободно {quote.minFree}/{quote.capacity}</p>}
        </div>
        <div>
          <label className="adm-label">Время заезда / выезда</label>
          <div className="grid grid-cols-2 gap-2">
            <input type="time" value={f.timeFrom} onChange={(e) => set("timeFrom", e.target.value)} className="adm-input h-10 font-mono text-sm" />
            <input type="time" value={f.timeTo} onChange={(e) => set("timeTo", e.target.value)} className="adm-input h-10 font-mono text-sm" />
          </div>
        </div>
        <div>
          <label className="adm-label">Тип ТС</label>
          <select value={f.vehicleType ?? ""} onChange={(e) => set("vehicleType", e.target.value as VehicleType)} className="adm-input h-10 text-sm">
            {VTS.map((v) => <option key={v} value={v}>{VEHICLE_LABEL[v]}</option>)}
          </select>
        </div>
        <div>
          <label className="adm-label">Источник</label>
          <select value={f.source} onChange={(e) => set("source", e.target.value as BookingSource)} className="adm-input h-10 text-sm">
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="adm-label">Сумма, ₽</label>
          <div className="flex gap-2">
            <input value={f.amount} onChange={(e) => set("amount", Number(e.target.value.replace(/\D/g, "")) || 0)} inputMode="numeric" className="adm-input h-10 font-mono" />
            {quote && quote.amount !== f.amount && (
              <button type="button" onClick={() => set("amount", quote.amount)} className="adm-btn h-10 whitespace-nowrap px-3 text-xs">по тарифу</button>
            )}
          </div>
        </div>
        <label className="flex h-10 cursor-pointer items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={f.transferNeeded} onChange={(e) => set("transferNeeded", e.target.checked)} className="size-4 accent-primary" /> Трансфер
        </label>
      </div>
      <textarea value={f.comment} onChange={(e) => set("comment", e.target.value)} rows={2} placeholder="Комментарий" className="adm-input h-auto py-2 text-sm" />
      {errors._ && <p className="adm-err">{errors._}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Сохранить"}</button>
        <button type="button" onClick={() => setOpen(false)} className="adm-btn-ghost h-10 px-3 text-sm">Отмена</button>
      </div>
    </form>
  );
}
