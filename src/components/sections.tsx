import Image from "next/image";
import Link from "next/link";
import {
  Armchair,
  BedDouble,
  Bus,
  Cctv,
  ChevronDown,
  CircleCheck,
  Clock,
  Coffee,
  Luggage,
  MapPin,
  Navigation,
  Phone,
  PlaneTakeoff,
  PlugZap,
  ShieldCheck,
  ShowerHead,
  Star,
  Truck,
  Wallet,
  WashingMachine,
  Wifi,
} from "lucide-react";
import BookingCalculator from "./BookingCalculator";
import MobileMenu from "./MobileMenu";
import MobileCtaBar from "./MobileCtaBar";
import MapFacade from "./MapFacade";
import RoomsSlider from "./RoomsSlider";
import { ROOM_EXTRAS } from "@/lib/rooms";
import {
  ADDRESS,
  PHONE,
  PHONE_HREF,
  TELEGRAM,
  WHATSAPP,
} from "@/lib/tariffs";

const NAV = [
  { href: "/#tariffs", label: "Тарифы" },
  { href: "/rooms", label: "Комнаты отдыха" },
  { href: "/#gallery", label: "Наша стоянка" },
  { href: "/#directions", label: "Как добраться" },
  { href: "/#faq", label: "Частые вопросы" },
  { href: "/#contacts", label: "Контакты" },
];

