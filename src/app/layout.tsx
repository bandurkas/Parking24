import type { Metadata, Viewport } from "next";
import { Golos_Text } from "next/font/google";
import "./globals.css";

const golos = Golos_Text({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-golos",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Паркинг 24 Питстоп — охраняемая парковка у Шереметьево",
  description:
    "Охраняемая парковка в 500 метрах от Шереметьево: легковые — 350 ₽/сутки, от 30 суток — 250 ₽. Бесплатный трансфер до терминалов от 4 суток, комнаты отдыха, охрана и видеонаблюдение 24/7. Бронирование онлайн.",
  keywords: [
    "парковка Шереметьево",
    "стоянка у аэропорта",
    "парковка Шереметьево долгосрочная",
    "паркинг питстоп",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={golos.variable}>
      <body>{children}</body>
    </html>
  );
}
