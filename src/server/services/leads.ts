import "server-only";
import type { VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePhone } from "@/lib/phone";
import { toDate } from "@/server/lib/dates";
import { createBooking } from "./bookings";

const VEHICLE: Record<string, VehicleType> = { car: "CAR", suv: "SUV", moto: "MOTO", truck: "TRUCK" };
const DEDUP_MS = 10 * 60_000;

export type SiteLead = {
  dateFrom: string;
  dateTo: string;
  vehicleType: "car" | "suv" | "moto" | "truck";
  phone?: string;
  dial?: string;
  utm?: Record<string, string>;
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

// Повторные клики / перезагрузки за 10 минут не плодят заявки.
export async function createSiteLead(lead: SiteLead) {
  const vehicleType = VEHICLE[lead.vehicleType];
  const phone = leadPhone(lead.phone, lead.dial);
  const dup = await prisma.booking.findFirst({
    where: {
      source: "SITE",
      createdAt: { gte: new Date(Date.now() - DEDUP_MS) },
      dateFrom: toDate(lead.dateFrom),
      dateTo: toDate(lead.dateTo),
      vehicleType,
      ...(phone ? { contactPhone: phone } : { contactPhone: null, utm: { path: ["ipHash"], equals: lead.ipHash } }),
    },
    orderBy: { createdAt: "desc" },
  });
  if (dup) return { booking: dup, duplicate: true };

  const notes: string[] = [];
  const rawDigits = (lead.phone ?? "").replace(/\D/g, "");
  if (!phone && rawDigits) notes.push(`Телефон с сайта не распознан: ${lead.dial ?? "+7"} ${rawDigits} — уточнить у клиента`);
  else if (!phone) notes.push("Телефон не указан — клиент напишет в WhatsApp");
  if (vehicleType === "TRUCK") notes.push("Грузовой транспорт — цена по запросу");
  const booking = await createBooking(
    {
      kind: "PARKING",
      phone,
      name: "",
      dateFrom: lead.dateFrom,
      dateTo: lead.dateTo,
      timeFrom: "",
      timeTo: "",
      vehicleType,
      plate: "",
      roomType: "",
      transferNeeded: false,
      source: "SITE",
      comment: notes.join(". "),
      status: "NEW",
      utm: { ...(lead.utm ?? {}), ipHash: lead.ipHash },
    },
    null,
  );
  // Кнопка на сайте = согласие с политикой ПД (текст под кнопкой)
  if (booking.clientId) {
    await prisma.client.updateMany({ where: { id: booking.clientId, consentPersonalAt: null }, data: { consentPersonalAt: new Date(), consentSource: "site" } });
  }
  return { booking, duplicate: false };
}
