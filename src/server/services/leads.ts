import "server-only";
import type { Booking, Prisma, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePhone } from "@/lib/phone";
import { fmtRange, toDate } from "@/server/lib/dates";
import { DECISION_OFF, decisionComment, isTransientDbError, rejectNoticeText, withOverloadFallback, type AutoDecision } from "@/lib/autoconfirm-decision";
import { createBooking, type CreateBookingData } from "./bookings";
import { decideSiteBooking, lockOccupancy } from "./autoconfirm";
import { notify } from "./notices";

const VEHICLE: Record<string, VehicleType> = { car: "CAR", suv: "SUV", moto: "MOTO", truck: "TRUCK" };
const DEDUP_MS = 10 * 60_000;

export type SiteLead = {
  dateFrom: string;
  dateTo: string;
  timeFrom?: string;
  timeTo?: string;
  name?: string;
  vehicleType: "car" | "suv" | "moto" | "truck";
  phone?: string;
  dial?: string;
  utm?: Record<string, string>;
  channels?: ("WHATSAPP" | "TELEGRAM" | "MAX")[];
  primary?: "WHATSAPP" | "TELEGRAM" | "MAX";
  ipHash: string;
};

// Телефон с сайта: код страны отдельно, номер — только цифры.
export function leadPhone(phone?: string, dial?: string): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const cc = (dial ?? "+7").replace(/\D/g, "") || "7";
  if (cc === "7") {
    if (digits.length === 11 && /^[78]/.test(digits)) digits = digits.slice(1);
  } else if (digits.startsWith(cc) && digits.length - cc.length >= 7) {
    digits = digits.slice(cc.length);
  }
  return normalizePhone(cc + digits);
}

// Повтор заявки: с сайта за 10 минут, те же даты и тип машины, тот же телефон (без телефона — тот же адрес)
export function duplicateLeadWhere(lead: Pick<SiteLead, "dateFrom" | "dateTo" | "ipHash">, phone: string | null, vehicleType: VehicleType, now = Date.now()): Prisma.BookingWhereInput {
  return {
    source: "SITE",
    createdAt: { gte: new Date(now - DEDUP_MS) },
    dateFrom: toDate(lead.dateFrom),
    dateTo: toDate(lead.dateTo),
    vehicleType,
    ...(phone ? { contactPhone: phone } : { contactPhone: null, utm: { path: ["ipHash"], equals: lead.ipHash } }),
  };
}

export async function findDuplicateLead(db: Pick<Prisma.TransactionClient, "booking">, lead: Pick<SiteLead, "dateFrom" | "dateTo" | "ipHash">, phone: string | null, vehicleType: VehicleType): Promise<Booking | null> {
  return db.booking.findFirst({ where: duplicateLeadWhere(lead, phone, vehicleType), orderBy: { createdAt: "desc" } });
}

// Повтор найден под блокировкой: транзакция откатывается, записей нет
export class DuplicateLead extends Error {
  constructor(readonly bookingId: string) {
    super("duplicate lead");
  }
}

// Замок и поиск повтора — всегда; overload отключает только автоматическое решение.
// Уведомление об автоотклонении — в той же транзакции: брони «Отклонена» без уведомления не бывает.
async function createLeadBooking(data: CreateBookingData, lead: SiteLead, phone: string | null, vehicleType: VehicleType, overload: boolean) {
  let decision: AutoDecision = DECISION_OFF;
  const booking = await createBooking(data, null, {
    decide: async (tx, { amount }) => {
      await lockOccupancy(tx);
      const dup = await findDuplicateLead(tx, lead, phone, vehicleType);
      if (dup) throw new DuplicateLead(dup.id);
      decision = await decideSiteBooking(tx, { dateFrom: lead.dateFrom, dateTo: lead.dateTo, vehicleType, phone, amount }, overload);
      return { status: decision.status, note: decisionComment(decision), rejectKind: decision.status === "REJECTED" ? "NO_SPACE" : null };
    },
    afterCreate: async (tx, b) => {
      if (decision.status !== "REJECTED") return;
      const text = rejectNoticeText(b.number, fmtRange(b.dateFrom, b.dateTo), decision.peak, decision.limit);
      await notify("BOOKING_REJECTED", text, b.id, tx); // Ф2б: tx → { tx, key: rejectNoticeKey(b.id) }
    },
  });
  return { booking, decision };
}

// Повторные клики / перезагрузки за 10 минут не плодят заявки.
export async function createSiteLead(lead: SiteLead) {
  const vehicleType = VEHICLE[lead.vehicleType];
  const phone = leadPhone(lead.phone, lead.dial);
  // Быстрый путь — двойной клик не встаёт в очередь за замком; источник истины — проверка под замком
  let dup = await findDuplicateLead(prisma, lead, phone, vehicleType).catch((e) => {
    if (isTransientDbError(e)) return null;
    throw e;
  });
  let created: { booking: Booking; decision: AutoDecision } | null = null;

  if (!dup) {
    const notes: string[] = [];
    const rawDigits = (lead.phone ?? "").replace(/\D/g, "");
    if (!phone && rawDigits) notes.push(`Телефон с сайта не распознан: ${lead.dial ?? "+7"} ${rawDigits} — уточнить у клиента`);
    else if (!phone) notes.push("Телефон не указан — клиент напишет в WhatsApp");
    if (vehicleType === "TRUCK") notes.push("Грузовой транспорт — цена по запросу");
    const data: CreateBookingData = {
      kind: "PARKING",
      phone,
      name: (lead.name ?? "").trim().slice(0, 60),
      dateFrom: lead.dateFrom,
      dateTo: lead.dateTo,
      timeFrom: lead.timeFrom ?? "",
      timeTo: lead.timeTo ?? "",
      vehicleType,
      plate: "",
      roomType: "",
      transferNeeded: false,
      source: "SITE",
      comment: notes.join(". "),
      status: "NEW",
      utm: { ...(lead.utm ?? {}), ipHash: lead.ipHash },
      channels: lead.channels,
      messenger: lead.primary ?? null,
    };
    try {
      created = await withOverloadFallback(
        (overload) => createLeadBooking(data, lead, phone, vehicleType, overload),
        (e) => console.error("lead: временная ошибка базы, повтор без автоматики:", e),
      );
    } catch (e) {
      if (!(e instanceof DuplicateLead)) throw e;
      dup = await prisma.booking.findUniqueOrThrow({ where: { id: e.bookingId } });
    }
  }

  if (dup) {
    if (dup.clientId && lead.channels?.length) {
      const messenger = lead.primary ?? lead.channels[0];
      // Клиент передумал, куда писать — неотправленное сообщение уходит в новый канал (одной транзакцией)
      await prisma.$transaction([
        prisma.client.update({ where: { id: dup.clientId }, data: { channels: lead.channels, messenger } }),
        prisma.outbox.updateMany({ where: { bookingId: dup.id, status: "PENDING" }, data: { channel: messenger } }),
      ]);
    }
    return { booking: dup, duplicate: true, decision: null };
  }

  const { booking, decision } = created!;
  // Кнопка на сайте = согласие с политикой ПД (текст под кнопкой)
  if (booking.clientId) {
    await prisma.client.updateMany({ where: { id: booking.clientId, consentPersonalAt: null }, data: { consentPersonalAt: new Date(), consentSource: "site" } });
  }
  return { booking, duplicate: false, decision };
}
