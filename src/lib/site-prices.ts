// Цены парковки на сайте — из тарифов CRM (активные строки Tariff, activeTariffs("PARKING")) тем же priceFor, что у брони (quote)
import { priceFor, type PriceTariff } from "./recalc";

// Сумма брони для типа авто сайта (car/suv/moto/truck) за сутки по датам включительно; 0 — «по запросу»
export function sitePrice(tariffs: PriceTariff[], vehicle: string, days: number): number {
  return priceFor(tariffs, "PARKING", days, { vehicleType: vehicle.toUpperCase() }).amount;
}

// Ступень «от N суток» у легковой; null — ступени нет (тариф выключен в CRM)
export function carLongTerm(tariffs: PriceTariff[]): { minDays: number; perDay: number } | null {
  const t = tariffs.filter((x) => x.vehicleType === "CAR" && (x.minDays ?? 0) > 1).sort((a, b) => (a.minDays ?? 0) - (b.minDays ?? 0))[0];
  return t ? { minDays: t.minDays ?? 0, perDay: t.price } : null;
}
