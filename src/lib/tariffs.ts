// Тарифы — временный конфиг до подтверждения сетки заказчиком (ТЗ, вопрос №4)
// и до переезда в БД/CRM. Цены со старого сайта parking24pitstop.ru.

export type VehicleType = {
  id: string;
  label: string;
  perDay: number;
  note: string;
};

export const VEHICLE_TYPES: VehicleType[] = [
  { id: "car", label: "Легковая", perDay: 350, note: "Седаны, хэтчбеки, универсалы." },
  { id: "suv", label: "Кроссовер / минивэн", perDay: 400, note: "Внедорожники, кроссоверы и минивэны." },
  { id: "moto", label: "Мотоцикл", perDay: 150, note: "Мотоциклы и скутеры." },
];

// Грузовой транспорт — цена по габаритам (не подтверждена заказчиком)
export const TRUCK = {
  label: "Грузовая / фура / автобус",
  note: "Фуры, автобусы, спецтехника — цена зависит от габаритов.",
};

// От 30 суток — 250 ₽/сутки (легковая)
export const LONG_TERM = { minDays: 30, perDay: 250 };

export const FREE_TRANSFER_MIN_DAYS = 4;

export const PHONE = "+7 (905) 525-06-60";
export const PHONE_HREF = "tel:+79055250660";
export const WHATSAPP = "79055250660";
export const TELEGRAM = "parking24pitstop";
export const ADDRESS = "МО, г. о. Химки, село Чашниково";

export function calcPrice(typeId: string, days: number): number {
  const type = VEHICLE_TYPES.find((t) => t.id === typeId);
  if (!type || days <= 0) return 0;
  if (type.id === "car" && days >= LONG_TERM.minDays) {
    return days * LONG_TERM.perDay;
  }
  return days * type.perDay;
}

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
