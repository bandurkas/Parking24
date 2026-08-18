// Комнаты отдыха «Улётная ночёвка» — данные со страницы parking24pitstop.ru/otdix (18.08.2026).
// Фото: положить в public/photos/rooms/<id>.jpg — карточка подхватит автоматически (hasPhoto: true).

export type Room = {
  id: string;
  name: string;
  beds: string;
  price12: number;
  price24: number;
  hasPhoto: boolean;
};

export const ROOMS: Room[] = [
  {
    id: "comfort-double",
    name: "Комфорт",
    beds: "Двуспальная кровать",
    price12: 2200,
    price24: 2500,
    hasPhoto: true,
  },
  {
    id: "twin",
    name: "Двухместный",
    beds: "Две односпальные кровати",
    price12: 2200,
    price24: 2500,
    hasPhoto: true,
  },
  {
    id: "triple",
    name: "Трёхместный",
    beds: "Три односпальные кровати",
    price12: 2500,
    price24: 2700,
    hasPhoto: true,
  },
  {
    id: "bunk",
    name: "Койко-место",
    beds: "Двухъярусные кровати",
    price12: 800,
    price24: 1200,
    hasPhoto: true,
  },
];

export const ROOM_FACTS = "15 м² · рабочая зона · тепло и уютно";

export const ROOM_EXTRAS = [
  "Душ — 250 ₽",
  "Душ с полотенцем — 300 ₽",
  "Стирка — 350 ₽",
  "Стирка и сушка — 450 ₽",
  "Умыться, побриться — 100 ₽",
  "Завтраки и обеды",
  "Трансфер из аэропорта — 300 ₽",
];
