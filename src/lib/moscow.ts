export const MOSCOW_TZ = "Europe/Moscow";
// Календарная дата момента по Москве: сутки парковки, перестой и «сегодня» считаются по ней, а не по UTC сервера
export function moscowIso(d: Date, tz: string = MOSCOW_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}