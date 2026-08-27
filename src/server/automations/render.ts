import type { Booking, Client } from "@prisma/client";
import { fmtDate, fmtRange } from "@/server/lib/dates";
import { VEHICLE_LABEL } from "@/lib/crm/labels";

export function renderTemplate(body: string, ctx: { booking: Booking; client: Client | null }): string {
  const { booking, client } = ctx;
  const vars: Record<string, string> = {
    "client.name": client?.name || booking.contactName || "",
    "client.phone": client?.phone || booking.contactPhone || "",
    "booking.number": String(booking.number),
    "booking.dates": fmtRange(booking.dateFrom, booking.dateTo),
    "booking.dateFrom": fmtDate(booking.dateFrom, { day: "numeric", month: "long" }),
    "booking.dateTo": fmtDate(booking.dateTo, { day: "numeric", month: "long" }),
    "booking.vehicle": [booking.vehicleType ? VEHICLE_LABEL[booking.vehicleType] : "", booking.plate ?? ""].filter(Boolean).join(" "),
    "booking.amount": String(booking.amount),
    "site.url": process.env.NEXT_PUBLIC_SITE_URL ?? "",
  };
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "").replace(/\s{2,}/g, " ").replace(/ ,/g, ",").trim();
}
