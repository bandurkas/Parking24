import type { BookingSource, BookingStatus, ClientStatus, Role, VehicleType, ResourceKind, PaymentMethod, Channel } from "@prisma/client";

export const STATUS_LABEL: Record<BookingStatus, string> = {
  NEW: "Новая заявка",
  AWAITING_PAYMENT: "Ожидает оплаты",
  CONFIRMED: "Подтверждена",
  CHECKED_IN: "Заехал",
  CHECKED_OUT: "Выехал",
  CANCELLED: "Отменена",
  NO_SHOW: "Не приехал",
};

export const STATUS_SHORT: Record<BookingStatus, string> = {
  NEW: "Новая",
  AWAITING_PAYMENT: "Ждёт оплаты",
  CONFIRMED: "Оплачена",
  CHECKED_IN: "На стоянке",
  CHECKED_OUT: "Выехал",
  CANCELLED: "Отмена",
  NO_SHOW: "No-show",
};

// Классы чипов статуса (tailwind, токены сайта)
export const STATUS_CHIP: Record<BookingStatus, string> = {
  NEW: "bg-steel/12 text-navy ring-steel/30",
  AWAITING_PAYMENT: "bg-warning/15 text-[#8a5a00] ring-warning/40",
  CONFIRMED: "bg-primary-soft text-primary-deep ring-primary/40",
  CHECKED_IN: "bg-success/12 text-[#0b7a4c] ring-success/40",
  CHECKED_OUT: "bg-surface text-ink-muted ring-line",
  CANCELLED: "bg-danger/8 text-danger ring-danger/30",
  NO_SHOW: "bg-danger/8 text-danger ring-danger/30",
};

export const STATUS_DOT: Record<BookingStatus, string> = {
  NEW: "bg-steel",
  AWAITING_PAYMENT: "bg-warning",
  CONFIRMED: "bg-primary",
  CHECKED_IN: "bg-success",
  CHECKED_OUT: "bg-ink-muted",
  CANCELLED: "bg-danger",
  NO_SHOW: "bg-danger",
};

export const PIPELINE: BookingStatus[] = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
export const TERMINAL: BookingStatus[] = ["CANCELLED", "NO_SHOW"];

export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  NEW: ["AWAITING_PAYMENT", "CONFIRMED", "CANCELLED"],
  AWAITING_PAYMENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "NO_SHOW", "CANCELLED"],
  CHECKED_IN: ["CHECKED_OUT"],
  CHECKED_OUT: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const GUARD_TRANSITIONS: BookingStatus[] = ["CHECKED_IN", "CHECKED_OUT"];

export const TRANSITION_VERB: Partial<Record<BookingStatus, string>> = {
  AWAITING_PAYMENT: "Выставить оплату",
  CONFIRMED: "Подтвердить",
  CHECKED_IN: "Заехал",
  CHECKED_OUT: "Выехал",
  CANCELLED: "Отменить",
  NO_SHOW: "Не приехал",
};

export const SOURCE_LABEL: Record<BookingSource, string> = {
  SITE: "Сайт",
  CALL: "Звонок",
  WHATSAPP: "WhatsApp",
  TELEGRAM: "Telegram",
  TWO_GIS: "2ГИС",
  INSTAGRAM: "Instagram",
  ADS: "Реклама",
  BUSINESS_CARD: "Визитка",
  REFERRAL: "Рекомендация",
  OTHER: "Другое",
};

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  CAR: "Легковая",
  SUV: "Кроссовер",
  MOTO: "Мото",
  TRUCK: "Грузовая",
};

export const VEHICLE_SHORT: Record<VehicleType, string> = {
  CAR: "Легк",
  SUV: "Кросс",
  MOTO: "Мото",
  TRUCK: "Груз",
};

export const KIND_LABEL: Record<ResourceKind, string> = {
  PARKING: "Парковка",
  ROOM: "Комнаты отдыха",
  PET: "Передержка",
};

export const KIND_SLUG: Record<ResourceKind, string> = { PARKING: "parking", ROOM: "rooms", PET: "pets" };
export const SLUG_KIND: Record<string, ResourceKind> = { parking: "PARKING", rooms: "ROOM", pets: "PET" };

export const ROLE_LABEL: Record<Role, string> = { OWNER: "Владелец", ADMIN: "Администратор", GUARD: "Охрана" };

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Наличные",
  CARD_TERMINAL: "Карта (терминал)",
  TRANSFER: "Перевод",
  ONLINE: "Онлайн",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  PHONE: "Телефон",
  WHATSAPP: "WhatsApp",
  TELEGRAM: "Telegram",
  MAX: "MAX",
  SMS: "SMS",
  EMAIL: "Email",
  SITE: "Сайт",
};

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  LEAD: "Лид",
  ACTIVE: "Активный",
  VIP: "VIP",
  LOST: "Потерян",
  BLOCKED: "Чёрный список",
};

export const CLIENT_STATUS_CHIP: Record<ClientStatus, string> = {
  LEAD: "bg-steel/12 text-navy ring-steel/30",
  ACTIVE: "bg-success/12 text-[#0b7a4c] ring-success/40",
  VIP: "bg-primary-soft text-primary-deep ring-primary/40",
  LOST: "bg-surface text-ink-muted ring-line",
  BLOCKED: "bg-danger/8 text-danger ring-danger/30",
};

export const CLIENT_TAGS: string[] = ["постоянный", "долгосрочный", "грузовой", "мото", "комнаты", "корпоративный", "трансфер", "просил скидку", "конфликтный"];
