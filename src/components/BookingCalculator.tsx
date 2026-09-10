"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Car, Check, ChevronDown, Clock, MessageCircle, Phone, ShieldCheck, User, Wallet } from "lucide-react";
import { billingPeriods, DEFAULT_TIME, TIME_OPTIONS } from "@/lib/periods";
import ChannelPicker, { ChannelLogo } from "./ChannelPicker";
import { VEHICLE_TYPES, CHANNEL_NAME, PHONE, PHONE_HREF, messengerHref, type SiteChannel, calcPrice, formatRub, plural } from "@/lib/tariffs";

const RU_DATE = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
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
  "h-12 w-full rounded-xl border border-line bg-surface-soft px-3 text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-60";
const badCls = "border-danger ring-2 ring-danger/20";
const labelCls = "mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink";

type LeadState = { status: "idle" | "sending" | "ok" | "error"; number?: number; duplicate?: boolean };

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

function StepBadge({ n, state }: { n: number; state: "done" | "active" | "todo" }) {
  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold transition-colors duration-300 ${
        state === "done" ? "bg-success text-white" : state === "active" ? "bg-primary text-ink" : "bg-surface text-ink-muted"
      }`}
      aria-hidden
    >
      {state === "done" ? <Check className="size-4" strokeWidth={3} /> : n}
    </span>
  );
}

function StepHead({ n, state, title, hint }: { n: number; state: "done" | "active" | "todo"; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <StepBadge n={n} state={state} />
      <div className="min-w-0">
        <div className={`text-[15px] font-semibold leading-tight ${state === "todo" ? "text-ink-muted" : "text-ink"}`}>{title}</div>
        {hint && <div className="text-xs text-ink-muted">{hint}</div>}
      </div>
    </div>
  );
}

export default function BookingCalculator() {
  const [dateIn, setDateIn] = useState("");
  const [dateOut, setDateOut] = useState("");
  const [timeIn, setTimeIn] = useState(DEFAULT_TIME);
  const [timeOut, setTimeOut] = useState(DEFAULT_TIME);
  const [vehicle, setVehicle] = useState(VEHICLE_TYPES[0].id);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("RU");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [channel, setChannel] = useState<SiteChannel | null>("WHATSAPP");
  const [attempted, setAttempted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [lead, setLead] = useState<LeadState>({ status: "idle" });
  const mountedAt = useRef(0);
  const utm = useRef<Record<string, string>>({});
  const dateInRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedAt.current = Date.now();
    utm.current = collectUtm();
  }, []);

  const isTruck = vehicle === "truck";
  const datesChosen = !!dateIn && !!dateOut;
  const days = useMemo(() => (datesChosen ? billingPeriods(dateIn, dateOut, timeIn, timeOut) : 0), [datesChosen, dateIn, dateOut, timeIn, timeOut]);
  const datesInvalid = datesChosen && days <= 0;
  const priceReady = datesChosen && !datesInvalid;
  const price = useMemo(() => calcPrice(vehicle, days), [vehicle, days]);
  const cc = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];
  const dial = cc.dial;
  const nameMissing = name.trim().length === 0;
  const phoneBad = phone.length !== cc.len;
  const contactsDone = !nameMissing && !phoneBad;
  const showNameErr = attempted && nameMissing;
  const showPhoneErr = (attempted || (phoneTouched && phone.length > 0)) && phoneBad;
  const showChannelErr = attempted && !channel;

  // Шаг 2 раскрывается, когда появилась цена, и больше не прячется
  if (priceReady && !revealed) setRevealed(true);

  const vehicleLabel = isTruck ? "грузовой транспорт" : (VEHICLE_TYPES.find((t) => t.id === vehicle)?.label ?? "").toLowerCase();
  const target: SiteChannel = channel ?? "WHATSAPP";
  const targetName = CHANNEL_NAME[target];

  function submit() {
    if (lead.status === "sending") return;
    if (!priceReady) {
      dateInRef.current?.focus();
      dateInRef.current?.showPicker?.();
      return;
    }
    if (nameMissing || phoneBad || !channel) {
      setAttempted(true);
      (nameMissing ? nameRef : phoneRef).current?.focus();
      return;
    }
    setLead({ status: "sending" });
    fetch("/api/public/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ dateFrom: dateIn, dateTo: dateOut, timeFrom: timeIn, timeTo: timeOut, name: name.trim(), vehicleType: vehicle, phone, dial, channels: [channel], primary: channel, utm: utm.current, website: "", ts: mountedAt.current }),
    })
      .then((r) => r.json())
      .then((j: { ok?: boolean; number?: number; duplicate?: boolean }) => {
        setLead(j?.ok ? { status: "ok", number: j.number, duplicate: j.duplicate } : { status: "error" });
        cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      })
      .catch(() => setLead({ status: "error" }));
  }

  // Ссылка-запасной ход: клиент сам пишет нам со ссылкой на номер заявки (если сообщение не пришло)
  const fallbackText =
    `Заявка${lead.number ? ` №${lead.number}` : ""} с сайта${name.trim() ? `, ${name.trim()}` : ""}: ${vehicleLabel}, ` +
    (datesChosen ? `${ruDate(dateIn)} ${timeIn} → ${ruDate(dateOut)} ${timeOut}` : "") +
    (isTruck ? ". Подскажите цену для грузового транспорта." : ".");
  const fallbackHref = messengerHref(target, fallbackText);
  const phonePretty = `${dial} ${fmtPhone(phone)}`;

  if (lead.status === "ok") {
    const steps = [
      { icon: ShieldCheck, title: "Администратор проверяет место", hint: "Обычно 5–10 минут", now: true },
      { icon: MessageCircle, title: `Подтверждение придёт в ${targetName}`, hint: `на ${phonePretty}` },
      { icon: Wallet, title: "Оплата после подтверждения", hint: "Пришлём способ оплаты в том же сообщении" },
    ];
    return (
      <div ref={cardRef} id="booking" className="w-full max-w-md scroll-mt-20 rounded-2xl bg-white p-6 shadow-card-lg ring-1 ring-line" role="status" aria-live="polite">
        <div className="flex items-start gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success/12 text-success animate-[pop-in_.45s_cubic-bezier(.2,.9,.3,1.3)_both]">
            <Check className="size-6" strokeWidth={3} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight text-ink">
              {lead.duplicate ? "Заявка уже у администратора" : "Заявка принята"}
              {lead.number ? <span className="tnum text-ink-muted"> · №{lead.number}</span> : null}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">Ничего писать не нужно — мы напишем вам сами.</p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-surface-soft px-4 py-3 text-sm">
          <dt className="text-ink-muted">Даты</dt>
          <dd className="tnum font-medium text-ink">{ruDate(dateIn)}, {timeIn} → {ruDate(dateOut)}, {timeOut}</dd>
          <dt className="text-ink-muted">Авто</dt>
          <dd className="font-medium text-ink">{isTruck ? "Грузовой транспорт" : VEHICLE_TYPES.find((t) => t.id === vehicle)?.label}</dd>
          <dt className="text-ink-muted">Сумма</dt>
          <dd className="tnum font-semibold text-primary-dark">{isTruck ? "по запросу" : `${formatRub(price)} за ${days} ${plural(days, "сутки", "суток", "суток")}`}</dd>
        </dl>

        <ol className="mt-5 grid gap-0">
          {steps.map((s, i) => (
            <li key={s.title} className="relative flex gap-3.5 pb-4 last:pb-0 animate-[board-in_.4s_ease_both]" style={{ animationDelay: `${120 + i * 90}ms` }}>
              {i < steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-0.5 bg-line" aria-hidden />}
              <span className={`relative grid size-8 shrink-0 place-items-center rounded-full ${s.now ? "bg-primary text-ink" : "bg-surface text-ink-muted"}`}>
                {s.now && <span className="absolute inset-0 rounded-full bg-primary/50 animate-ping [animation-duration:1.8s]" aria-hidden />}
                <s.icon className="relative size-4" aria-hidden />
              </span>
              <div className="min-w-0 pt-1">
                <div className={`text-[15px] font-semibold leading-tight ${s.now ? "text-ink" : "text-ink/80"}`}>{s.title}</div>
                <div className="text-sm text-ink-muted">{s.hint}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
          <a href={fallbackHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary-deep underline-offset-2 hover:underline">
            <ChannelLogo c={target} className="size-4" /> Не хотите ждать? Написать в {targetName}
          </a>
          <button type="button" onClick={() => setLead({ status: "idle" })} className="text-ink-muted underline-offset-2 hover:text-ink hover:underline">
            Изменить заявку
          </button>
        </div>
      </div>
    );
  }

  const step1 = priceReady ? "done" : "active";
  const step2 = !revealed ? "todo" : contactsDone && channel ? "done" : "active";

  return (
    <div ref={cardRef} id="booking" className="w-full max-w-md scroll-mt-20 rounded-2xl bg-white p-6 shadow-card-lg ring-1 ring-line">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Бронирование места</h2>
        <span className="hidden text-xs font-medium text-ink-muted sm:block">Без предоплаты</span>
      </div>

      {/* Шаг 1 — даты и авто */}
      <section className="mt-5" aria-labelledby="bk-step1">
        <div id="bk-step1"><StepHead n={1} state={step1} title="Даты и авто" /></div>
        <div className="mt-3 grid gap-3 border-l-2 border-line pl-4 [margin-left:0.8125rem]">
          <div className="min-w-0">
            <span className={labelCls}><CalendarDays className="size-4 shrink-0 text-steel" aria-hidden />Заезд</span>
            <div className="grid grid-cols-[minmax(8.5rem,1fr)_5.75rem] gap-1.5">
              <input ref={dateInRef} type="date" value={dateIn} min={todayPlus(0)} onChange={(e) => setDateIn(e.target.value)} aria-label="Дата заезда" className={`${fieldCls} tnum min-w-0 px-2`} />
              <span className="relative block">
                <select value={timeIn} onChange={(e) => setTimeIn(e.target.value)} aria-label="Время заезда" className={`${fieldCls} tnum cursor-pointer appearance-none pl-2 pr-6`}>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Clock className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" aria-hidden />
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <span className={labelCls}><CalendarDays className="size-4 shrink-0 text-steel" aria-hidden />Выезд</span>
            <div className="grid grid-cols-[minmax(8.5rem,1fr)_5.75rem] gap-1.5">
              <input type="date" value={dateOut} min={dateIn || todayPlus(0)} aria-invalid={datesInvalid} onChange={(e) => setDateOut(e.target.value)} aria-label="Дата выезда" className={`${fieldCls} tnum min-w-0 px-2 ${datesInvalid ? badCls : ""}`} />
              <span className="relative block">
                <select value={timeOut} onChange={(e) => setTimeOut(e.target.value)} aria-label="Время выезда" className={`${fieldCls} tnum cursor-pointer appearance-none pl-2 pr-6`}>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Clock className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" aria-hidden />
              </span>
            </div>
            {datesInvalid && <p className="mt-1.5 text-sm font-medium text-danger" role="alert">Дата выезда должна быть позже даты заезда.</p>}
          </div>
          <label className="block min-w-0">
            <span className={labelCls}><Car className="size-4 shrink-0 text-steel" aria-hidden />Тип авто</span>
            <span className="relative block">
              <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={`${fieldCls} cursor-pointer appearance-none pr-9`}>
                {VEHICLE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.perDay} ₽/сутки</option>)}
                <option value="truck">Грузовая / фура / автобус — по запросу</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            </span>
          </label>
        </div>
      </section>

      {/* Талон стоимости: перфорация как у посадочного — цена появляется после дат */}
      <div className="relative -mx-6 mt-5 border-y border-dashed border-line bg-surface-soft px-6 py-3.5">
        <span className="absolute -left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-white ring-1 ring-line [clip-path:inset(0_0_0_50%)]" aria-hidden />
        <span className="absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-white ring-1 ring-line [clip-path:inset(0_50%_0_0)]" aria-hidden />
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div className="text-sm font-medium text-ink-muted">
            <span className="whitespace-nowrap">Стоимость стоянки</span>
            {priceReady && isTruck && <div className="text-xs">зависит от габаритов — ответим за пару минут</div>}
          </div>
          <div className="tnum text-right leading-none" aria-live="polite">
            {priceReady ? (
              <span key={`${price}-${isTruck}`} className={`block font-bold text-primary-dark animate-[price-in_.35s_ease-out_both] ${isTruck ? "text-xl" : "text-[2rem]"}`}>
                {isTruck ? "по запросу" : formatRub(price)}
              </span>
            ) : (
              <span className="whitespace-nowrap text-sm font-medium text-ink-muted">после выбора дат</span>
            )}
          </div>
        </div>
      </div>

      {/* Шаг 2 — контакты и канал: раскрывается после цены */}
      <section className="mt-5" aria-labelledby="bk-step2">
        <div id="bk-step2"><StepHead n={2} state={step2} title="Куда прислать подтверждение" hint={revealed ? undefined : "Заполните после выбора дат"} /></div>
        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${revealed ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]"}`} aria-hidden={!revealed}>
          <div className="min-h-0 overflow-hidden">
            <div className="mt-3 grid gap-3 border-l-2 border-line pl-4 [margin-left:0.8125rem]">
              <label className="block">
                <span className={labelCls}><User className="size-4 shrink-0 text-steel" aria-hidden />Как к вам обращаться</span>
                <input ref={nameRef} type="text" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoComplete="given-name" placeholder="Иван" tabIndex={revealed ? 0 : -1} aria-invalid={showNameErr} className={`${fieldCls} ${showNameErr ? badCls : ""}`} />
                {showNameErr && <p className="mt-1.5 text-sm font-medium text-danger" role="alert">Напишите имя — так мы обратимся к вам в сообщении.</p>}
              </label>
              <div>
                <span className={labelCls}><Phone className="size-4 shrink-0 text-steel" aria-hidden />Телефон</span>
                <span className="flex gap-2">
                  <span className="relative block shrink-0">
                    <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Код страны" tabIndex={revealed ? 0 : -1} className={`${fieldCls} w-28 cursor-pointer appearance-none pl-2.5 pr-7`}>
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                  </span>
                  <input ref={phoneRef} type="tel" inputMode="tel" autoComplete="tel-national" value={fmtPhone(phone)} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 12))} onBlur={() => setPhoneTouched(true)} placeholder="900 000-00-00" tabIndex={revealed ? 0 : -1} aria-invalid={showPhoneErr} className={`${fieldCls} tnum min-w-0 flex-1 ${showPhoneErr ? badCls : ""}`} />
                </span>
                {showPhoneErr ? (
                  <p className="mt-1.5 text-sm font-medium text-danger" role="alert">
                    {phone.length === 0 ? "Нужен номер — на него придёт подтверждение." : `В номере должно быть ${cc.len} цифр после ${dial} — сейчас ${phone.length}.`}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-ink-muted">На этот номер придёт подтверждение. Звонить не будем без необходимости.</p>
                )}
              </div>
              <div>
                <span className={labelCls}><MessageCircle className="size-4 shrink-0 text-steel" aria-hidden />Мессенджер для ответа</span>
                <ChannelPicker value={channel} onChange={setChannel} invalid={showChannelErr} />
                {showChannelErr && <p className="mt-1.5 text-sm font-medium text-danger" role="alert">Выберите, куда прислать подтверждение.</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {lead.status === "error" && (
        <div className="mt-5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm" role="alert">
          <div className="font-semibold text-danger">Заявка не дошла до администратора</div>
          <div className="mt-0.5 text-ink">
            Попробуйте ещё раз или{" "}
            <a href={fallbackHref} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-deep underline">напишите нам в {targetName}</a>
            {" "}— или позвоните <a href={PHONE_HREF} className="tnum font-medium underline">{PHONE}</a>.
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        aria-busy={lead.status === "sending"}
        className={`mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition-[background-color,color,transform] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.99] ${
          priceReady ? "bg-cta text-ink hover:bg-cta-dark" : "bg-surface text-ink-muted hover:bg-line"
        } ${lead.status === "sending" ? "cursor-wait opacity-70" : ""}`}
      >
        {lead.status === "sending" ? (
          <>
            <span className="size-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" aria-hidden />
            Отправляем…
          </>
        ) : priceReady ? (
          <>
            <ChannelLogo c={target} className="size-5" />
            {lead.status === "error" ? "Отправить ещё раз" : "Забронировать место"}
          </>
        ) : (
          <>
            <CalendarDays className="size-5" aria-hidden />
            Выберите даты
          </>
        )}
      </button>
      <p className="mt-2.5 text-center text-xs text-ink-muted">
        {priceReady
          ? `Заявка уйдёт администратору. Подтверждение придёт в ${targetName} за несколько минут, оплата — после него.`
          : "Цена появится сразу, без звонков и предоплаты."}
      </p>
      <p className="mt-1.5 text-center text-[11px] leading-snug text-ink-muted">
        Нажимая «Забронировать место», вы соглашаетесь с{" "}
        <a href="/policy" className="underline">политикой обработки персональных данных</a>.
      </p>
    </div>
  );
}
