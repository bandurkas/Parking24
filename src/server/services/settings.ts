import "server-only";
import { prisma } from "@/server/db/prisma";

// Настройки парковки из таблицы Setting. Значения по умолчанию — из ТЗ 21.09 и ответов заказчика 22.09.
export const SETTINGS = {
  capacityTotal: { key: "parking.capacityTotal", def: 405, label: "Всего мест (легковые, кроссоверы, мото)" },
  capacityTruck: { key: "parking.capacityTruck", def: 10, label: "Мест для грузовых" },
  autoConfirmLimit: { key: "parking.autoConfirmLimit", def: 395, label: "Автоподтверждение, пока занято меньше" },
  autoConfirm: { key: "parking.autoConfirm", def: false, label: "Автоподтверждение заявок с сайта" },
} as const;

// Ссылки, которые подставляются в сообщения клиентам. Ждём от заказчика.
export const LINKS = {
  route: { key: "links.route", def: "", label: "Ссылка на маршрут проезда" },
  review: { key: "links.review", def: "", label: "Ссылка на отзывы" },
} as const;

export type ParkingSettings = {
  capacityTotal: number;
  capacityTruck: number;
  autoConfirmLimit: number;
  autoConfirm: boolean;
};

function num(value: unknown, def: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : def;
}

export async function parkingSettings(): Promise<ParkingSettings> {
  const keys = Object.values(SETTINGS).map((s) => s.key);
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const capacityTotal = num(get(SETTINGS.capacityTotal.key), SETTINGS.capacityTotal.def);
  return {
    capacityTotal,
    capacityTruck: num(get(SETTINGS.capacityTruck.key), SETTINGS.capacityTruck.def),
    // порог не может превышать вместимость: иначе автоподтверждение уйдёт за пределы стоянки
    autoConfirmLimit: Math.min(capacityTotal, num(get(SETTINGS.autoConfirmLimit.key), SETTINGS.autoConfirmLimit.def)),
    autoConfirm: get(SETTINGS.autoConfirm.key) === true,
  };
}

export async function setSetting(key: string, value: number | boolean | string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export type SiteLinks = { route: string; review: string };

export async function siteLinks(): Promise<SiteLinks> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [LINKS.route.key, LINKS.review.key] } } });
  const str = (key: string, def: string) => {
    const v = rows.find((r) => r.key === key)?.value;
    return typeof v === "string" && v.trim() ? v.trim() : def;
  };
  // Пока заказчик не дал ссылки, в сообщении остаётся адрес сайта — пустая строка выглядела бы обрывом
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return { route: str(LINKS.route.key, site ? `${site}/#route` : ""), review: str(LINKS.review.key, "") };
}
