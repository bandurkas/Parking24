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
import Tariffs from "@/components/Tariffs";
import { activeTariffs } from "@/server/services/pricing";
import { carLongTerm, sitePrice } from "@/lib/site-prices";

// Цены — из тарифов CRM на каждый показ: правка в CRM видна сразу. Статика/ISR не годятся — образ собирается без базы
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const tariffs = await activeTariffs("PARKING");
  const long = carLongTerm(tariffs);
  return {
    description: `Охраняемая парковка в 500 метрах от Шереметьево: легковые — ${sitePrice(tariffs, "car", 1)} ₽/сутки${long ? `, от ${long.minDays} суток — ${long.perDay} ₽` : ""}. Бесплатный трансфер до терминалов от 4 суток, комнаты отдыха, охрана и видеонаблюдение 24/7. Бронирование онлайн.`,
  };
}

export default async function Home() {
  const tariffs = await activeTariffs("PARKING");
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
