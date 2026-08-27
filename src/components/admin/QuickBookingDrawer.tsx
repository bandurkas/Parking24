"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Phone, CalendarDays, Car, Bus, Bike, Truck, Bus as Shuttle, Check, AlertTriangle } from "lucide-react";
import type { BookingSource, VehicleType } from "@prisma/client";
import { createBookingAction, quoteAction, searchClientsAction, type ClientHit, type Quote } from "@/app/admin/actions/bookings";
import { SOURCE_LABEL, VEHICLE_LABEL } from "@/lib/crm/labels";
import { formatPhone } from "@/lib/phone";
import Plate from "./Plate";

const EVT = "p24:quick-booking";
export function openQuickBooking(prefill?: Partial<Prefill>) {
  window.dispatchEvent(new CustomEvent(EVT, { detail: prefill ?? {} }));
}
type Prefill = { phone: string; dateFrom: string; dateTo: string; vehicleType: VehicleType };

const VT: { id: VehicleType; icon: typeof Car }[] = [
  { id: "CAR", icon: Car },
  { id: "SUV", icon: Bus },
  { id: "MOTO", icon: Bike },
  { id: "TRUCK", icon: Truck },
];
const SOURCES: BookingSource[] = ["CALL", "WHATSAPP", "TELEGRAM", "TWO_GIS", "INSTAGRAM", "ADS", "BUSINESS_CARD", "REFERRAL", "OTHER"];

