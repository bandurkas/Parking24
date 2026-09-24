import type { Booking, Client } from "@prisma/client";
import { fmtDate, fmtDayTime, fmtRange } from "@/server/lib/dates";
import { VEHICLE_LABEL } from "@/lib/crm/labels";
import { FREE_TRANSFER_MIN_DAYS, plural } from "@/lib/tariffs";

export type RenderExtras = {
  route?: string;
  review?: string;
  video?: string;
  contract?: string | null;
  checkedInAt?: string | null;
};

// Обращение целиком, чтобы без имени не получилось «Здравствуйте, !».
// Заказчик правит текст шаблона, а склейку имени берёт на себя эта переменная.
function greeting(name: string, style: "hello" | "name"): string {
  if (style === "hello") return name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
  return name ? `${name}, ` : "";
}

export type RenderCtx = { booking: Booking; client: Client | null };

// Словарь переменных (МФ-2 Р7): из его ключей страница шаблонов строит подсказки и проверку опечаток.
// Набор ключей не должен зависеть от данных — условные значения только пустой строкой (юнит template-vars)
export function buildVars(ctx: RenderCtx, extras: RenderExtras = {}): Record<string, string> {
  const { booking, client } = ctx;
  const name = (client?.name || booking.contactName || "").trim();
  const due = Math.max(0, booking.amount - booking.paidAmount);
  const days = booking.days;
  const daysText = `${days} ${plural(days, "сутки", "суток", "суток")}`;
  // Трансфер бесплатный по правилу от суток, а не по галочке «нужен трансфер» в брони
  const freeTransfer = booking.kind === "PARKING" && days >= FREE_TRANSFER_MIN_DAYS;

  return {
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
    "booking.days": daysText,
    "booking.vehicle": [booking.vehicleType ? VEHICLE_LABEL[booking.vehicleType] : "", booking.plate ?? ""].filter(Boolean).join(" "),
    // Суммы с разбивкой по разрядам, как в строке оплаты: «1 050» (разделитель неразрывный)
    "booking.amount": booking.amount.toLocaleString("ru-RU"),
    "booking.due": due.toLocaleString("ru-RU"),
    // Цена 0 — фура «по запросу»: вместо «0 ₽» и «Бронь оплачена» цену называет администратор
    "booking.priceLine": booking.amount > 0
      ? `Стоимость: ${booking.amount.toLocaleString("ru-RU")} ₽ за ${daysText}`
      : "Стоимость подскажет администратор.",
    "booking.dueLine": booking.amount <= 0 ? "" : due > 0 ? `К оплате на месте: ${due.toLocaleString("ru-RU")} ₽, наличными или картой.` : "Бронь оплачена.",
    "booking.transferLine": freeTransfer
      ? "Трансфер до терминала и обратно для вас бесплатный, дорога занимает 3–5 минут."
      : `Бесплатный трансфер действует при стоянке от ${FREE_TRANSFER_MIN_DAYS} суток. По вашей брони он оплачивается отдельно, стоимость подскажет администратор.`,
    "booking.returnLine": freeTransfer
      ? "Когда прилетите и получите багаж, позвоните или напишите нам: +7 905 525-06-60. Пришлём за вами бесплатный трансфер."
      : "Если понадобится трансфер от терминала, позвоните или напишите нам: +7 905 525-06-60, стоимость подскажем.",
    "links.route": extras.route ?? "",
    "links.review": extras.review ?? "",
    "links.video": extras.video ?? "",
    "site.url": process.env.NEXT_PUBLIC_SITE_URL ?? "",
  };
}

export function renderTemplate(body: string, ctx: RenderCtx, extras: RenderExtras = {}): string {
  const vars = buildVars(ctx, extras);
  const text = body
    .split("\n")
    .map((src) => {
      let total = 0;
      let filled = 0;
      const line = tidy(src.replace(PH, (_, k: string) => {
        const v = vars[k] ?? "";
        // Обращение — не данные: без имени строка «{{greeting.name}}напоминаем…» остаётся
        if (!k.startsWith("greeting.")) {
          total++;
          if (v) filled++;
        }
        return v;
      }));
      // Данных в строке нет: исчезает строка из одних переменных и короткая подпись без значения
      // («Маршрут:», «Договор №»). Строку с другими фразами не трогаем — лучше висящая подпись, чем потерянный адрес
      if (total > 0 && filled === 0 && (line === "" || /^[^.!?:]*[:№]$/.test(line))) return null;
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

export const PH = /\{\{\s*([\w.]+)\s*\}\}/g;

function tidy(line: string): string {
  return line
    // Только пробелы и табуляция: \s зацепил бы неразрывный пробел в суммах «1 050 ₽»
    .replace(/[ \t]{2,}/g, " ")
    // Пустая переменная оставляет пробел перед знаком препинания
    .replace(/ +([,.!?:;])/g, "$1")
    .trim();
}
