// Потолок мест в CRM (Ф3 §3.7) — чистые правила и тексты, без базы.
import { isFirm, type Fit, type PoolKind, type Span } from "./occupancy-math";
import { plural } from "./tariffs";

// confirm — подтверждение места: сверх вместимости отказ (владелец может подтвердить явно);
// checkin — заезд: машина уже у шлагбаума, не блокируем, только запись в ленту и уведомление
export type CheckMode = "confirm" | "checkin";

const CONFIRMING = ["AWAITING_PAYMENT", "CONFIRMED"];

// Какая проверка нужна при смене статуса брони парковки. from = null — создание брони.
// «Новая заявка» за твёрдое удержание не считается: подтверждение из неё проверяется всегда (иначе
// заявку, созданную при полном пуле, подтвердили бы мимо проверки, пока она «держит» место)
export function statusCheck(from: string | null, to: string, dateFrom: string, today: string): CheckMode | null {
  const firm = from != null && isFirm(from);
  if (CONFIRMING.includes(to)) return firm ? null : "confirm";
  if (to === "CHECKED_IN") return !firm || dateFrom > today ? "checkin" : null;
  return null;
}

// Цель, при которой транзакция берёт общую блокировку занятости (до блокировки строки брони)
export const takesSpace = (to: string) => isFirm(to);

// Какие дни проверять. Прошлые дни не проверяем — их не освободить; перевёрнутый отрезок отдаём как есть,
// fitOn ответит «не помещается». Заезд — с сегодня: ранний заезд удлиняет отрезок назад (Ф2а)
export function checkSpan(mode: CheckMode, b: Span, today: string): Span | null {
  if (b.dateTo < b.dateFrom) return b;
  if (mode === "checkin") return { dateFrom: today, dateTo: b.dateTo > today ? b.dateTo : today };
  const from = b.dateFrom > today ? b.dateFrom : today;
  return from > b.dateTo ? null : { dateFrom: from, dateTo: b.dateTo };
}

function day(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`)).replace(".", "");
}

const cars = (n: number) => `${n} ${plural(n, "машина", "машины", "машин")}`;

function load(f: Fit): string {
  const ov = f.overstay ? `, из них ${cars(f.overstay)} в перестое` : "";
  return `занято ${f.busy} из ${f.capacity}${ov}`;
}

// Текст отказа: дата, цифры, куда идти
export function capacityRefusal(f: Fit, pool: PoolKind): string {
  return `На ${day(f.day)} ${pool === "TRUCK" ? "мест для грузовых нет" : "мест нет"}: ${load(f)}. Освободить место — отметить выезд в «Сегодня»; подтвердить сверх вместимости может владелец.`;
}

// Строка в ленту брони и текст уведомления администратору. what — что произошло («Заехал», «Подтверждена»…)
export function overCapacityLine(f: Fit, how: "override" | "soft", what: string): string {
  const head = how === "override" ? `Сверх вместимости (подтвердил владелец): ${what}` : `${what} при полном пуле`;
  return `${head} · на ${day(f.day)} ${load(f)}`;
}

export function overCapacityNotice(number: number, f: Fit, how: "override" | "soft", what: string): string {
  return `Бронь №${number}: ${overCapacityLine(f, how, what).replace(/^./, (c) => c.toLowerCase())}`;
}

// Сохранение вместимости ниже пика занятости (§3.9): опечатка «45» не должна молча закрыть приём
export function belowPeakText(pool: PoolKind, capacity: number, peak: { day: string; busy: number }): string {
  return `${pool === "TRUCK" ? "Мест для грузовых" : "Вместимость"} ${capacity} меньше занятости: на ${day(peak.day)} занято ${peak.busy}.`;
}
