import Image from "next/image";
import {
  BedDouble,
  Bus,
  Cctv,
  ChevronDown,
  Coffee,
  MapPin,
  Navigation,
  Phone,
  PlugZap,
  ShieldCheck,
  ShowerHead,
  WashingMachine,
  Wifi,
} from "lucide-react";
import BookingCalculator from "./BookingCalculator";
import {
  ADDRESS,
  PHONE,
  PHONE_HREF,
  TELEGRAM,
  WHATSAPP,
} from "@/lib/tariffs";

const NAV = [
  { href: "#tariffs", label: "Тарифы" },
  { href: "#rooms", label: "Комнаты отдыха" },
  { href: "#directions", label: "Как добраться" },
  { href: "#contacts", label: "Контакты" },
];

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      {dark ? (
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/emblem-white.svg" alt="" className="size-full" />
        </span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src="/brand/emblem-blue.svg" alt="" className="h-11 w-auto" />
      )}
      <span
        className={`text-sm font-bold leading-tight ${dark ? "text-white" : "text-ink"}`}
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
        <a href="#" aria-label="Паркинг 24 Питстоп — на главную">
          <Logo />
        </a>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Основное меню">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[15px] font-medium text-ink transition-colors duration-150 hover:text-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href={PHONE_HREF}
            className="tnum hidden text-[15px] font-semibold text-ink hover:text-primary md:block"
          >
            {PHONE}
          </a>
          <a
            href="#booking"
            className="hidden rounded-xl bg-primary px-5 py-2.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-primary-dark sm:block"
          >
            Забронировать
          </a>
        </div>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <Image
        src="/photos/hero.jpg"
        alt="Открытая охраняемая парковка Паркинг 24 Питстоп у Шереметьево"
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-navy/85 via-navy/60 to-navy/25" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-[1fr_auto] lg:items-center lg:py-20">
        <div className="max-w-xl text-white">
          <h1 className="text-4xl font-bold leading-tight [text-wrap:balance] sm:text-5xl">
            Паркуйтесь. Летите.
            <br />
            Мы присмотрим.
          </h1>
          <p className="mt-4 text-lg text-white/90">
            Охраняемая парковка у Шереметьево — от 150 ₽/сутки.
            Бесплатный трансфер до терминалов B и C. Место гарантировано.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2.5">
            {["500 м от аэропорта", "Охрана и видео 24/7", "Трансфер бесплатно от 4 суток"].map(
              (t) => (
                <li
                  key={t}
                  className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium backdrop-blur-sm"
                >
                  {t}
                </li>
              )
            )}
          </ul>
        </div>
        <BookingCalculator />
      </div>
    </section>
  );
}

const BENEFITS = [
  {
    icon: ShieldCheck,
    title: "Охрана 24/7",
    text: "Круглосуточная охрана и контроль доступа на территорию.",
  },
  {
    icon: Cctv,
    title: "Видеонаблюдение",
    text: "Камеры высокого разрешения по всему периметру стоянки.",
  },
  {
    icon: Bus,
    title: "Трансфер до аэропорта",
    text: "Бесплатно от 4 суток — довезём до терминалов B и C.",
  },
  {
    icon: BedDouble,
    title: "Комнаты отдыха",
    text: "Душ, номера и койко-места — от 800 ₽ за 12 часов.",
  },
];

export function Benefits() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 lg:py-14">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {BENEFITS.map(({ icon: Icon, title, text }) => (
          <article
            key={title}
            className="flex flex-col items-center rounded-2xl border border-line bg-white p-4 text-center shadow-card lg:items-start lg:p-6 lg:text-left"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 lg:size-12">
              <Icon className="size-6 text-primary" aria-hidden />
            </span>
            <h3 className="mt-2.5 text-sm font-semibold lg:mt-4 lg:text-base">
              {title}
            </h3>
            <p className="hidden lg:mt-1.5 lg:block lg:text-sm lg:leading-relaxed lg:text-ink-muted">
              {text}
            </p>
          </article>
        ))}
      </div>
      <ul className="mt-6 flex flex-wrap justify-center gap-2 lg:mt-8">
        {["500 м от Шереметьево", "Охраняемая территория", "Работаем 24/7"].map(
          (chip) => (
            <li
              key={chip}
              className="rounded-full bg-surface px-4 py-2 text-sm font-medium text-ink-muted"
            >
              {chip}
            </li>
          )
        )}
      </ul>
    </section>
  );
}

const FAQ = [
  {
    q: "Есть ли трансфер до терминалов?",
    a: "Да, бесплатно при стоянке от 4 суток — до терминалов B и C. Место встречи и высадки — на выезде из терминалов, до входов 3–5 минут пешком.",
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
    a: "В зоне аэропорта возможны сбои GPS и мобильного интернета — сохраните маршрут заранее. После бронирования мы отправим фото- и видео-путеводитель.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-6xl px-4 pb-12 lg:pb-14">
      <h2 className="text-3xl font-bold">Частые вопросы</h2>
      <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-white shadow-card">
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

const ROOM_FEATURES = [
  { icon: ShowerHead, label: "Душевые" },
  { icon: WashingMachine, label: "Прачечная" },
  { icon: Coffee, label: "Кафе: завтраки и ужины" },
  { icon: Wifi, label: "Бесплатный Wi-Fi" },
  { icon: PlugZap, label: "Зарядка электромобилей" },
];

export function RestRooms() {
  return (
    <section id="rooms" className="mx-auto max-w-6xl px-4 py-14">
      <div className="grid items-center gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold">Комнаты отдыха «Улётная ночёвка»</h2>
          <p className="mt-3 leading-relaxed text-ink-muted">
            Номера на 2–3 человека и эконом-места для водителей и пассажиров —
            выспаться перед рейсом или после долгой дороги. От{" "}
            <span className="tnum font-semibold text-ink">800 ₽ за 12 часов</span>.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {ROOM_FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-[15px]">
                <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6">
          <p className="font-medium">
            Также на стоянке: упаковка багажа, детские кресла, техпомощь
            (запуск двигателя, подкачка шин), зона ожидания.
          </p>
          <a
            href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Здравствуйте! Хочу забронировать комнату отдыха.")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-block rounded-xl border-2 border-primary px-5 py-2.5 text-[15px] font-semibold text-primary transition-colors duration-200 hover:bg-primary hover:text-white"
          >
            Забронировать комнату
          </a>
        </div>
      </div>
    </section>
  );
}

export function Gallery() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-14">
      <h2 className="text-3xl font-bold">Наша стоянка</h2>
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
    <section id="directions" className="bg-surface py-14">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold">Как добраться</h2>
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
            видео-путеводитель.
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
        <iframe
          title="Паркинг 24 Питстоп на карте"
          src={
            "https://yandex.ru/map-widget/v1/?text=" +
            encodeURIComponent("Паркинг 24 Питстоп Чашниково Химки") +
            "&z=13"
          }
          className="h-72 w-full rounded-2xl border border-line lg:h-full"
          loading="lazy"
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
            Работаем круглосуточно, 24/7.
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
      <a
        href="#booking"
        className="flex h-12 flex-1 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-white"
      >
        Забронировать
      </a>
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
