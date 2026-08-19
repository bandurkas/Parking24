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
  WashingMachine,
  Wifi,
} from "lucide-react";
import BookingCalculator from "./BookingCalculator";
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
  { href: "/#gallery", label: "Наша парковка" },
  { href: "/#directions", label: "Как добраться" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#contacts", label: "Контакты" },
];

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      {dark ? (
        <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 p-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/emblem-white.svg" alt="" className="size-full" />
        </span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src="/brand/emblem-color.svg" alt="" className="h-11 w-auto" />
      )}
      <span
        className={`whitespace-nowrap text-sm font-bold leading-tight ${dark ? "text-white" : "text-ink"}`}
      >
        ПАРКИНГ 24
        <br />
        ПИТСТОП
      </span>
    </span>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" aria-label="Паркинг 24 Питстоп — на главную">
          <Logo />
        </Link>
        <nav
          className="hidden items-center gap-4 whitespace-nowrap lg:flex xl:gap-6"
          aria-label="Основное меню"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-ink transition-colors duration-150 hover:text-primary xl:text-[15px]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={PHONE_HREF}
            className="hidden whitespace-nowrap text-right md:max-lg:block xl:block"
          >
            <span className="tnum block text-[15px] font-semibold text-ink hover:text-primary">
              {PHONE}
            </span>
            <span className="block text-xs text-ink-muted">
              Работаем круглосуточно
            </span>
          </a>
          <Link
            href="/#booking"
            className="hidden rounded-xl bg-primary px-5 py-2.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-primary-dark sm:block"
          >
            Забронировать
          </Link>
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
      <Image
        src="/photos/parking-3.jpg"
        alt="Фирменный шаттл Паркинг 24 Питстоп на охраняемой стоянке у Шереметьево"
        fill
        priority
        sizes="100vw"
        className="object-cover object-[72%_center]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/70 to-white/25 lg:to-white/5" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[1fr_auto] lg:items-center lg:py-16">
        <div className="max-w-xl">
          <h1 className="text-4xl font-bold leading-tight [text-wrap:balance] sm:text-5xl">
            Паркуйтесь. Летите.
            <br />
            <span className="text-primary">Мы присмотрим.</span>
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-ink-muted">
            Охраняемая парковка рядом с Шереметьево. Бесплатный трансфер до
            терминала и обратно.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2.5">
            {HERO_CHIPS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium shadow-card"
              >
                <Icon className="size-4 shrink-0 text-primary" aria-hidden />
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
    icon: ShieldCheck,
    title: "Охрана и видео 24/7",
    text: "Контроль доступа и безопасность",
  },
  {
    icon: Bus,
    title: "Трансфер туда и обратно",
    text: "Бесплатно при стоянке от 4 суток",
  },
  {
    icon: Wifi,
    title: "Бесплатный Wi-Fi",
    text: "Работайте и отдыхайте с комфортом",
  },
  {
    icon: Clock,
    title: "Работаем круглосуточно",
    text: "Приезжайте в любое удобное время",
  },
];

export function MiniBenefits() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-8">
      <div className="grid gap-5 rounded-2xl border border-line bg-white p-6 shadow-card sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-line">
        {MINI_BENEFITS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex items-start gap-3 lg:px-5 lg:first:pl-0 lg:last:pr-0">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Icon className="size-5 text-primary" aria-hidden />
            </span>
            <div>
              <div className="text-[15px] font-semibold leading-snug">{title}</div>
              <div className="mt-0.5 text-sm leading-snug text-ink-muted">{text}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const BENEFITS = [
  {
    icon: ShieldCheck,
    title: "Охрана 24/7",
    text: "Круглосуточная охрана территории и контроль доступа.",
    photo: "/photos/parking-1.jpg",
    alt: "Охраняемая территория парковки",
  },
  {
    icon: Cctv,
    title: "Видеонаблюдение",
    text: "Система камер по всей территории парковки.",
    photo: "/photos/cards/cctv.jpg",
    alt: "Камера видеонаблюдения на парковке",
  },
  {
    icon: Bus,
    title: "Бесплатный трансфер",
    text: "Доставим до терминала и заберём после прилёта.",
    photo: "/photos/parking-3.jpg",
    alt: "Фирменный шаттл Паркинг 24 Питстоп",
  },
  {
    icon: BedDouble,
    title: "Комнаты отдыха",
    text: "Комфортные зоны ожидания, душ, напитки, Wi-Fi.",
    photo: "/photos/rooms/comfort-double-2.jpg",
    alt: "Комната отдыха «Улётная ночёвка»",
  },
];

export function Benefits() {
  return (
    <section id="benefits" className="mx-auto max-w-6xl px-4 py-12 lg:py-14">
      <h2 className="text-3xl font-bold lg:text-4xl">Наши преимущества</h2>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {BENEFITS.map(({ icon: Icon, title, text, photo, alt }) => (
          <article
            key={title}
            className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card"
          >
            <div className="flex flex-1 flex-col p-4 lg:p-5">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
                <Icon className="size-6 text-primary" aria-hidden />
              </span>
              <h3 className="mt-2.5 text-sm font-semibold lg:text-base">
                {title}
              </h3>
              <p className="mt-1 hidden text-sm leading-relaxed text-ink-muted lg:block">
                {text}
              </p>
            </div>
            <Image
              src={photo}
              alt={alt}
              width={600}
              height={400}
              loading="lazy"
              className="aspect-[3/2] w-full object-cover"
            />
          </article>
        ))}
      </div>
      <ul className="-mx-4 mt-6 grid snap-x snap-mandatory auto-cols-[85%] grid-flow-col grid-rows-2 gap-2.5 overflow-x-auto scroll-pl-4 px-4 pb-1 [scrollbar-width:none] sm:auto-cols-[55%] md:mx-0 md:auto-cols-auto md:grid-flow-row md:grid-cols-2 md:grid-rows-none md:overflow-visible md:px-0 md:pb-0 lg:mt-8 lg:grid-cols-3 lg:gap-3">
        {[
          { icon: PlaneTakeoff, label: "500 м от Шереметьево" },
          { icon: Luggage, label: "Упаковка багажа" },
          { icon: Armchair, label: "Детские кресла в шаттле" },
          { icon: Coffee, label: "Кафе: завтраки и ужины" },
          { icon: Wifi, label: "Бесплатный Wi-Fi" },
          { icon: Clock, label: "Работаем круглосуточно" },
        ].map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex snap-start items-center gap-3 whitespace-nowrap rounded-full border border-line bg-white py-2.5 pl-3 pr-6 shadow-card"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="size-5 text-primary" aria-hidden />
            </span>
            <span className="text-[15px] font-medium">{label}</span>
          </li>
        ))}
      </ul>
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
    a: "МО, г. о. Химки, село Чашниково — 500 метров от Шереметьево. Ниже на странице есть кнопки маршрута в Яндекс Картах и 2ГИС.",
  },
  {
    q: "Как оплатить и можно ли отменить бронь?",
    a: "Сейчас бронь подтверждает администратор, оплата на месте. Онлайн-оплата с автоматическим возвратом при отмене скоро появится на сайте.",
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
    text: "Минус 100 ₽ с каждых суток: месяц стоянки — 7 500 ₽ вместо 10 500 ₽.",
  },
  {
    title: "Ночной рейс? Номер от 800 ₽ за 12 часов",
    text: "Выспитесь в «Улётной ночёвке» — машина под камерами, вы в двух шагах от неё.",
  },
];

