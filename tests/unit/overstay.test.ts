import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeLeft, chargeUntil, dayRate, overstayDays, overstayDebt, overstayLabel, pickTariff, type StayRow, type TariffRow } from "@/lib/overstay";
import { effectiveSpan, fits, loadByDay, peakLoad, OPEN_END } from "@/lib/occupancy-math";
import { moscowIso, overstayDayIso } from "@/server/lib/dates";

// Тарифы парковки из prisma/seed.ts
const TARIFFS: TariffRow[] = [
  { vehicleType: "CAR", price: 350, minDays: null },
  { vehicleType: "CAR", price: 250, minDays: 30 },
  { vehicleType: "SUV", price: 400, minDays: null },
  { vehicleType: "MOTO", price: 150, minDays: null },
  { vehicleType: "TRUCK", price: 0, minDays: null },
];

const stay = (over: Partial<StayRow> = {}): StayRow => ({ kind: "PARKING", status: "CHECKED_IN", dateTo: "2026-09-25", vehicleType: "CAR", days: 3, amount: 1050, paidAmount: 1050, ...over });

test("overstayDays: день выезда оплачен, перестой — со следующего", () => {
  assert.equal(overstayDays(stay(), "2026-09-25"), 0);
  assert.equal(overstayDays(stay(), "2026-09-26"), 1);
  assert.equal(overstayDays(stay(), "2026-09-27"), 2);
  assert.equal(overstayDays(stay(), "2026-09-24"), 0);
});

test("overstayDays: только «Заехал» на парковке", () => {
  for (const status of ["CONFIRMED", "AWAITING_PAYMENT", "CHECKED_OUT", "NEW"]) assert.equal(overstayDays(stay({ status }), "2026-09-27"), 0, status);
  assert.equal(overstayDays(stay({ kind: "ROOM" }), "2026-09-27"), 0);
});

test("overstayDays: через конец месяца", () => {
  assert.equal(overstayDays(stay({ dateTo: "2026-09-30" }), "2026-10-02"), 2);
});

test("pickTariff / dayRate: тариф по типу машины и плановым суткам", () => {
  assert.equal(dayRate(TARIFFS, { vehicleType: "CAR", days: 3 }), 350);
  assert.equal(dayRate(TARIFFS, { vehicleType: "CAR", days: 29 }), 350);
  assert.equal(dayRate(TARIFFS, { vehicleType: "CAR", days: 30 }), 250);
  assert.equal(dayRate(TARIFFS, { vehicleType: "SUV", days: 40 }), 400);
  assert.equal(dayRate(TARIFFS, { vehicleType: "MOTO", days: 2 }), 150);
  assert.equal(dayRate(TARIFFS, { vehicleType: "TRUCK", days: 2 }), 0);
  assert.equal(dayRate(TARIFFS, { vehicleType: null, days: 2 }), 0);
  assert.equal(pickTariff(TARIFFS, undefined, 2), null);
});

test("overstayDebt: сутки × тариф, скидка брони не влияет", () => {
  assert.deepEqual(overstayDebt(stay(), "2026-09-27", TARIFFS), { days: 2, rate: 350, debt: 700, shown: 700 });
  // бронь со скидкой: 3 сут. за 900 — долг всё равно по тарифу
  assert.equal(overstayDebt(stay({ amount: 900, paidAmount: 900 }), "2026-09-26", TARIFFS)?.debt, 350);
  assert.equal(overstayDebt(stay({ vehicleType: "TRUCK", amount: 0, paidAmount: 0 }), "2026-09-27", TARIFFS)?.debt, 0);
  assert.equal(overstayDebt(stay(), "2026-09-25", TARIFFS), null);
});

test("overstayDebt.shown: переплата гасит долг, но не уходит в минус", () => {
  assert.equal(overstayDebt(stay({ paidAmount: 1400 }), "2026-09-27", TARIFFS)?.shown, 350);
  assert.equal(overstayDebt(stay({ paidAmount: 1750 }), "2026-09-27", TARIFFS)?.shown, 0);
  assert.equal(overstayDebt(stay({ paidAmount: 5000 }), "2026-09-27", TARIFFS)?.shown, 0);
  // недоплата по брони не смешивается с долгом за перестой
  assert.equal(overstayDebt(stay({ paidAmount: 0 }), "2026-09-27", TARIFFS)?.shown, 700);
});

