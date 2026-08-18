"use client";

import { useRef, useState } from "react";

const TARIFFS = [
  {
    title: "Легковая",
    price: "350 ₽",
    unit: "/сутки",
    note: "Седаны, хэтчбеки, универсалы.",
  },
  {
    title: "Кроссовер / минивэн",
    price: "400 ₽",
    unit: "/сутки",
    note: "Внедорожники, кроссоверы и минивэны.",
  },
  {
    title: "От 30 суток",
    price: "250 ₽",
    unit: "/сутки",
    note: "Уезжаете надолго? Экономия 100 ₽ с каждых суток — 3 000 ₽ за месяц.",
  },
];

export default function Tariffs() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || !el.firstElementChild) return;
    const cardWidth = (el.firstElementChild as HTMLElement).offsetWidth + 12;
    setActive(Math.min(TARIFFS.length - 1, Math.round(el.scrollLeft / cardWidth)));
  };

  return (
    <section id="tariffs" className="bg-surface py-12 lg:py-14">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-3xl font-bold">Тарифы</h2>
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="-mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0"
        >
          {TARIFFS.map((t) => (
            <article
              key={t.title}
              className="relative w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl bg-white p-6 shadow-card md:w-auto md:shrink"
            >
              <h3 className="font-semibold text-primary">{t.title}</h3>
              <div className="tnum mt-2 text-4xl font-bold">
                {t.price}
                <span className="text-lg font-medium text-ink-muted">{t.unit}</span>
              </div>
              <p className="mt-2 text-sm text-ink-muted">{t.note}</p>
              <span className="absolute inset-x-0 bottom-0 h-1.5 bg-primary" />
            </article>
          ))}
        </div>
        <div
          className="mt-3 flex justify-center gap-1.5 md:hidden"
          role="tablist"
          aria-label="Тарифы — переключение карточек"
        >
          {TARIFFS.map((t, i) => (
            <span
              key={t.title}
              className={`size-2 rounded-full transition-colors duration-200 ${
                i === active ? "bg-primary" : "bg-line"
              }`}
            />
          ))}
        </div>
        <p className="tnum mt-4 text-sm text-ink-muted">
          Мотоцикл — 150 ₽/сутки. Грузовой транспорт — цена по габаритам,
          уточните в WhatsApp.
        </p>
        <p className="mt-3 rounded-xl bg-primary/10 px-4 py-3 text-[15px] font-medium text-navy">
          Трансфер до терминалов B и C — бесплатно в обе стороны при стоянке от
          4 суток.
        </p>
      </div>
    </section>
  );
}
