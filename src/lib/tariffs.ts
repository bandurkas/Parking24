// Типы авто и контакты сайта. Цены парковки — из тарифов CRM (src/lib/site-prices.ts), не отсюда.

export type VehicleType = {
  id: string;
  label: string;
  note: string;
};

export const VEHICLE_TYPES: VehicleType[] = [
  { id: "car", label: "Легковая", note: "Седаны, хэтчбеки, универсалы." },
  { id: "suv", label: "Кроссовер / минивэн", note: "Внедорожники, кроссоверы и минивэны." },
  { id: "moto", label: "Мотоцикл", note: "Мотоциклы и скутеры." },
];

// Грузовой транспорт — цена по габаритам (не подтверждена заказчиком)
export const TRUCK = {
  label: "Грузовая / фура / автобус",
  note: "Фуры, автобусы, спецтехника — цена зависит от габаритов.",
};

export const FREE_TRANSFER_MIN_DAYS = 4;

export const PHONE = "+7 (905) 525-06-60";
export const PHONE_HREF = "tel:+79055250660";
export const WHATSAPP = "6281219010408"; // временно: номер заказчика проекта, боевой 79055250660
export const TELEGRAM = "parking24pitstop";
// Ссылка на аккаунт компании в MAX (max.ru) — заполнить, когда заказчик даст; пустая = кнопка «скоро»
export const MAX_LINK = "";

export type SiteChannel = "WHATSAPP" | "TELEGRAM" | "MAX";
export const CHANNEL_NAME: Record<SiteChannel, string> = { WHATSAPP: "WhatsApp", TELEGRAM: "Telegram", MAX: "MAX" };
export function channelAvailable(c: SiteChannel): boolean {
  return c === "MAX" ? MAX_LINK.length > 0 : true;
}
export function messengerHref(c: SiteChannel, text: string): string {
  const t = encodeURIComponent(text);
  if (c === "WHATSAPP") return `https://wa.me/${WHATSAPP}?text=${t}`;
  if (c === "TELEGRAM") return `https://t.me/${TELEGRAM}?text=${t}`;
  return MAX_LINK;
}
export const ADDRESS = "МО, г. о. Химки, село Чашниково";

export function daysBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function formatRub(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
