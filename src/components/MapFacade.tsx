"use client";

import { useState } from "react";
import Image from "next/image";
import { MapPin } from "lucide-react";

// Фасад карты: мгновенно показываем лёгкую статичную картинку,
// тяжёлый интерактивный виджет Яндекса грузится только по тапу.
export default function MapFacade({ src, title }: { src: string; title: string }) {
  const [live, setLive] = useState(false);

  if (live) {
    return (
      <iframe
        title={title}
        src={src}
        className="h-72 w-full rounded-2xl border border-line lg:h-full lg:min-h-96"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLive(true)}
      aria-label="Открыть интерактивную карту"
      className="group relative h-72 w-full cursor-pointer overflow-hidden rounded-2xl border border-line lg:h-full lg:min-h-96"
    >
      <Image
        src="/photos/map-preview.jpg"
        alt="Карта: Паркинг 24 Питстоп рядом с аэропортом Шереметьево, село Чашниково"
        fill
        loading="lazy"
        sizes="(min-width: 1024px) 50vw, 100vw"
        className="object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-navy/15 transition-colors duration-200 group-hover:bg-navy/25">
        <span className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-[15px] font-semibold text-primary shadow-card-lg transition-colors duration-200 group-hover:bg-cta group-hover:text-white">
          <MapPin className="size-4" aria-hidden />
          Открыть интерактивную карту
        </span>
      </span>
    </button>
  );
}
