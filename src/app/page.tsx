import type { Metadata } from "next";
import {
  Benefits,
  CtaBand,
  Directions,
  Faq,
  Footer,
  Gallery,
  Header,
  Hero,
  MiniBenefits,
  MobileCta,
  Promo,
  RestRooms,
  Reviews,
} from "@/components/sections";
import { cache } from "react";
import Tariffs from "@/components/Tariffs";
import { activeTariffs } from "@/server/services/pricing";
import { carLongTerm, sitePrice } from "@/lib/site-prices";

// Цены — из тарифов CRM на каждый показ: правка в CRM видна сразу. Статика/ISR не годятся — образ собирается без базы
export const dynamic = "force-dynamic";

// Один запрос на показ (описание + страница). База недоступна — страница открывается, цены «по запросу»
const siteTariffs = cache(() =>
  activeTariffs("PARKING").catch((e) => {
    console.error("site tariffs:", e);
    return [];
  }),
);

export async function generateMetadata(): Promise<Metadata> {
  const tariffs = await siteTariffs();
  const car = sitePrice(tariffs, "car", 1);
  const long = carLongTerm(tariffs);
  return {
    description: `Охраняемая парковка в 500 метрах от Шереметьево${car ? `: легковые — ${car} ₽/сутки` : ""}${car && long ? `, от ${long.minDays} суток — ${long.perDay} ₽` : ""}. Бесплатный трансфер до терминалов от 4 суток, комнаты отдыха, охрана и видеонаблюдение 24/7. Бронирование онлайн.`,
  };
}

export default async function Home() {
  const tariffs = await siteTariffs();
  return (
    <>
      <Header />
      <main>
        <Hero tariffs={tariffs} />
        <MiniBenefits />
        <Benefits />
        <Tariffs tariffs={tariffs} />
        <Promo tariffs={tariffs} />
        <RestRooms />
        <Gallery />
        <Reviews />
        <Faq />
        <Directions />
        <CtaBand />
      </main>
      <Footer />
      <MobileCta />
    </>
  );
}