test("overstayLabel: долг, оплачен заранее, фура без цены", () => {
  assert.equal(overstayLabel({ days: 2, rate: 350, shown: 700 }).replace(/\s/g, " "), "перестой 2 сут. · долг 700 ₽");
  assert.equal(overstayLabel({ days: 26, rate: 350, shown: 9100 }).replace(/\s/g, " "), "перестой 26 сут. · долг 9 100 ₽");
  assert.equal(overstayLabel({ days: 2, rate: 350, shown: 0 }), "перестой 2 сут. · долг оплачен");
  assert.equal(overstayLabel({ days: 2, rate: 0, shown: 0 }), "перестой 2 сут. · стоимость не задана");
});

test("overstayDayIso: льготный час — сутки перестоя начинаются в 01:00 по Москве", () => {
  assert.equal(overstayDayIso(new Date("2026-09-22T21:00:00Z")), "2026-09-22"); // 00:00 МСК 23-го
  assert.equal(overstayDayIso(new Date("2026-09-22T21:59:59Z")), "2026-09-22"); // 00:59
  assert.equal(overstayDayIso(new Date("2026-09-22T22:00:00Z")), "2026-09-23"); // 01:00
  assert.equal(overstayDayIso(new Date("2026-09-23T20:59:00Z")), "2026-09-23"); // 23:59
});

test("льготный час: выезд 23-го в 00:30 при выезде по плану 22-го не начисляет, в 01:30 — сутки", () => {
  const b = stay({ dateTo: "2026-09-22" });
  assert.equal(chargeUntil(b, overstayDayIso(new Date("2026-09-22T21:30:00Z")), TARIFFS), null);
  assert.equal(chargeUntil(b, overstayDayIso(new Date("2026-09-22T22:30:00Z")), TARIFFS)?.extra, 1);
  // и перестоя в 00:30 ещё нет, в 01:30 — есть
  assert.equal(overstayDays(b, overstayDayIso(new Date("2026-09-22T21:30:00Z"))), 0);
  assert.equal(overstayDays(b, overstayDayIso(new Date("2026-09-22T22:30:00Z"))), 1);
});

test("chargeLeft: снижение суммы владельцем съедает начисление за перестой первым", () => {
  assert.equal(chargeLeft(700, 1750, 1200), 150); // «Изменить цену» 1 750 → 1 200
  assert.equal(chargeLeft(350, 1050, 700), 0); // возврат владельца на 350 и больше
  assert.equal(chargeLeft(350, 1050, 1400), 350); // сумма выросла — начисление то же
  assert.equal(chargeLeft(null, 1050, 700), null);
  assert.equal(chargeLeft(0, 1050, 700), 0);
});

test("chargeUntil: выезд в плановый день — ничего", () => {
  assert.equal(chargeUntil(stay(), "2026-09-25", TARIFFS), null);
  assert.equal(chargeUntil(stay(), "2026-09-24", TARIFFS), null);
});

test("chargeUntil: выезд позже — сутки и сумма растут, дата выезда = фактическая", () => {
  assert.deepEqual(chargeUntil(stay(), "2026-09-27", TARIFFS), { extra: 2, rate: 350, dateTo: "2026-09-27", days: 5, amount: 1750 });
});

test("chargeUntil: повтор с уже перенесённой датой ничего не начисляет", () => {
  const first = chargeUntil(stay(), "2026-09-27", TARIFFS)!;
  assert.equal(chargeUntil(stay({ dateTo: first.dateTo, days: first.days, amount: first.amount }), "2026-09-27", TARIFFS), null);
});

test("chargeUntil: фура «по запросу» — сутки и дата растут, сумма нет", () => {
  assert.deepEqual(chargeUntil(stay({ vehicleType: "TRUCK", amount: 5000 }), "2026-09-27", TARIFFS), { extra: 2, rate: 0, dateTo: "2026-09-27", days: 5, amount: 5000 });
});

