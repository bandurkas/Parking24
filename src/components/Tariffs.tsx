"use client";

import { useRef, useState } from "react";
import { LONG_TERM, TRUCK, VEHICLE_TYPES, WHATSAPP } from "@/lib/tariffs";

type Card = {
  title: string;
  price: number | null;
  note: string;
  badge?: string;
};

const CARDS: Card[] = [
  ...VEHICLE_TYPES.map((t) => ({
    title: t.label,
    price: t.perDay,
    note: t.note,
    badge:
      t.id === "car"
        ? `от ${LONG_TERM.minDays} суток — ${LONG_TERM.perDay} ₽/сутки`
        : undefined,
  })),
  { title: TRUCK.label, price: null, note: TRUCK.note },
];

const WA_TRUCK_HREF = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  "Здравствуйте! Хочу поставить грузовой транспорт, подскажите цену."
)}`;

export default function Tariffs() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || !el.firstElementChild) return;
    const cardWidth = (el.firstElementChild as HTMLElement).offsetWidth + 12;
    setActive(Math.min(CARDS.length - 1, Math.round(el.scrollLeft / cardWidth)));
  };

  return (
    <section id="tariffs" className="bg-surface py-12 lg:py-14">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-3xl font-bold lg:text-4xl">Тарифы</h2>
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="-mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-4 lg:gap-4"
        >
          {CARDS.map((t) => (
            <article
              key={t.title}
              className="relative flex w-[78%] shrink-0 snap-start flex-col overflow-hidden rounded-2xl bg-white p-6 pb-7 shadow-card md:w-auto md:shrink"
            >
              <h3 className="font-semibold">{t.title}</h3>
              {t.price !== null ? (
                <div className="tnum mt-2 text-4xl font-bold">
                  {t.price} ₽
                  <span className="text-lg font-medium text-ink-muted">/сутки</span>
                </div>
              ) : (
                <div className="mt-2 flex h-10 items-center text-2xl font-bold">
                  по запросу
                </div>
              )}
              <p className="mt-2 text-sm text-ink-muted">
                {t.note}
                {t.price === null && (
                  <>
                    {" "}
                    <a
                      href={WA_TRUCK_HREF}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-primary hover:underline"
                    >
                      Написать →
                    </a>
                  </>
                )}
              </p>
              {t.badge && (
                <span className="tnum mt-3 w-fit rounded-full bg-primary/10 px-3 py-1 text-[13px] font-semibold text-primary">
                  {t.badge}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 h-1.5 bg-primary" />
            </article>
          ))}
        </div>
        <div className="mt-3 flex justify-center gap-1.5 md:hidden" aria-hidden>
          {CARDS.map((t, i) => (
            <span
              key={t.title}
              className={`size-2 rounded-full transition-colors duration-200 ${
                i === active ? "bg-primary" : "bg-line"
              }`}
            />
          ))}
        </div>
        <p className="mt-4 rounded-xl bg-primary/10 px-4 py-3 text-[15px] font-medium text-navy">
          Трансфер до терминалов B и C — бесплатно в обе стороны при стоянке от
          4 суток.
        </p>
      </div>
    </section>
  );
}
