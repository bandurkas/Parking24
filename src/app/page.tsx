import {
  Benefits,
  Directions,
  Faq,
  Footer,
  Gallery,
  Header,
  Hero,
  MobileCta,
  RestRooms,
} from "@/components/sections";
import Tariffs from "@/components/Tariffs";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Benefits />
        <Tariffs />
        <RestRooms />
        <Gallery />
        <Faq />
        <Directions />
      </main>
      <Footer />
      <MobileCta />
    </>
  );
}
