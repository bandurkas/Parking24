import type { BookingStatus, Channel, RejectKind } from "@prisma/client";
import { formatPhone } from "./phone";
import { CHANNEL_LABEL } from "./crm/labels";

// Ф8: сегмент «не смогли к нам попасть» — клиенты с отказом «мест нет» (Booking.rejectKind = NO_SPACE).
// Только для личного звонка клиенту по его заявке; для рекламных рассылок без согласия не использовать
// (ст. 18 ФЗ «О рекламе», DECISIONS 24.09 §4 п.3).

// Бронь состоялась: место дали
export const BOOKED: BookingStatus[] = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

// Брони клиента: отказы NO_SPACE и брони в статусах BOOKED (одна выборка)
export type SegBooking = {
  id: string;
  number: number;
  status: BookingStatus;
  rejectKind: RejectKind | null;
  rejectedAt: Date | null;
  createdAt: Date;
  dateFrom: Date;
  dateTo: Date;
};

export type SegClient = { id: string; name: string | null; phone: string; messenger: Channel | null; doNotDisturb: boolean; bookings: SegBooking[] };

export type NoSpaceRow = {
  id: string;
  name: string | null;
  phone: string;
  messenger: Channel | null;
  doNotDisturb: boolean;
  lastRejectedAt: Date;
  rejectCount: number;
  missed: { id: string; number: number; dateFrom: Date; dateTo: Date };
  bookedLater: { id: string; number: number; status: BookingStatus } | null;
};

const rejectAt = (b: SegBooking) => b.rejectedAt ?? b.createdAt;

// «Потом забронировал» — бронь в BOOKED, созданная после последнего отказа, или сам последний отказ,
// возвращённый в работу (после Ф10 отметка NO_SPACE при возврате не стирается)
export function noSpaceRow(c: SegClient): NoSpaceRow | null {
  const rejects = c.bookings.filter((b) => b.rejectKind === "NO_SPACE");
  if (!rejects.length) return null;
  const last = rejects.reduce((a, b) => (rejectAt(b) > rejectAt(a) ? b : a));
  const lastAt = rejectAt(last);
  const later = c.bookings
    .filter((b) => BOOKED.includes(b.status) && (b.id === last.id || b.createdAt > lastAt))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    messenger: c.messenger,
    doNotDisturb: c.doNotDisturb,
    lastRejectedAt: lastAt,
    rejectCount: rejects.length,
    missed: { id: last.id, number: last.number, dateFrom: last.dateFrom, dateTo: last.dateTo },
    bookedLater: later ? { id: later.id, number: later.number, status: later.status } : null,
  };
}

// Свежие отказы сверху
export function noSpaceRows(clients: SegClient[]): NoSpaceRow[] {
  return clients
    .map(noSpaceRow)
    .filter((r): r is NoSpaceRow => r !== null)
    .sort((a, b) => b.lastRejectedAt.getTime() - a.lastRejectedAt.getTime());
}

const MSK = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

// Ячейка CSV: кавычки удваиваются; значение, которое Excel принял бы за формулу (имя с сайта, телефон «+7…»), — с апострофом
export function csvCell(v: string | number): string {
  const s = String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
}

export const NO_SPACE_CSV_HEAD = ["Телефон", "Имя", "Мессенджер", "Не беспокоить", "Отказ (МСК)", "Отказов", "Не попал с", "Не попал по", "Заявка №", "Потом забронировал №"];

// Разделитель «;» и BOM (добавляет вызывающий) — Excel открывает русскими буквами. Даты заявки — календарные (UTC)
export function noSpaceCsv(rows: NoSpaceRow[]): string {
  const lines = rows.map((r) => [
    formatPhone(r.phone),
    r.name ?? "",
    r.messenger ? CHANNEL_LABEL[r.messenger] : "",
    r.doNotDisturb ? "да" : "",
    MSK.format(r.lastRejectedAt).replace(",", ""),
    r.rejectCount,
    DAY.format(r.missed.dateFrom),
    DAY.format(r.missed.dateTo),
    r.missed.number,
    r.bookedLater?.number ?? "",
  ]);
  return [NO_SPACE_CSV_HEAD, ...lines].map((l) => l.map(csvCell).join(";")).join("\r\n");
}
