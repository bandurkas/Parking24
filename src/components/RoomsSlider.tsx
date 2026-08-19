"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BedDouble } from "lucide-react";
import { ROOMS } from "@/lib/rooms";

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export default function RoomsSlider() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || !el.firstElementChild) return;
    const cardWidth = (el.firstElementChild as HTMLElement).offsetWidth + 12;
    setActive(Math.min(ROOMS.length - 1, Math.round(el.scrollLeft / cardWidth)));
  };

  return (
    <>
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="-mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0"
      >
        {ROOMS.map((room) => (
          <article
            key={room.id}
            className="flex w-[78%] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card sm:w-[45%] lg:w-auto lg:shrink"
          >
            {room.hasPhoto ? (
              <Image
                src={`/photos/rooms/${room.id}.jpg`}
                alt={`${room.name} — ${room.beds}`}
                width={480}
                height={300}
                loading="lazy"
                className="aspect-[8/5] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[8/5] w-full items-center justify-center bg-steel/10">
                <BedDouble className="size-12 text-steel/50" aria-hidden />
              </div>
            )}
            <div className="flex flex-1 flex-col p-4">
              <h3 className="font-semibold">{room.name}</h3>
              <p className="mt-0.5 text-sm text-ink-muted">{room.beds}</p>
              <div className="tnum mt-3 text-2xl font-bold">
                {fmt(room.price12)} ₽
                <span className="text-sm font-medium text-ink-muted"> / 12 ч</span>
              </div>
              <p className="tnum mb-4 text-sm text-ink-muted">
                {fmt(room.price24)} ₽ / сутки
              </p>
              <Link
                href={`/rooms#${room.id}`}
                className="mt-auto flex h-11 items-center justify-center rounded-xl border border-line bg-white text-[15px] font-semibold text-ink transition-colors duration-200 hover:border-primary hover:text-primary"
              >
                Смотреть номер
              </Link>
            </div>
          </article>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-1.5 lg:hidden" aria-hidden>
        {ROOMS.map((room, i) => (
          <span
            key={room.id}
            className={`size-2 rounded-full transition-colors duration-200 ${
              i === active ? "bg-primary" : "bg-line"
            }`}
          />
        ))}
      </div>
      <p className="mt-3 text-center text-sm text-ink-muted">
        Заезд в любое время · оплата за 12 часов или сутки
      </p>
    </>
  );
}