function Logo({ dark = false, compactLg = false }: { dark?: boolean; compactLg?: boolean }) {
  return (
    <span className="flex items-center gap-3 lg:gap-2.5">
      {dark ? (
        <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 p-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/emblem-white.svg" alt="" aria-hidden className="size-full" />
        </span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src="/brand/emblem-color.svg" alt="" className="h-14 w-auto lg:h-12" />
      )}
      <span
        className={`flex flex-col whitespace-nowrap uppercase leading-none ${compactLg ? "lg:max-xl:hidden" : ""}`}
      >
        <span className={`text-[18px] font-extrabold tracking-[0.03em] lg:text-[17px] ${dark ? "text-white" : "text-ink"}`}>
          Паркинг <span className={dark ? "text-primary" : "text-primary-dark"}>24</span>
        </span>
        <span className={`mt-[5px] text-[12px] font-bold tracking-[0.16em] lg:mt-1 lg:text-[11.5px] ${dark ? "text-white/75" : "text-[#3E4452]"}`}>
          Питстоп
        </span>
      </span>
    </span>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          aria-label="Паркинг 24 Питстоп — на главную"
          className="shrink-0"
        >
          <Logo compactLg />
        </Link>
        <nav
          className="hidden items-center gap-4 whitespace-nowrap lg:flex xl:gap-6"
          aria-label="Основное меню"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-ink transition-colors duration-150 hover:text-primary-dark xl:text-[15px]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={PHONE_HREF}
            className="hidden whitespace-nowrap text-right md:max-lg:block 2xl:block"
          >
            <span className="tnum block text-[15px] font-semibold text-ink hover:text-primary-dark">
              {PHONE}
            </span>
            <span className="block text-xs text-ink-muted">
              Работаем круглосуточно
            </span>
          </a>
          <Link
            href="/#booking"
            className="hidden rounded-xl bg-cta px-5 py-2.5 text-[15px] font-semibold text-ink transition-colors duration-200 hover:bg-cta-dark sm:block"
          >
            Забронировать
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

const HERO_CHIPS = [
  { icon: ShieldCheck, label: "Охрана 24/7" },
  { icon: Cctv, label: "Видеонаблюдение" },
  { icon: Bus, label: "Трансфер от 4 суток" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-surface">
      {/* На мобиле фото — верхний блок 540px (сюжет не прячется за карточкой брони), на десктопе — фон всей секции */}
      <div className="absolute inset-x-0 top-0 h-[540px] md:inset-0 md:h-auto">
        <Image
          src="/photos/hero-departure.jpg"
          alt="Пара грузит чемоданы в жёлтый шаттл Паркинг 24 Питстоп у терминала аэропорта, в небе взлетает самолёт"
          fill
          priority
          sizes="100vw"
          className="hidden object-cover object-[58%_center] lg:block"
        />
        <Image
          src="/photos/hero-mobile-v4.jpg"
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className="object-cover object-center md:object-[center_40%] lg:hidden"
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.45)_0%,rgba(255,255,255,0.28)_18%,rgba(255,255,255,0.10)_38%,rgba(255,255,255,0)_56%,rgba(233,237,242,0)_78%,#e9edf2_100%)] md:bg-[linear-gradient(to_bottom,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0.08)_30%,rgba(233,237,242,0)_70%,#e9edf2_100%)] lg:hidden" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-white/40 via-white/10 to-transparent lg:block" />
      </div>
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-24 pt-12 lg:grid-cols-[1fr_auto] lg:items-center lg:pb-28 lg:pt-16">
        <div className="max-w-xl">
          <h1 className="text-4xl font-bold leading-tight [text-wrap:balance] sm:text-5xl">
            Паркуйтесь.
            <br className="lg:hidden" /> Летите.
            <br />
            <span className="text-primary-dark">Мы присмотрим.</span>
          </h1>
          <p className="mt-4 max-w-md text-lg font-semibold leading-relaxed text-ink [text-shadow:0_1px_10px_rgba(255,255,255,0.9),0_0_22px_rgba(255,255,255,0.65)] lg:[text-shadow:none]">
            Охраняемая парковка
            <br className="sm:hidden" /> в 500 метрах от Шереметьево.
          </p>
          <ul className="mt-6 flex max-w-60 flex-wrap gap-2.5 sm:max-w-none">
            {HERO_CHIPS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium shadow-card"
              >
                <Icon className="size-4 shrink-0 text-steel" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex w-fit items-center gap-3 rounded-2xl bg-white px-5 py-3.5 shadow-card">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10">
              <CircleCheck className="size-6 text-success" aria-hidden />
            </span>
            <div>
              <div className="font-bold leading-tight">Места есть!</div>
              <div className="text-sm text-ink-muted">
                Бронь подтверждаем за пару минут
              </div>
            </div>
          </div>
        </div>
        <BookingCalculator />
      </div>
    </section>
  );
}

const MINI_BENEFITS = [
  {
    icon: Wallet,
    title: "Оплата на месте",
    text: "Бронь без предоплаты, отмена бесплатная",
  },
  {
    icon: Bus,
    title: "Бесплатный трансфер",
    text: "Туда и обратно при стоянке от 4 суток",
  },
  {
    icon: PlugZap,
    title: "Техпомощь и зарядка EV",
    text: "Выручим с машиной после стоянки",
  },
  {
    icon: Clock,
    title: "Работаем круглосуточно",
    text: "Приезжайте в любое удобное время",
  },
];

export function MiniBenefits() {
  return (
    <section className="relative z-10 bg-surface">
      <div className="mx-auto -mt-10 max-w-6xl px-4 lg:-mt-14">
      <div className="grid gap-6 rounded-2xl border border-line bg-white p-6 shadow-card-lg sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-line">
        {MINI_BENEFITS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex items-start gap-3 lg:px-5 lg:first:pl-0 lg:last:pr-0">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-steel/10">
              <Icon className="size-5 text-steel" aria-hidden />
            </span>
            <div>
              <div className="text-[15px] font-semibold leading-snug">{title}</div>
              <div className="mt-0.5 text-sm leading-snug text-ink-muted">{text}</div>
            </div>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}

const BENEFITS = [
  {
    icon: ShieldCheck,
    title: "Охрана и видеонаблюдение",
    text: "Круглосуточная охрана, контроль доступа и камеры по всей территории.",
    photo: "/photos/cards/benefit-cctv.jpg",
    alt: "Камера видеонаблюдения на охраняемой парковке",
  },
  {
    icon: Bus,
    title: "Бесплатный трансфер",
    text: "Свой шаттл до терминалов B и C — 3–5 минут в пути. От 4 суток — бесплатно в обе стороны.",
    photo: "/photos/cards/benefit-shuttle.jpg",
    alt: "Фирменный шаттл Паркинг 24 Питстоп",
  },
  {
    icon: BedDouble,
    title: "Комнаты отдыха",
    text: "Номера с душем и Wi-Fi прямо на стоянке — от 800 ₽ за 12 часов.",
    photo: "/photos/cards/benefit-room.jpg",
    alt: "Комната отдыха «Улётная ночёвка»",
  },
  {
    icon: Truck,
    title: "Фурам и автобусам — да",
    text: "Места для грузовых и спецтехники, комнаты отдыха для водителей — цена по габаритам в WhatsApp.",
    photo: "/photos/parking-6.jpg",
    alt: "Территория парковки с местами для крупной техники",
  },
];

export function Benefits() {
  return (
    <section id="benefits" className="bg-surface pb-12 pt-16 lg:pb-14 lg:pt-20">
      <div className="mx-auto max-w-6xl px-4">
      <h2 className="text-3xl font-bold lg:text-4xl">Наши преимущества</h2>
      {/* Мобайл/планшет: горизонтальная карточка (фото слева, текст справа) — высота задаётся контентом, заголовки не пляшут; десктоп: вертикальная */}
      <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {BENEFITS.map(({ icon: Icon, title, text, photo, alt }) => (
          <article
            key={title}
            className="flex overflow-hidden rounded-2xl border border-line bg-white shadow-card lg:flex-col"
          >
            <div className="relative w-[36%] shrink-0 lg:order-2 lg:aspect-[3/2] lg:w-full">
              <Image
                src={photo}
                alt={alt}
                fill
                loading="lazy"
                sizes="(min-width: 1024px) 280px, 40vw"
                className="object-cover"
              />
            </div>
            <div className="flex flex-1 items-start gap-3 p-4 lg:order-1 lg:flex-col lg:gap-0 lg:p-5">
              <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-steel/10 lg:flex">
                <Icon className="size-6 text-steel" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold leading-snug [text-wrap:balance] lg:mt-3 lg:text-base">
                  {title}
                </h3>
                <p className="mt-1.5 text-sm leading-snug text-ink-muted lg:mt-2 lg:leading-relaxed">
                  {text}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <ul className="-mx-4 mt-6 grid snap-x snap-mandatory auto-cols-[85%] grid-flow-col grid-rows-2 gap-2.5 overflow-x-auto scroll-pl-4 px-4 pb-1 [scrollbar-width:none] sm:auto-cols-[55%] md:mx-0 md:auto-cols-auto md:grid-flow-row md:grid-cols-2 md:grid-rows-none md:overflow-visible md:px-0 md:pb-0 lg:mt-8 lg:grid-cols-3 lg:gap-3">
        {[
          { icon: PlaneTakeoff, label: "500 м от Шереметьево" },
          { icon: Luggage, label: "Упаковка багажа" },
          { icon: Armchair, label: "Детские кресла в шаттле" },
          { icon: Coffee, label: "Кафе: завтраки и обеды" },
          { icon: Wifi, label: "Бесплатный Wi-Fi" },
          { icon: ShowerHead, label: "Душ и прачечная" },
        ].map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex snap-start items-center gap-3 whitespace-nowrap rounded-full border border-line bg-white py-2.5 pl-3 pr-6 shadow-card"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-steel/10">
              <Icon className="size-5 text-steel" aria-hidden />
            </span>
            <span className="text-[15px] font-medium">{label}</span>
          </li>
        ))}
      </ul>
      </div>
    </section>
  );
}

const FAQ = [
  {
    q: "Есть ли трансфер до терминалов?",
    a: "Да. При стоянке от 4 суток трансфер бесплатный в обе стороны: отвезём к терминалам B и C, а по прилёте встретим там же и вернём к машине. Место посадки и высадки — на выезде из терминалов, до входов 3–5 минут пешком. Аэропорт разрешает транспорту находиться в зоне прилёта не более 10 минут, поэтому выходите к месту встречи с багажом — и сразу напишите нам в WhatsApp.",
  },
  {
    q: "Принимаете ли грузовые автомобили?",
    a: "Да, принимаем. Цена зависит от габаритов — напишите марку и размеры в WhatsApp, ответим за несколько минут.",
  },
  {
    q: "Как добраться до стоянки?",
    a: "Мы в селе Чашниково (г. о. Химки) — 500 метров от Шереметьево. Кнопки маршрута в Яндекс Картах и 2ГИС — в разделе «Как добраться» ниже.",
  },
  {
    q: "Как оплатить и можно ли отменить бронь?",
    a: "Сейчас бронь подтверждает администратор, оплата на месте — предоплаты нет, поэтому отмена бесплатная: если планы изменились, просто предупредите нас в WhatsApp. Онлайн-оплата с автоматическим возвратом при отмене скоро появится на сайте.",
  },
  {
    q: "Что делать, если у аэропорта не работает GPS?",
    a: "В зоне аэропорта возможны сбои GPS и мобильного интернета — сохраните маршрут заранее. После бронирования мы отправим фото- и видеопутеводитель.",
  },
];

const PROMOS = [
  {
    title: "В отпуск от 4 суток — трансфер в подарок",
    text: "Довезём до терминала и встретим по прилёте. Бесплатно, в обе стороны.",
  },
  {
    title: "Командировка или зимовка? От 30 суток — 250 ₽/сутки",
    text: "Тариф для легковых. Забронируйте заранее — закрепим место на весь срок.",
  },
  {
    title: "Ночной рейс? Номер от 800 ₽ за 12 часов",
    text: "Выспитесь в «Улётной ночёвке» — машина под камерами, вы в двух шагах от неё.",
  },
];

export function Promo() {
  return (
    <section id="promo" className="bg-gradient-to-br from-[#4a5162] to-navy py-12 text-white lg:py-14">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-3xl font-bold lg:text-4xl">Выгоднее, чем кажется</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PROMOS.map((p) => (
            <article
              key={p.title}
              className="rounded-2xl border border-white/10 bg-white/[0.07] p-6 backdrop-blur-sm md:last:col-span-2 lg:last:col-span-1"
            >
              <h3 className="text-lg font-bold [text-wrap:balance]">
                {p.title}
              </h3>
              <p className="tnum mt-2 text-sm leading-relaxed text-white/75">
                {p.text}
              </p>
            </article>
          ))}
        </div>
        <a
          href="#booking"
          className="mt-8 flex h-13 w-full items-center justify-center rounded-xl bg-cta px-5 py-3.5 text-[15px] font-semibold text-ink transition-colors duration-200 hover:bg-cta-dark md:mx-auto md:w-fit"
        >
          Рассчитать мою стоянку
        </a>
      </div>
    </section>
  );
}

const REVIEWS = [
  {
    name: "Сергей Сергеев",
    text: "Отличная стоянка, всегда есть свободные места, пунктуальный трансфер — рекомендую!",
  },
  {
    name: "Дмитрий Сычев",
    text: "Очень удобная парковка, от аэропорта трансфер везёт 3–5 минут.",
  },
  {
    name: "Алексей Журавлев",
    text: "Нужно было улетать на пару дней… Сервис — огонь, рекомендую, буду советовать вас всем.",
  },
];

function Stars() {
  const starClass = "size-4.5";
  return (
    <span className="flex gap-1" aria-label="Оценка 5 из 5" role="img">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${starClass} fill-warning text-warning`}
          aria-hidden
        />
      ))}
    </span>
  );
}

export function Reviews() {
  const reviewsHref =
    "https://yandex.ru/maps/?text=" +
    encodeURIComponent("Паркинг 24 Питстоп Чашниково отзывы");
  return (
    <section id="reviews" className="bg-surface py-12 lg:py-14">
      <div className="mx-auto max-w-6xl px-4">
      <div className="flex flex-col items-center text-center">
        <h2 className="text-3xl font-bold [text-wrap:balance] lg:text-4xl">
          Нам доверяют машины на время отпуска
        </h2>
        <p className="mt-3 max-w-xl text-ink-muted">
          Отзывы гостей с Яндекс Карт — о трансфере, местах и сервисе.
        </p>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {REVIEWS.map((r) => (
          <figure
            key={r.name}
            className="flex flex-col rounded-2xl border border-line bg-white p-6 shadow-card"
          >
            <div className="flex items-center justify-between">
              <Stars />
              <span className="tnum rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold text-ink-muted">
                5,0
              </span>
            </div>
            <blockquote className="mt-4 flex-1 leading-relaxed">«{r.text}»</blockquote>
            <figcaption className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
              <span className="font-semibold">{r.name}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-muted">
                <MapPin
                  className="size-4 fill-[#fc3f1d] text-[#fc3f1d]"
                  aria-hidden
                />
                Яндекс Карты
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-8 text-center">
        <a
          href={reviewsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center justify-center rounded-xl border-2 border-primary px-6 text-[15px] font-semibold text-primary-deep transition-colors duration-200 hover:bg-primary-soft"
        >
          Читать все отзывы на Яндекс Картах →
        </a>
      </div>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-6xl px-4 py-12 lg:py-14">
      <h2 className="text-3xl font-bold lg:text-4xl">Частые вопросы</h2>
      <div className="mt-6 divide-y divide-line rounded-2xl border border-line bg-white shadow-card">
        {FAQ.map(({ q, a }) => (
          <details key={q} className="group px-5">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-4 font-medium [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDown
                className="size-5 shrink-0 text-steel transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="pb-4 text-[15px] leading-relaxed text-ink-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function RestRooms() {
  return (
    <section id="rooms" className="bg-surface-warm py-12 lg:py-14">
      <div className="mx-auto max-w-6xl px-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-3xl font-bold [text-wrap:balance] lg:text-4xl">
          Комнаты отдыха «Улётная ночёвка»
        </h2>
        <p className="tnum w-fit shrink-0 rounded-full bg-primary-soft px-4 py-2 text-lg font-bold text-primary-deep">
          от 800 ₽{" "}
          <span className="text-sm font-medium text-primary-deep">/ 12 часов</span>
        </p>
      </div>
      <p className="mt-3 max-w-2xl leading-relaxed text-ink-muted">
        Тёплые и уютные номера — выспаться перед рейсом или после долгой дороги.
      </p>
      <RoomsSlider />
      <ul className="-mx-4 mt-6 flex flex-wrap items-center justify-center gap-1.5 px-1 sm:mx-0 sm:gap-2.5 sm:px-0">
        {[
          { icon: ShowerHead, extra: ROOM_EXTRAS[0], short: "Душ — 250 ₽" },
          { icon: WashingMachine, extra: ROOM_EXTRAS[2], short: "Стирка — 350 ₽" },
          { icon: Bus, extra: ROOM_EXTRAS[6], short: "Трансфер — 300 ₽" },
        ].map(({ icon: Icon, extra, short }) => (
          <li
            key={extra}
            className="tnum flex items-center rounded-full border border-line bg-white px-2 py-1.5 text-xs font-medium shadow-card sm:gap-2.5 sm:py-2 sm:pl-2.5 sm:pr-5 sm:text-[15px]"
          >
            <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-steel/10 sm:flex">
              <Icon className="size-5 text-steel" aria-hidden />
            </span>
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{extra}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center">
        <Link
          href="/rooms"
          className="text-sm font-semibold text-primary-deep hover:underline sm:text-[15px]"
        >
          Все услуги и цены →
        </Link>
      </p>
      </div>
    </section>
  );
}

export function Gallery() {
  return (
    <section id="gallery" className="mx-auto max-w-6xl px-4 py-12 lg:py-14">
      <h2 className="text-3xl font-bold lg:text-4xl">Наша стоянка</h2>
      <div className="-mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Image
            key={n}
            src={`/photos/parking-${n}.jpg`}
            alt={`Территория парковки Питстоп — фото ${n}`}
            width={640}
            height={360}
            loading="lazy"
            className="aspect-video w-[72%] shrink-0 snap-start rounded-2xl object-cover md:w-auto md:shrink"
          />
        ))}
      </div>
    </section>
  );
}

export function Directions() {
  const mapsHref =
    "https://yandex.ru/maps/?text=" +
    encodeURIComponent("Паркинг 24 Питстоп Чашниково Химки");
  const gisHref =
    "https://2gis.ru/search/" +
    encodeURIComponent("Паркинг 24 Питстоп Чашниково");
  return (
    <section id="directions" className="bg-surface py-12 lg:py-14">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold lg:text-4xl">Как добраться</h2>
          <p className="mt-3 flex items-start gap-2 text-[15px] leading-relaxed">
            <MapPin className="mt-0.5 size-5 shrink-0 text-steel" aria-hidden />
            {ADDRESS} — 500 метров от аэропорта Шереметьево.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
            Трансфер до терминалов B и C: место встречи и высадки — на выезде из
            терминалов, до входов 3–5 минут пешком.
          </p>
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm leading-relaxed">
            В зоне аэропорта возможны сбои GPS и мобильного интернета. Сохраните
            маршрут заранее — после бронирования мы отправим фото- и
            видеопутеводитель.
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border-2 border-primary px-5 py-2.5 text-[15px] font-semibold text-primary-deep transition-colors duration-200 hover:bg-primary-soft"
            >
              <Navigation className="size-4" aria-hidden />
              Маршрут в Яндекс Картах
            </a>
            <a
              href={gisHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border-2 border-primary px-5 py-2.5 text-[15px] font-semibold text-primary-deep transition-colors duration-200 hover:bg-primary-soft"
            >
              Открыть в 2ГИС
            </a>
          </div>
        </div>
        <MapFacade
          title="Паркинг 24 Питстоп на карте"
          src={
            "https://yandex.ru/map-widget/v1/?text=" +
            encodeURIComponent("Паркинг 24 Питстоп Чашниково Химки") +
            "&z=13"
          }
        />
      </div>
    </section>
  );
}

export function CtaBand() {
  return (
    <section className="bg-gradient-to-br from-[#4a5162] to-navy">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between lg:py-12">
        <div>
          <h2 className="text-2xl font-bold text-white [text-wrap:balance] lg:text-3xl">
            Готовы забронировать?
          </h2>
          <p className="mt-1.5 text-white/75">
            Место подтвердим за пару минут — до вылета останется меньше забот.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/#booking"
            className="flex h-13 items-center justify-center rounded-xl bg-cta px-7 text-[15px] font-semibold text-ink transition-colors duration-200 hover:bg-cta-dark"
          >
            Забронировать место
          </Link>
          <a
            href={PHONE_HREF}
            className="tnum flex items-center gap-2 text-[15px] font-semibold text-white hover:text-white/80"
          >
            <Phone className="size-4" aria-hidden />
            {PHONE}
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer id="contacts" className="border-t border-white/10 bg-navy-deep pb-24 pt-12 text-white md:pb-12">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-3">
        <div>
          <Logo dark />
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Охраняемая парковка и комнаты отдыха у аэропорта Шереметьево.
            Работаем круглосуточно.
          </p>
        </div>
        <div className="text-sm leading-7">
          <h3 className="mb-2 font-semibold">Контакты</h3>
          <a href={PHONE_HREF} className="tnum flex items-center gap-2 hover:text-white/80">
            <Phone className="size-4" aria-hidden />
            {PHONE}
          </a>
          <a
            href={`https://wa.me/${WHATSAPP}`}
            className="block hover:text-white/80"
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
          <a
            href={`https://t.me/${TELEGRAM}`}
            className="block hover:text-white/80"
            target="_blank"
            rel="noopener noreferrer"
          >
            Telegram: @{TELEGRAM}
          </a>
          <p className="text-white/70">{ADDRESS}</p>
        </div>
        <div className="text-sm leading-7 text-white/70">
          <h3 className="mb-2 font-semibold text-white">Реквизиты</h3>
          <p>ООО «ПИТСТОП»</p>
          <p className="tnum">ОГРН 1225000082141 · ИНН 5044126289</p>
          <p className="tnum">КПП 504401001</p>
          <Link href="/policy" className="mt-2 block underline hover:text-white">
            Политика обработки персональных данных
          </Link>
          <p className="mt-2">
            © {new Date().getFullYear()} Паркинг 24 Питстоп. Все права защищены.
          </p>
        </div>
      </div>
    </footer>
  );
}

export function MobileCta() {
  return (
    <MobileCtaBar>
      <Link
        href="/#booking"
        className="flex h-12 flex-1 items-center justify-center rounded-xl bg-cta text-[15px] font-semibold text-ink"
      >
        Забронировать
      </Link>
      <a
        href={PHONE_HREF}
        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-line bg-white text-[15px] font-semibold text-ink"
      >
        <Phone className="size-4" aria-hidden />
        Позвонить
      </a>
    </MobileCtaBar>
  );
}
