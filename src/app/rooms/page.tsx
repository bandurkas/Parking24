import type { Metadata } from "next";
import Image from "next/image";
import {
  Bath,
  BedDouble,
  Briefcase,
  Bus,
  Coffee,
  Droplets,
  Ruler,
  ShowerHead,
  WashingMachine,
  Wind,
} from "lucide-react";
import { Footer, Header, MobileCta } from "@/components/sections";
import { ROOMS, ROOM_EXTRAS } from "@/lib/rooms";
import { WHATSAPP } from "@/lib/tariffs";

export const metadata: Metadata = {
  title: "Комнаты отдыха «Улётная ночёвка» — Паркинг 24 Питстоп",
  description:
    "Комнаты отдыха у аэропорта Шереметьево: номера с двуспальной кроватью, двух- и трёхместные, койко-места от 800 ₽ за 12 часов. Душ, прачечная, завтраки и обеды.",
};

const FACTS = [
  { icon: Ruler, label: "Номера 15 м²" },
  { icon: Briefcase, label: "Рабочая зона" },
  { icon: Coffee, label: "Завтраки и обеды" },
  { icon: BedDouble, label: "Свежее бельё" },
];

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export default function RoomsPage() {
  return (
    <>
      <Header />
      <main>
        <section className="bg-surface py-10 lg:py-14">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-3xl font-bold [text-wrap:balance] sm:text-4xl">
                Комнаты отдыха «Улётная ночёвка»
              </h1>
              <p className="tnum w-fit shrink-0 rounded-full bg-primary-soft px-4 py-2 text-lg font-bold text-primary-deep">
                от 800 ₽{" "}
                <span className="text-sm font-medium text-primary-deep">
                  / 12 часов
                </span>
              </p>
            </div>
            <p className="mt-3 max-w-2xl leading-relaxed text-ink-muted">
              Тёплые и уютные номера прямо на стоянке — выспаться перед рейсом
              или отдохнуть после долгой дороги.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2.5">
              {FACTS.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-3 rounded-full border border-line bg-white py-2.5 pl-3 pr-6 text-[15px] font-medium shadow-card"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-steel/10">
                    <Icon className="size-5 text-steel" aria-hidden />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12">
          <div className="grid gap-5 md:grid-cols-2">
            {ROOMS.map((room) => (
              <article
                key={room.id}
                id={room.id}
                className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-white shadow-card"
              >
                {room.hasPhoto && (
                  <Image
                    src={`/photos/rooms/${room.id}.jpg`}
                    alt={`${room.name} — ${room.beds}`}
                    width={950}
                    height={700}
                    loading="lazy"
                    className="aspect-[8/5] w-full object-cover"
                  />
                )}
                <div className="p-5">
                  <h2 className="text-xl font-semibold">{room.name}</h2>
                  <p className="mt-0.5 text-ink-muted">{room.beds}</p>
                  <div className="mt-4 flex gap-3">
                    <div className="flex-1 rounded-xl bg-surface-soft p-3 text-center">
                      <div className="tnum text-2xl font-bold">
                        {fmt(room.price12)} ₽
                      </div>
                      <div className="text-sm text-ink-muted">12 часов</div>
                    </div>
                    <div className="flex-1 rounded-xl bg-surface-soft p-3 text-center">
                      <div className="tnum text-2xl font-bold">
                        {fmt(room.price24)} ₽
                      </div>
                      <div className="text-sm text-ink-muted">сутки</div>
                    </div>
                  </div>
                  <a
                    href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Здравствуйте! Хочу забронировать комнату отдыха: ${room.name} (${room.beds}).`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 flex h-12 items-center justify-center rounded-xl bg-cta text-[15px] font-semibold text-ink transition-colors duration-200 hover:bg-cta-dark"
                  >
                    Забронировать
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-surface py-12">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold">Дополнительные услуги</h2>
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {ROOM_EXTRAS.map((extra, i) => {
                const Icon = [
                  ShowerHead,
                  Bath,
                  WashingMachine,
                  Wind,
                  Droplets,
                  Coffee,
                  Bus,
                ][i];
                return (
                  <li
                    key={extra}
                    className="tnum flex items-center gap-3 rounded-full border border-line bg-white py-2.5 pl-3 pr-6 text-[15px] font-medium shadow-card"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft">
                      <Icon className="size-5 text-primary-dark" aria-hidden />
                    </span>
                    {extra}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-sm text-ink-muted">
              Бронирование комнат — по телефону или в WhatsApp. Онлайн-оплата
              скоро появится.
            </p>
          </div>
        </section>
      </main>
      <Footer />
      <MobileCta />
    </>
  );
}
