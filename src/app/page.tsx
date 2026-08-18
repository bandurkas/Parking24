import {
  Benefits,
  Directions,
  Footer,
  Gallery,
  Header,
  Hero,
  MobileCta,
  RestRooms,
  Tariffs,
} from "@/components/sections";

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
        <Directions />
      </main>
      <Footer />
      <MobileCta />
    </>
  );
}
