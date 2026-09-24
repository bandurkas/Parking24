import { moscowIso } from "@/lib/moscow";

// Одно правило даты смены для кассы, отчёта и табеля: открытие до 02:00 МСК — ещё вчерашняя дата
export const shiftDateOf = (d: Date) => moscowIso(new Date(d.getTime() - 2 * 3_600_000));