export function Promo() {
  return (
    <section id="promo" className="mx-auto max-w-6xl px-4 pt-12 lg:pt-14">
      <h2 className="text-3xl font-bold lg:text-4xl">Выгоднее, чем кажется</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {PROMOS.map((p) => (
          <article
            key={p.title}
            className="rounded-2xl bg-navy p-6 text-white"
          >
            <h3 className="text-lg font-semibold [text-wrap:balance]">
              {p.title}
            </h3>
            <p className="tnum mt-2 text-sm leading-relaxed text-white/80">
              {p.text}
            </p>
          </article>
        ))}
      </div>
      <a
        href="#booking"
        className="mt-5 flex h-13 w-full items-center justify-center rounded-xl bg-primary px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-primary-dark md:mx-auto md:w-fit"
      >
        Рассчитать мою стоянку
      </a>
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

function Stars({ starClass = "size-4.5" }: { starClass?: string }) {
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
    <section id="reviews" className="mx-auto max-w-6xl px-4 pt-12 lg:pt-14">
      <div className="flex flex-col items-center text-center">
        <h2 className="text-3xl font-bold [text-wrap:balance] lg:text-4xl">
          Нам доверяют машины на время отпуска
        </h2>
        <div className="mt-3">
          <Stars starClass="size-7" />
        </div>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {REVIEWS.map((r) => (
          <figure
            key={r.name}
            className="flex flex-col rounded-2xl border border-line bg-white p-6 shadow-card"
          >
            <div className="flex items-center justify-between">
              <Stars />
              <span className="tnum rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink-muted">
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
      <div className="mt-7 text-center">
        <a
          href={reviewsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center justify-center rounded-xl border-2 border-primary px-6 text-[15px] font-semibold text-primary transition-colors duration-200 hover:bg-primary hover:text-white"
        >
          Читать все отзывы на Яндекс Картах →
        </a>
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
                className="size-5 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180"
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
    <section id="rooms" className="mx-auto max-w-6xl px-4 pt-12 lg:pt-14">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-3xl font-bold [text-wrap:balance] lg:text-4xl">
          Комнаты отдыха «Улётная ночёвка»
        </h2>
        <p className="tnum w-fit shrink-0 rounded-full bg-primary/10 px-4 py-2 text-lg font-bold text-primary">
          от 800 ₽{" "}
          <span className="text-sm font-medium text-primary/80">/ 12 часов</span>
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
            <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 sm:flex">
              <Icon className="size-5 text-primary" aria-hidden />
            </span>
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{extra}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center">
        <Link
          href="/rooms"
          className="text-sm font-semibold text-primary hover:underline sm:text-[15px]"
        >
          Все услуги и цены →
        </Link>
      </p>
    </section>
  );
}

export function Gallery() {
  return (
    <section id="gallery" className="mx-auto max-w-6xl px-4 pt-12 lg:pt-14">
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
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
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
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-primary-dark"
            >
              <Navigation className="size-4" aria-hidden />
              Маршрут в Яндекс Картах
            </a>
            <a
              href={gisHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border-2 border-primary px-5 py-2.5 text-[15px] font-semibold text-primary transition-colors duration-200 hover:bg-primary hover:text-white"
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

export function Footer() {
  return (
    <footer id="contacts" className="bg-navy pb-24 pt-12 text-white lg:pb-12">
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
    <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2.5 border-t border-line bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      <Link
        href="/#booking"
        className="flex h-12 flex-1 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-white"
      >
        Забронировать
      </Link>
      <a
        href={PHONE_HREF}
        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-primary text-[15px] font-semibold text-primary"
      >
        <Phone className="size-4" aria-hidden />
        Позвонить
      </a>
    </div>
  );
}
