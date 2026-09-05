"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Car, ChevronDown, MessageCircle, Phone } from "lucide-react";
import ChannelPicker from "./ChannelPicker";
import {
  VEHICLE_TYPES,
  CHANNEL_NAME,
  messengerHref,
  type SiteChannel,
  calcPrice,
  daysBetween,
  formatRub,
  plural,
  FREE_TRANSFER_MIN_DAYS,
} from "@/lib/tariffs";

const RU_DATE = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
function ruDate(iso: string): string {
  return RU_DATE.format(new Date(iso + "T00:00:00"));
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// len — число цифр национального номера
const COUNTRIES = [
  { code: "RU", dial: "+7", flag: "🇷🇺", len: 10 },
  { code: "BY", dial: "+375", flag: "🇧🇾", len: 9 },
  { code: "KZ", dial: "+7", flag: "🇰🇿", len: 10 },
  { code: "AM", dial: "+374", flag: "🇦🇲", len: 8 },
  { code: "AZ", dial: "+994", flag: "🇦🇿", len: 9 },
  { code: "GE", dial: "+995", flag: "🇬🇪", len: 9 },
  { code: "KG", dial: "+996", flag: "🇰🇬", len: 9 },
  { code: "UZ", dial: "+998", flag: "🇺🇿", len: 9 },
  { code: "TJ", dial: "+992", flag: "🇹🇯", len: 9 },
  { code: "TR", dial: "+90", flag: "🇹🇷", len: 10 },
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
  "h-12 w-full rounded-xl border border-line bg-surface-soft px-3 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/25";

type LeadState = { status: "idle" | "sending" | "ok" | "error"; number?: number };

// utm_* из адреса + реферер + страница — источник заявки в CRM
function collectUtm(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const sp = new URLSearchParams(window.location.search);
    for (const [k, v] of sp) if (k.startsWith("utm_") && v) out[k] = v.slice(0, 200);
    if (document.referrer) out.ref = document.referrer.slice(0, 200);
    out.page = window.location.pathname.slice(0, 200);
  } catch {}
  return out;
}

export default function BookingCalculator() {
  const [dateIn, setDateIn] = useState(todayPlus(1));
  const [dateOut, setDateOut] = useState(todayPlus(8));
  const [vehicle, setVehicle] = useState(VEHICLE_TYPES[0].id);
  const [country, setCountry] = useState("RU");
  const [phone, setPhone] = useState("");
  const [lead, setLead] = useState<LeadState>({ status: "idle" });
  const [channels, setChannels] = useState<SiteChannel[]>(["WHATSAPP"]);
  const [primary, setPrimary] = useState<SiteChannel | null>("WHATSAPP");
  const mountedAt = useRef(0);
  const utm = useRef<Record<string, string>>({});

  useEffect(() => {
    mountedAt.current = Date.now();
    utm.current = collectUtm();
  }, []);

  // Заявка уходит в CRM параллельно с открытием WhatsApp; ссылка работает даже при сбое API.
  function sendLead() {
    if (lead.status === "sending") return;
    setLead({ status: "sending" });
    fetch("/api/public/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ dateFrom: dateIn, dateTo: dateOut, vehicleType: vehicle, phone, dial, channels, primary: primary ?? undefined, utm: utm.current, website: "", ts: mountedAt.current }),
    })
      .then((r) => r.json())
      .then((j: { ok?: boolean; number?: number }) => setLead(j?.ok ? { status: "ok", number: j.number } : { status: "error" }))
      .catch(() => setLead({ status: "error" }));
  }

  const isTruck = vehicle === "truck";
  const days = useMemo(() => daysBetween(dateIn, dateOut), [dateIn, dateOut]);
  const datesInvalid = days <= 0;
  const price = useMemo(() => calcPrice(vehicle, days), [vehicle, days]);
  const vehicleLabel = isTruck
    ? "грузовой транспорт"
    : (VEHICLE_TYPES.find((t) => t.id === vehicle)?.label ?? "").toLowerCase();
  const cc = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];
  const dial = cc.dial;
  const phoneInvalid = phone.length > 0 && phone.length !== cc.len;
  const blocked = datesInvalid || phoneInvalid || !primary;

  // TODO: заменить на визард /booking с онлайн-оплатой (ЮKassa), когда модуль будет готов.
  const msgText =
    `Здравствуйте! Хочу забронировать место: ${vehicleLabel}, заезд ${ruDate(dateIn)}, выезд ${ruDate(dateOut)} (${days} ${plural(days, "сутки", "суток", "суток")}).` +
      (isTruck ? " Подскажите, пожалуйста, цену для грузового транспорта." : "") +
      (phone.length === cc.len ? ` Мой телефон: ${dial} ${fmtPhone(phone)}.` : "") +
      (channels.length > 1 ? ` Со мной можно связаться: ${channels.map((c) => CHANNEL_NAME[c]).join(", ")}.` : "");
  const target: SiteChannel = primary ?? "WHATSAPP";
  const waHref = messengerHref(target, msgText);
  const targetName = CHANNEL_NAME[target];

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
            min={todayPlus(0) > dateIn ? todayPlus(1) : dateIn}
            aria-invalid={datesInvalid}
            onChange={(e) => setDateOut(e.target.value)}
            className={`${fieldCls} tnum min-w-0 ${datesInvalid ? "border-danger ring-2 ring-danger/20" : ""}`}
          />
        </label>
      </div>
      {datesInvalid && (
        <p className="mt-2 text-sm font-medium text-danger" role="alert">
          Дата выезда должна быть позже даты заезда.
        </p>
      )}

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
            <option value="truck">Грузовая / фура / автобус — по запросу</option>
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
          Телефон <span className="font-normal">(необязательно)</span>
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
            aria-invalid={phoneInvalid}
            className={`${fieldCls} tnum min-w-0 flex-1 ${phoneInvalid ? "border-danger ring-2 ring-danger/20" : ""}`}
          />
        </span>
      </label>
      {phoneInvalid && (
        <p className="mt-2 text-sm font-medium text-danger" role="alert">
          В номере должно быть {cc.len} цифр после {dial} — сейчас {phone.length}. Или оставьте поле пустым.
        </p>
      )}

      <div className="mt-5 flex items-end justify-between gap-2">
        <div>
          <div className="tnum text-3xl font-bold text-primary-dark">
            {isTruck ? "по запросу" : days > 0 ? formatRub(price) : "—"}
          </div>
          {days > 0 && !isTruck && (
            <div className="text-sm text-ink-muted">
              за {days} {plural(days, "сутки", "суток", "суток")}
              {days >= FREE_TRANSFER_MIN_DAYS && " · трансфер бесплатно"}
            </div>
          )}
          {isTruck && (
            <div className="text-sm text-ink-muted">
              цена зависит от габаритов — ответим за пару минут
            </div>
          )}
        </div>
        <ChannelPicker channels={channels} primary={primary} onChange={(c, p) => { setChannels(c); setPrimary(p); }} />
      </div>
      {!primary && (
        <p className="mt-2 text-sm font-medium text-danger" role="alert">
          Выберите, куда вам написать.
        </p>
      )}

      <a
        href={blocked ? undefined : waHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={blocked}
        tabIndex={blocked ? -1 : undefined}
        onClick={() => {
          if (!blocked) sendLead();
        }}
        className={`mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[15px] font-semibold text-ink transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          blocked
            ? "pointer-events-none bg-ink-muted/40"
            : "bg-cta hover:bg-cta-dark"
        }`}
      >
        <MessageCircle className="size-5" aria-hidden />
        Забронировать место
      </a>
      <p className="mt-2.5 text-center text-xs text-ink-muted" role="status" aria-live="polite">
        {lead.status === "ok" && lead.number
          ? `Заявка №${lead.number} принята — администратор подтвердит место.`
          : lead.status === "ok"
            ? "Заявка принята — администратор подтвердит место."
            : lead.status === "error"
              ? "Заявка не дошла до администратора — напишите нам в WhatsApp, он уже открыт."
              : `Заявка уйдёт администратору и откроется ${targetName}. Онлайн-оплата скоро появится.`}
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