test("chargeUntil: долгая бронь — по тарифу плановых суток, не по новому", () => {
  // 29 сут. по 350, задержка на 3 → итого 32 сут., но цена суток остаётся 350
  assert.equal(chargeUntil(stay({ days: 29, amount: 10150 }), "2026-09-28", TARIFFS)?.amount, 10150 + 3 * 350);
  assert.equal(chargeUntil(stay({ days: 30, amount: 7500 }), "2026-09-26", TARIFFS)?.amount, 7750);
});

test("chargeUntil: только парковка", () => {
  assert.equal(chargeUntil(stay({ kind: "ROOM" }), "2026-09-27", TARIFFS), null);
});

const b = (status: string, dateFrom: string, dateTo: string) => ({ status, dateFrom, dateTo });

test("effectiveSpan: перестой занимает сегодня и все дни вперёд", () => {
  assert.deepEqual(effectiveSpan(b("CHECKED_IN", "2026-09-20", "2026-09-21"), "2026-09-22"), { dateFrom: "2026-09-20", dateTo: OPEN_END });
  const load = loadByDay([effectiveSpan(b("CHECKED_IN", "2026-09-20", "2026-09-21"), "2026-09-22")], "2026-09-22", "2026-10-15");
  assert.ok(load.every((d) => d.busy === 1));
});

test("effectiveSpan: ранний заезд — место занято с сегодня", () => {
  assert.deepEqual(effectiveSpan(b("CHECKED_IN", "2026-09-24", "2026-09-26"), "2026-09-22"), { dateFrom: "2026-09-22", dateTo: "2026-09-26" });
});

test("effectiveSpan: «Заехал» с выездом сегодня и позже — по плану", () => {
  assert.deepEqual(effectiveSpan(b("CHECKED_IN", "2026-09-20", "2026-09-22"), "2026-09-22"), { dateFrom: "2026-09-20", dateTo: "2026-09-22" });
  // запрос на даты после планового выезда: ещё не перестой — бронь там не считается
  assert.equal(peakLoad([effectiveSpan(b("CHECKED_IN", "2026-09-20", "2026-09-24"), "2026-09-22")], "2026-09-25", "2026-09-30"), 0);
});

test("effectiveSpan: «Подтверждена» с прошедшим выездом место не держит", () => {
  assert.deepEqual(effectiveSpan(b("CONFIRMED", "2026-09-19", "2026-09-21"), "2026-09-22"), { dateFrom: "2026-09-19", dateTo: "2026-09-21" });
  assert.equal(peakLoad([effectiveSpan(b("CONFIRMED", "2026-09-19", "2026-09-21"), "2026-09-22")], "2026-09-22", "2026-09-25"), 0);
});

test("fits: перестой учитывается в пороге 395, граница 394/395 не меняется", () => {
  const today = "2026-09-22";
  const normal = Array.from({ length: 393 }, () => effectiveSpan(b("CONFIRMED", "2026-09-28", "2026-09-30"), today));
  const overstay = effectiveSpan(b("CHECKED_IN", "2026-09-10", "2026-09-20"), today);
  assert.equal(fits(normal, "2026-09-28", "2026-09-29", 395), true);
  assert.equal(fits([...normal, overstay], "2026-09-28", "2026-09-29", 395), true); // 394 занято — последняя проходит
  assert.equal(fits([...normal, overstay, overstay], "2026-09-28", "2026-09-29", 395), false);
});

test("moscowIso: граница суток по Москве — 21:00 UTC", () => {
  assert.equal(moscowIso(new Date("2026-09-25T20:59:59Z")), "2026-09-25");
  assert.equal(moscowIso(new Date("2026-09-25T21:00:00Z")), "2026-09-26");
});

test("перестой по Москве: 23:59 МСК дня выезда — не перестой, 00:00 — уже 1 сутки", () => {
  assert.equal(overstayDays(stay(), moscowIso(new Date("2026-09-25T20:59:00Z"))), 0);
  assert.equal(overstayDays(stay(), moscowIso(new Date("2026-09-25T21:00:00Z"))), 1);
});
