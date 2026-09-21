import type { Booking, Client } from "@prisma/client";
import { fmtDate, fmtDayTime, fmtRange } from "@/server/lib/dates";
import { VEHICLE_LABEL } from "@/lib/crm/labels";
import { plural } from "@/lib/tariffs";

export type RenderExtras = {
  route?: string;
  review?: string;
  contract?: string | null;
  checkedInAt?: string | null;
};

// Обращение целиком, чтобы без имени не получилось «Здравствуйте, !».
// Заказчик правит текст шаблона, а склейку имени берёт на себя эта переменная.
function greeting(name: string, style: "hello" | "name"): string {
  if (style === "hello") return name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
  return name ? `${name}, ` : "";
}

export function renderTemplate(body: string, ctx: { booking: Booking; client: Client | null }, extras: RenderExtras = {}): string {
  const { booking, client } = ctx;
  const name = (client?.name || booking.contactName || "").trim();
  const due = Math.max(0, booking.amount - booking.paidAmount);
  const days = booking.days;

  const vars: Record<string, string> = {
    "client.name": name,
    "client.phone": client?.phone || booking.contactPhone || "",
    "greeting.hello": greeting(name, "hello"),
    "greeting.name": greeting(name, "name"),
    "booking.number": String(booking.number),
    "booking.contract": extras.contract ?? "",
    "booking.dates": fmtRange(booking.dateFrom, booking.dateTo),
    "booking.dateFrom": fmtDate(booking.dateFrom, { day: "numeric", month: "long" }),
    "booking.dateTo": fmtDate(booking.dateTo, { day: "numeric", month: "long" }),
    "booking.arrival": fmtDayTime(booking.dateFrom, booking.timeFrom),
    "booking.departure": fmtDayTime(booking.dateTo, booking.timeTo),
    "booking.checkedInAt": extras.checkedInAt ?? "",
    "booking.days": `${days} ${plural(days, "сутки", "суток", "суток")}`,
    "booking.vehicle": [booking.vehicleType ? VEHICLE_LABEL[booking.vehicleType] : "", booking.plate ?? ""].filter(Boolean).join(" "),
    "booking.amount": String(booking.amount),
    "booking.due": String(due),
    "booking.dueLine": due > 0 ? `К оплате на месте: ${due.toLocaleString("ru-RU")} ₽, наличными или картой.` : "Бронь оплачена.",
    // Бесплатный трансфер — от 4 суток (признак ставится при создании брони)
    "booking.transferLine": booking.transferNeeded
      ? "Трансфер до терминала и обратно для вас бесплатный, дорога занимает 3–5 минут."
      : "Бесплатный трансфер действует при стоянке от 4 суток. По вашей брони он оплачивается отдельно, стоимость подскажет администратор.",
    "booking.returnLine": booking.transferNeeded
      ? "Когда прилетите и получите багаж, позвоните или напишите нам: +7 905 525-06-60. Пришлём за вами бесплатный трансфер."
      : "Если понадобится трансфер от терминала, позвоните или напишите нам: +7 905 525-06-60, стоимость подскажем.",
    "links.route": extras.route ?? "",
    "links.review": extras.review ?? "",
    "site.url": process.env.NEXT_PUBLIC_SITE_URL ?? "",
  };

  return (
    body
      .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "")
      // Схлопываем только пробелы и табуляцию: переносы строк в сообщении осмысленны
      .replace(/[ \t]{2,}/g, " ")
      // Пустая переменная оставляет пробел перед знаком препинания
      .replace(/ +([,.!?:;])/g, "$1")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      // Не больше одной пустой строки подряд: пустая переменная не должна рвать абзацы
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
