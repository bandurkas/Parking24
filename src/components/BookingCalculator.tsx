"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Car, ChevronDown, MessageCircle, Phone } from "lucide-react";
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

const COUNTRIES = [
  { code: "RU", dial: "+7", flag: "🇷🇺" },
  { code: "BY", dial: "+375", flag: "🇧🇾" },
  { code: "KZ", dial: "+7", flag: "🇰🇿" },
  { code: "AM", dial: "+374", flag: "🇦🇲" },
  { code: "AZ", dial: "+994", flag: "🇦🇿" },
  { code: "GE", dial: "+995", flag: "🇬🇪" },
  { code: "KG", dial: "+996", flag: "🇰🇬" },
  { code: "UZ", dial: "+998", flag: "🇺🇿" },
  { code: "TJ", dial: "+992", flag: "🇹🇯" },
  { code: "TR", dial: "+90", flag: "🇹🇷" },
];

// 900 000-00-00 — группировка под 10-значные номера, лишнее просто цифрами
function fmtPhone(digits: string): string {
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 8);
  const d = digits.slice(8);
  let out = a;
  if (b) out += ` ${b}`;
  if (c) out += `-${c}`;
  if (d) out += `-${d}`;
  return out;
}

const fieldCls =
  "h-12 w-full rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/25";

export default function BookingCalculator() {
  const [dateIn, setDateIn] = useState(todayPlus(1));
  const [dateOut, setDateOut] = useState(todayPlus(8));
  const [vehicle, setVehicle] = useState(VEHICLE_TYPES[0].id);
  const [country, setCountry] = useState("RU");
  const [phone, setPhone] = useState("");

  const days = useMemo(() => daysBetween(dateIn, dateOut), [dateIn, dateOut]);
  const price = useMemo(() => calcPrice(vehicle, days), [vehicle, days]);
  const vehicleLabel =
    VEHICLE_TYPES.find((t) => t.id === vehicle)?.label ?? "";
  const dial = COUNTRIES.find((c) => c.code === country)?.dial ?? "+7";

  // TODO: заменить на визард /booking с онлайн-оплатой (ЮKassa), когда модуль будет готов.
  const waText = encodeURIComponent(
    `Здравствуйте! Хочу забронировать место: ${vehicleLabel.toLowerCase()}, заезд ${dateIn}, выезд ${dateOut} (${days} ${plural(days, "сутки", "суток", "суток")}).` +
      (phone.length >= 7 ? ` Мой телефон: ${dial} ${fmtPhone(phone)}.` : "")
  );
  const waHref = `https://wa.me/${WHATSAPP}?text=${waText}`;

  return (
    <div
      id="booking"
      className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card-lg ring-1 ring-line"
    >
      <h2 className="text-xl font-semibold text-ink">Бронирование места</h2>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block min-w-0">
          <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-muted">
            <CalendarDays className="size-4 shrink-0" aria-hidden />
            Дата заезда
          </span>
          <input
            type="date"
            value={dateIn}
            min={todayPlus(0)}
            onChange={(e) => setDateIn(e.target.value)}
            className={`${fieldCls} tnum min-w-0`}
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-muted">
            <CalendarDays className="size-4 shrink-0" aria-hidden />
            Дата выезда
          </span>
          <input
            type="date"
            value={dateOut}
            min={dateIn}
            onChange={(e) => setDateOut(e.target.value)}
            className={`${fieldCls} tnum min-w-0`}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-muted">
          <Car className="size-4 shrink-0" aria-hidden />
          Тип авто
        </span>
        <span className="relative block">
          <select
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            className={`${fieldCls} cursor-pointer appearance-none pr-9`}
          >
            {VEHICLE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} — {t.perDay} ₽/сутки
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
        </span>
      </label>

      <label className="mt-3 block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-muted">
          <Phone className="size-4 shrink-0" aria-hidden />
          Телефон
        </span>
        <span className="flex gap-2">
          <span className="relative block shrink-0">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              aria-label="Код страны"
              className={`${fieldCls} w-28 cursor-pointer appearance-none pl-2.5 pr-7`}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.dial}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
          </span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={fmtPhone(phone)}
            onChange={(e) =>
              setPhone(e.target.value.replace(/\D/g, "").slice(0, 12))
            }
            placeholder="900 000-00-00"
            className={`${fieldCls} tnum min-w-0 flex-1`}
          />
        </span>
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
      <p className="mt-1.5 text-center text-[11px] leading-snug text-ink-muted">
        Нажимая «Забронировать место», вы соглашаетесь с{" "}
        <a href="/policy" className="underline">
          политикой обработки персональных данных
        </a>
        .
      </p>
    </div>
  );
}
