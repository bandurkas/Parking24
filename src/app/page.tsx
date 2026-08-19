import {
  Benefits,
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

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <MiniBenefits />
        <Benefits />
        <Tariffs />
        <Promo />
        <RestRooms />
        <Gallery />
        <Reviews />
        <Faq />
        <Directions />
      </main>
      <Footer />
      <MobileCta />
    </>
  );
}
