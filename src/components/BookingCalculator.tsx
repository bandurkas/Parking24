"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Car, MessageCircle } from "lucide-react";
import {
  VEHICLE_TYPES,
  WHATSAPP,
  calcPrice,
  daysBetween,
  formatRub,
  plural,
  FREE_TRANSFER_MIN_DAYS,
} from "@/lib/tariffs";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function BookingCalculator() {
  const [dateIn, setDateIn] = useState(todayPlus(1));
  const [dateOut, setDateOut] = useState(todayPlus(8));
  const [vehicle, setVehicle] = useState(VEHICLE_TYPES[0].id);

  const days = useMemo(() => daysBetween(dateIn, dateOut), [dateIn, dateOut]);
  const price = useMemo(() => calcPrice(vehicle, days), [vehicle, days]);
  const vehicleLabel =
    VEHICLE_TYPES.find((t) => t.id === vehicle)?.label ?? "";

  // TODO: заменить на визард /booking с онлайн-оплатой (ЮKassa), когда модуль будет готов.
  const waText = encodeURIComponent(
    `Здравствуйте! Хочу забронировать место: ${vehicleLabel.toLowerCase()}, заезд ${dateIn}, выезд ${dateOut} (${days} ${plural(days, "сутки", "суток", "суток")}).`
  );
  const waHref = `https://wa.me/${WHATSAPP}?text=${waText}`;

  return (
    <div
      id="booking"
      className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card-lg ring-1 ring-line"
    >
      <h2 className="text-xl font-semibold text-primary">Бронирование места</h2>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-muted">
            <CalendarDays className="size-4" aria-hidden />
            Дата заезда
          </span>
          <input
            type="date"
            value={dateIn}
            min={todayPlus(0)}
            onChange={(e) => setDateIn(e.target.value)}
            className="h-12 w-full rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-muted">
            <CalendarDays className="size-4" aria-hidden />
            Дата выезда
          </span>
          <input
            type="date"
            value={dateOut}
            min={dateIn}
            onChange={(e) => setDateOut(e.target.value)}
            className="h-12 w-full rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-muted">
          <Car className="size-4" aria-hidden />
          Тип авто
        </span>
        <select
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          className="h-12 w-full cursor-pointer appearance-none rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
        >
          {VEHICLE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} — {t.perDay} ₽/сутки
            </option>
          ))}
        </select>
      </label>

      <div className="mt-5 flex items-end justify-between gap-2">
        <div>
          <div className="tnum text-3xl font-bold text-primary">
            {days > 0 ? formatRub(price) : "—"}
          </div>
          {days > 0 && (
            <div className="text-sm text-ink-muted">
              за {days} {plural(days, "сутки", "суток", "суток")}
              {days >= FREE_TRANSFER_MIN_DAYS && " · трансфер бесплатно"}
            </div>
          )}
        </div>
      </div>

      <a
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <MessageCircle className="size-5" aria-hidden />
        Забронировать место
      </a>
      <p className="mt-2.5 text-center text-xs text-ink-muted">
        Заявка уйдёт в WhatsApp — администратор подтвердит место.
        Онлайн-оплата скоро появится.
      </p>
    </div>
  );
}
