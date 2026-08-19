"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { LONG_TERM, TRUCK, VEHICLE_TYPES, WHATSAPP } from "@/lib/tariffs";

type Card = {
  title: string;
  price: number | null;
  note: string;
  badge?: string;
  img?: string;
};

const WA_TRUCK_HREF = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  "Здравствуйте! Хочу поставить грузовой транспорт, подскажите цену."
)}`;

const WA_LONG_HREF = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  "Здравствуйте! Интересует долгосрочная стоянка, подскажите цену."
)}`;

const CAR_IMG: Record<string, string> = {
  car: "/photos/cars/sedan.jpg",
  suv: "/photos/cars/suv.jpg",
};

const DAILY: Card[] = [
  ...VEHICLE_TYPES.map((t) => ({
    title: t.label,
    price: t.perDay,
    note: t.note,
    img: CAR_IMG[t.id],
  })),
  { title: TRUCK.label, price: null, note: TRUCK.note },
];

const LONG: Card[] = [
  {
    title: "Легковая — от 30 суток",
    price: LONG_TERM.perDay,
    note: "Экономия 100 ₽ с каждых суток: месяц стоянки — 7 500 ₽ вместо 10 500 ₽.",
    badge: "месяц ≈ 7 500 ₽",
    img: "/photos/cars/camry.jpg",
  },
  {
    title: "Другие типы ТС",
    price: null,
    note: "Кроссоверы, мотоциклы и грузовые на долгий срок — цена по запросу.",
  },
];

const MODES = [
  { id: "daily", label: "Посуточно" },
  { id: "long", label: "Долгосрочно" },
] as const;

export default function Tariffs() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("daily");

  const cards = mode === "daily" ? DAILY : LONG;

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || !el.firstElementChild) return;
    const cardWidth = (el.firstElementChild as HTMLElement).offsetWidth + 12;
    setActive(Math.min(cards.length - 1, Math.round(el.scrollLeft / cardWidth)));
  };

  return (
    <section id="tariffs" className="bg-surface py-12 lg:py-14">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-3xl font-bold lg:text-4xl">Тарифы</h2>
          <div
            className="flex rounded-full border border-line bg-white p-1"
            role="tablist"
            aria-label="Режим тарифов"
          >
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => {
                  setMode(m.id);
                  setActive(0);
                  trackRef.current?.scrollTo({ left: 0 });
                }}
                className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-150 ${
                  mode === m.id
                    ? "bg-primary text-white"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div
          ref={trackRef}
          onScroll={onScroll}
          className={`-mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:gap-4 ${
            mode === "daily" ? "lg:grid-cols-4" : "lg:grid-cols-2"
          }`}
        >
          {cards.map((t) => (
            <article
              key={t.title}
              className="relative flex w-[78%] shrink-0 snap-start flex-col overflow-hidden rounded-2xl bg-white p-6 pb-5 shadow-card md:w-auto md:shrink"
            >
              <h3 className="font-semibold">{t.title}</h3>
              {t.price !== null ? (
                <div className="tnum mt-2 text-4xl font-bold leading-10 text-primary">
                  {t.price} ₽
                  <span className="text-lg font-medium text-ink-muted">/сутки</span>
                </div>
              ) : (
                <div className="mt-2 text-3xl font-bold leading-10">по запросу</div>
              )}
              <p className="mt-2 text-sm text-ink-muted">{t.note}</p>
              {t.badge && (
                <span className="tnum mt-3 w-fit rounded-full bg-primary-soft px-3 py-1 text-[13px] font-semibold text-primary">
                  {t.badge}
                </span>
              )}
              {t.price === null && (
                <a
                  href={mode === "daily" ? WA_TRUCK_HREF : WA_LONG_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 w-fit rounded-full bg-primary-soft px-3 py-1 text-[13px] font-semibold text-primary transition-colors duration-150 hover:bg-primary/20"
                >
                  Написать в WhatsApp →
                </a>
              )}
              {t.img && (
                <Image
                  src={t.img}
                  alt=""
                  width={500}
                  height={333}
                  loading="lazy"
                  className="mt-auto h-28 w-full object-contain pt-3"
                />
              )}
              <span className="absolute inset-x-0 bottom-0 h-1.5 bg-steel/25" />
            </article>
          ))}
        </div>
        <div className="mt-3 flex justify-center gap-1.5 md:hidden" aria-hidden>
          {cards.map((t, i) => (
            <span
              key={t.title}
              className={`size-2 rounded-full transition-colors duration-200 ${
                i === active ? "bg-primary" : "bg-line"
              }`}
            />
          ))}
        </div>
        <p className="mt-4 rounded-xl bg-steel/10 px-4 py-3 text-[15px] font-medium text-ink">
          Трансфер до терминалов B и C — бесплатно в обе стороны при стоянке от
          4 суток.
        </p>
      </div>
    </section>
  );
}
