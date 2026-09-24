// Демонстрационная бронь для предпросмотра шаблонов и источник списка переменных (МФ-2 Р5, Р7).
// Без server-only: юнит-тесты берут отсюда же.
import type { Booking, Client } from "@prisma/client";
import { buildVars, renderTemplate, type RenderCtx, type RenderExtras } from "./render";
import { addDays, fmtMoscow, todayIso, toDate } from "@/server/lib/dates";

export const PREVIEW_NUMBER = 128;

// Даты от сегодняшнего дня: предпросмотр выглядит как настоящее сообщение, а не как «17 сентября» навсегда
export function previewCtx(now: Date = new Date()): RenderCtx {
  const from = addDays(todayIso(), 1);
  const booking = {
    number: PREVIEW_NUMBER,
    kind: "PARKING",
    contactName: "Иван",
    contactPhone: "+79001234567",
    dateFrom: toDate(from),
    dateTo: toDate(addDays(from, 2)),
    timeFrom: "10:00",
    timeTo: "18:00",
    vehicleType: "CAR",
    plate: "А123ВС77",
    days: 3,
    amount: 1050,
    paidAmount: 0,
    checkedInAt: now,
  } as unknown as Booking;
  return { booking, client: { name: "Иван", phone: "+79001234567" } as unknown as Client };
}

export function previewExtras(links: Pick<RenderExtras, "route" | "review" | "video">, now: Date = new Date()): RenderExtras {
  return { ...links, contract: "001", checkedInAt: fmtMoscow(now) };
}

// Имена переменных выводятся из самого рендера — со списком подсказок и проверкой опечаток они не разъедутся
export const TEMPLATE_VARS: string[] = Object.keys(buildVars(previewCtx(new Date(0)), previewExtras({})));

// Подсказка на странице: переменная и её значение на демонстрационной брони
export function varSamples(links: Pick<RenderExtras, "route" | "review" | "video">): { name: string; sample: string }[] {
  const vars = buildVars(previewCtx(), previewExtras(links));
  return TEMPLATE_VARS.map((name) => ({ name, sample: vars[name] ?? "" }));
}

export function renderPreview(body: string, links: Pick<RenderExtras, "route" | "review" | "video">): string {
  return renderTemplate(body, previewCtx(), previewExtras(links));
}
