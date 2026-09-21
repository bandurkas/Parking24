import type { Booking, Client } from "@prisma/client";
import { fmtDate, fmtDayTime, fmtRange } from "@/server/lib/dates";
import { VEHICLE_LABEL } from "@/lib/crm/labels";
import { FREE_TRANSFER_MIN_DAYS, plural } from "@/lib/tariffs";

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
  // Трансфер бесплатный по правилу от суток, а не по галочке «нужен трансфер» в брони
  const freeTransfer = booking.kind === "PARKING" && days >= FREE_TRANSFER_MIN_DAYS;

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
    // Суммы с разбивкой по разрядам, как в строке оплаты: «1 050» (разделитель неразрывный)
    "booking.amount": booking.amount.toLocaleString("ru-RU"),
    "booking.due": due.toLocaleString("ru-RU"),
    "booking.dueLine": due > 0 ? `К оплате на месте: ${due.toLocaleString("ru-RU")} ₽, наличными или картой.` : "Бронь оплачена.",
    "booking.transferLine": freeTransfer
      ? "Трансфер до терминала и обратно для вас бесплатный, дорога занимает 3–5 минут."
      : `Бесплатный трансфер действует при стоянке от ${FREE_TRANSFER_MIN_DAYS} суток. По вашей брони он оплачивается отдельно, стоимость подскажет администратор.`,
    "booking.returnLine": freeTransfer
      ? "Когда прилетите и получите багаж, позвоните или напишите нам: +7 905 525-06-60. Пришлём за вами бесплатный трансфер."
      : "Если понадобится трансфер от терминала, позвоните или напишите нам: +7 905 525-06-60, стоимость подскажем.",
    "links.route": extras.route ?? "",
    "links.review": extras.review ?? "",
    "site.url": process.env.NEXT_PUBLIC_SITE_URL ?? "",
  };

  const text = body
    .split("\n")
    .map((src) => {
      let total = 0;
      let filled = 0;
      const line = tidy(src.replace(PH, (_, k: string) => {
        total++;
        const v = vars[k] ?? "";
        if (v) filled++;
        return v;
      }));
      // Строка из пустых переменных или подпись без значения («Маршрут:», «Договор №») исчезает целиком,
      // а в строке из нескольких фраз («…сообщению. Бронируйте:») отрезается только последняя
      if (total > 0 && filled === 0 && (line === "" || /[:№]$/.test(line))) return line.match(/^(.*[.!?])\s+[^.!?]*$/)?.[1] ?? null;
      return line;
    })
    .filter((line): line is string => line !== null)
    .join("\n")
    // Не больше одной пустой строки подряд: пустая переменная не должна рвать абзацы
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Без имени «{{greeting.name}}напоминаем…» начиналось бы со строчной буквы
  return text.replace(/^[а-яё]/, (c) => c.toUpperCase());
}

const PH = /\{\{\s*([\w.]+)\s*\}\}/g;

function tidy(line: string): string {
  return line
    // Только пробелы и табуляция: \s зацепил бы неразрывный пробел в суммах «1 050 ₽»
    .replace(/[ \t]{2,}/g, " ")
    // Пустая переменная оставляет пробел перед знаком препинания
    .replace(/ +([,.!?:;])/g, "$1")
    .trim();
}
