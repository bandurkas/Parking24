// «Когда срабатывает» правило автоматизации — человеческим языком (МФ-2). Чистый модуль.
// Ф5 дописывает сюда ветки rejectKind и delayMinutes, Ф6/Ф7 — свои триггеры.
import type { BookingSource, BookingStatus } from "@prisma/client";
import { plural } from "@/lib/tariffs";
import { SOURCE_LABEL, STATUS_LABEL } from "./labels";

type Params = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const hours = (n: number) => `${n} ${plural(n, "час", "часа", "часов")}`;
const days = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;

export function ruleWhen(trigger: string, params: unknown): string {
  const p: Params = params && typeof params === "object" && !Array.isArray(params) ? (params as Params) : {};
  switch (trigger) {
    case "STATUS_CHANGED": {
      const status = typeof p.status === "string" ? STATUS_LABEL[p.status as BookingStatus] : undefined;
      const parts = [status ? `Бронь переходит в «${status}»` : "Меняется статус брони"];
      if (typeof p.source === "string") parts.push(`только заявки из источника «${SOURCE_LABEL[p.source as BookingSource] ?? p.source}»`);
      return parts.join(", ");
    }
    case "BEFORE_CHECKIN": {
      const h = num(p.hoursBefore);
      return h ? `За ${hours(h)} до планового заезда` : "Перед плановым заездом";
    }
    case "BEFORE_CHECKOUT": {
      const d = num(p.daysBefore);
      return d ? `За ${days(d)} до планового выезда` : "Перед плановым выездом";
    }
    case "AFTER_CHECKOUT": {
      const d = num(p.daysAfter);
      return d ? `Через ${days(d)} после выезда` : "После выезда";
    }
    default:
      return `По событию ${trigger}`;
  }
}

// Правила по времени (BEFORE_*/AFTER_*) срабатывают только со сканом по времени (его пока нет), событийные — сразу
export function ruleIsTimed(trigger: string): boolean {
  return /^(BEFORE|AFTER)_/.test(trigger);
}
