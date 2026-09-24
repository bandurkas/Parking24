// Цены сайта = цена брони: калькулятор считает sitePrice по тем же тарифам, что quote() (priceFor(activeTariffs("PARKING"))),
// и теми же сутками (parkingDays = bookingDays парковки)
import { test } from "node:test";
import assert from "node:assert/strict";
import { carLongTerm, sitePrice } from "@/lib/site-prices";
import { priceFor, type PriceTariff } from "@/lib/recalc";
import { parkingDays } from "@/lib/periods";
import { bookingDays } from "@/server/lib/dates";

const T = (code: string, vehicleType: string, price: number, minDays: number | null = null): PriceTariff => ({ code, vehicleType, roomType: null, unit: "day", price, minDays });
// как в prisma/seed.ts, в порядке sortOrder
const SEED = [T("car", "CAR", 350), T("car_long", "CAR", 250, 30), T("suv", "SUV", 400), T("moto", "MOTO", 150), T("truck", "TRUCK", 0)];
// как в src/server/services/leads.ts: тип авто с сайта → тип ТС брони
const VEHICLE: Record<string, string> = { car: "CAR", suv: "SUV", moto: "MOTO", truck: "TRUCK" };
const quoteAmount = (tariffs: PriceTariff[], v: string, days: number) => priceFor(tariffs, "PARKING", days, { vehicleType: VEHICLE[v] }).amount;

test("sitePrice = сумма брони (quote) для 1…60 суток и всех типов авто сайта", () => {
  for (const tariffs of [SEED, [...SEED].reverse(), SEED.map((t) => (t.code === "car" ? { ...t, price: 351 } : t)), SEED.filter((t) => t.code !== "car_long")]) {
    for (const v of Object.keys(VEHICLE)) {
      for (let d = 1; d <= 60; d++) assert.equal(sitePrice(tariffs, v, d), quoteAmount(tariffs, v, d), `${v} ${d} сут.`);
    }
  }
});

test("sitePrice: цены сида — легковая 350, от 30 суток 250, кроссовер 400, мото 150, грузовая 0 («по запросу»)", () => {
  for (let d = 1; d <= 60; d++) {
    assert.equal(sitePrice(SEED, "car", d), d * (d >= 30 ? 250 : 350));
    assert.equal(sitePrice(SEED, "suv", d), d * 400);
    assert.equal(sitePrice(SEED, "moto", d), d * 150);
    assert.equal(sitePrice(SEED, "truck", d), 0);
  }
  assert.equal(sitePrice(SEED, "car", 0), 0);
});

test("sitePrice: новая цена из CRM сразу в расчёте, выключенная ступень — по базовой цене", () => {
  const changed = SEED.map((t) => (t.code === "car" ? { ...t, price: 351 } : t));
  assert.equal(sitePrice(changed, "car", 3), 1053);
  assert.equal(sitePrice(changed, "car", 30), 7500);
  assert.equal(sitePrice(SEED.filter((t) => t.code !== "car_long"), "car", 35), 35 * 350);
});

test("carLongTerm: ступень легковой из тарифов; нет ступени — null", () => {
  assert.deepEqual(carLongTerm(SEED), { minDays: 30, perDay: 250 });
  assert.deepEqual(carLongTerm(SEED.map((t) => (t.code === "car_long" ? { ...t, price: 240 } : t))), { minDays: 30, perDay: 240 });
  assert.equal(carLongTerm(SEED.filter((t) => t.code !== "car_long")), null);
});

test("сутки калькулятора (parkingDays) = сутки брони (bookingDays парковки)", () => {
  for (let d = 0; d <= 60; d++) {
    const to = new Date(Date.UTC(2026, 11, 20 + d)).toISOString().slice(0, 10);
    assert.equal(parkingDays("2026-12-20", to), bookingDays("2026-12-20", to, "23:30", "00:30"));
  }
});