function iso(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function QuickBookingDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [dateFrom, setDateFrom] = useState(iso(0));
  const [dateTo, setDateTo] = useState(iso(7));
  const [timeFrom, setTimeFrom] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("CAR");
  const [plate, setPlate] = useState("");
  const [transfer, setTransfer] = useState(false);
  const [source, setSource] = useState<BookingSource>("CALL");
  const [status, setStatus] = useState<"NEW" | "CONFIRMED">("NEW");
  const [comment, setComment] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [amountOverride, setAmountOverride] = useState<string>("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [picked, setPicked] = useState<ClientHit | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ id: string; number: number } | null>(null);
  const [pending, start] = useTransition();
  const phoneRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhone(""); setName(""); setDateFrom(iso(0)); setDateTo(iso(7)); setTimeFrom(""); setVehicleType("CAR"); setPlate("");
    setTransfer(false); setSource("CALL"); setStatus("NEW"); setComment(""); setQuote(null); setAmountOverride(""); setHits([]); setPicked(null); setErrors({});
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<Partial<Prefill>>).detail;
      reset();
      if (d.phone) setPhone(d.phone);
      if (d.dateFrom) setDateFrom(d.dateFrom);
      if (d.dateTo) setDateTo(d.dateTo);
      if (d.vehicleType) setVehicleType(d.vehicleType);
      setOpen(true);
      setTimeout(() => phoneRef.current?.focus(), 50);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable;
      if (!typing && (e.key === "n" || e.key === "N" || e.key === "т" || e.key === "Т") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openQuickBooking();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener(EVT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(EVT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [reset]);

  // Поиск клиента по телефону
  useEffect(() => {
    if (!open) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 4 || picked) { setHits([]); return; }
    const t = setTimeout(() => searchClientsAction(phone).then(setHits), 250);
    return () => clearTimeout(t);
  }, [phone, open, picked]);

  // Цена + занятость
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => quoteAction("PARKING", dateFrom, dateTo, vehicleType).then(setQuote), 200);
    return () => clearTimeout(t);
  }, [open, dateFrom, dateTo, vehicleType]);

  useEffect(() => {
    if (quote && quote.days >= 4) setTransfer(true);
  }, [quote]);

  const amount = amountOverride !== "" ? Number(amountOverride) : quote?.amount ?? 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    start(async () => {
      const res = await createBookingAction({
        kind: "PARKING", phone, name, dateFrom, dateTo, timeFrom, vehicleType, plate, transferNeeded: transfer, source, status, comment,
        amount: amountOverride !== "" ? Number(amountOverride) : undefined,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? { _: res.error });
        return;
      }
      setToast(res.data);
      setOpen(false);
      router.refresh();
      setTimeout(() => setToast(null), 6000);
    });
  }

  return (
    <>
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-navy-deep px-4 py-3 text-sm text-white shadow-card-lg">
          <Check size={16} className="mr-2 inline text-success" />
          Заявка <span className="font-mono font-bold">№{toast.number}</span> создана ·{" "}
          <a href={`/admin/bookings/${toast.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">открыть</a>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Новая заявка">
          <button aria-label="Закрыть" className="absolute inset-0 bg-navy-deep/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <form onSubmit={submit} className="relative flex h-full w-full max-w-md flex-col bg-white shadow-card-lg">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Парковка</div>
                <h2 className="text-lg font-bold">Новая заявка</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="adm-btn-ghost size-10 rounded-full p-0" aria-label="Закрыть">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {/* 1. Телефон */}
              <div>
                <label className="adm-label"><Phone size={13} /> Телефон</label>
                <input
                  ref={phoneRef}
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setPicked(null); }}
                  inputMode="tel"
                  placeholder="+7 9xx xxx-xx-xx"
                  className="adm-input font-mono text-base"
                  aria-invalid={!!errors.phone}
                />
                {errors.phone && <p className="adm-err">{errors.phone}</p>}
                {hits.length > 0 && (
                  <ul className="mt-1 overflow-hidden rounded-lg border border-line bg-white shadow-card">
                    {hits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPicked(h); setPhone(h.phone); setName(h.name ?? "");
                            const v = h.vehicles[0];
                            if (v) { setPlate(v.plate ?? ""); setVehicleType(v.type); }
                            setHits([]);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-soft"
                        >
                          <span>
                            <span className="font-semibold">{h.name ?? "Без имени"}</span>
                            <span className="ml-2 font-mono text-ink-muted">{formatPhone(h.phone)}</span>
                          </span>
                          <span className="flex items-center gap-2 text-xs text-ink-muted">
                            {h.vehicles[0]?.plate && <Plate plate={h.vehicles[0].plate} size="sm" />}
                            {h.bookings} бр.
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {picked && (
                  <p className="mt-1 text-xs text-success">
                    Постоянный клиент · {picked.bookings} {picked.bookings === 1 ? "бронь" : "броней"}
                  </p>
                )}
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя (необязательно)" className="adm-input mt-2" />
              </div>

              {/* 2. Даты */}
              <div>
                <label className="adm-label"><CalendarDays size={13} /> Даты</label>
                <div className="grid grid-cols-[1fr_1fr_5rem] gap-2">
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="adm-input font-mono text-sm" aria-label="Заезд" />
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="adm-input font-mono text-sm" aria-label="Выезд" aria-invalid={!!errors.dateTo} />
                  <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className="adm-input px-2 font-mono text-sm" aria-label="Время заезда" />
                </div>
                {errors.dateTo && <p className="adm-err">{errors.dateTo}</p>}
                {quote && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {quote.days} сут. ·{" "}
                    {quote.capacity > 0 ? (
                      <span className={quote.overbooked ? "font-semibold text-danger" : quote.minFree <= 3 ? "font-semibold text-warning" : ""}>
                        свободно {quote.minFree} из {quote.capacity}
                        {quote.overbooked && " — перегруз!"}
                      </span>
                    ) : (
                      "ёмкость не задана"
                    )}
                  </p>
                )}
              </div>

              {/* 3. Тип ТС */}
              <div>
                <label className="adm-label"><Car size={13} /> Транспорт</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {VT.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVehicleType(v.id)}
                      className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-xs font-semibold transition ${
                        vehicleType === v.id ? "border-primary bg-primary-soft text-primary-deep" : "border-line bg-white text-ink-muted hover:border-steel"
                      }`}
                    >
                      <v.icon size={18} />
                      {VEHICLE_LABEL[v.id]}
                    </button>
                  ))}
                </div>
                <input
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                  placeholder="Госномер: А123ВС77"
                  className="adm-input mt-2 font-mono text-base uppercase tracking-wider"
                  maxLength={12}
                />
              </div>

              {/* 4. Трансфер, источник, статус */}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm">
                  <input type="checkbox" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} className="size-4 accent-primary" />
                  <Shuttle size={15} className="text-steel" /> Трансфер
                </label>
                <select value={source} onChange={(e) => setSource(e.target.value as BookingSource)} className="adm-input text-sm">
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1.5 rounded-lg bg-surface p-1">
                {(["NEW", "CONFIRMED"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`h-9 flex-1 rounded-md text-sm font-semibold transition ${status === s ? "bg-white shadow-card" : "text-ink-muted"}`}
                  >
                    {s === "NEW" ? "Заявка" : "Сразу подтвердить"}
                  </button>
                ))}
              </div>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий" rows={2} className="adm-input h-auto py-2 text-sm" />
              {errors._ && (
                <p className="flex items-center gap-2 rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger"><AlertTriangle size={15} /> {errors._}</p>
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-line px-5 py-4">
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-wide text-ink-muted">К оплате</div>
                <div className="flex items-baseline gap-1 font-mono">
                  <input
                    value={amountOverride !== "" ? amountOverride : quote?.amount ?? ""}
                    onChange={(e) => setAmountOverride(e.target.value.replace(/\D/g, ""))}
                    className="w-24 border-b border-dashed border-steel bg-transparent text-2xl font-bold outline-none focus:border-primary"
                    inputMode="numeric"
                    aria-label="Сумма"
                  />
                  <span className="text-lg font-bold">₽</span>
                  {quote && quote.perDay > 0 && amountOverride === "" && <span className="ml-1 text-xs text-ink-muted">{quote.perDay} ₽/сут</span>}
                </div>
              </div>
              <button type="submit" disabled={pending || !phone} className="adm-btn-primary min-w-36">
                {pending ? "Создаём…" : status === "CONFIRMED" ? "Подтвердить" : "Создать"}
              </button>
            </div>
            <span className="sr-only">{amount}</span>
          </form>
        </div>
      )}
    </>
  );
}
