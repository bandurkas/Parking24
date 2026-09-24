import { test } from "node:test";
import assert from "node:assert/strict";
import { billableDays, priceFor, recalcFrom, recalcPending, type PriceTariff } from "@/lib/recalc";
import { parkingDays } from "@/lib/periods";

const T = (code: string, vehicleType: string | null, price: number, minDays: number | null = null, roomType: string | null = null, unit = "day"): PriceTariff => ({ code, vehicleType, roomType, unit, price, minDays });
const PARKING = [T("car", "CAR", 350), T("car_long", "CAR", 250, 30), T("truck", "TRUCK", 0)];
const ROOMS = [T("twin:12h", null, 2200, null, "twin", "12h"), T("twin:24h", null, 2500, null, "twin", "24h")];
const P = (from: string, inDate: string | null, actualDays: number) => billableDays({ kind: "PARKING", dateFrom: from, inDate, actualDays });

test("billableDays: поздний заезд — сутки от плановой даты заезда (место держали)", () => {
  assert.equal(P("2026-09-20", "2026-09-22", 1), 3);
  assert.equal(P("2026-09-20", "2026-09-21", 2), 3);
});

test("billableDays: ранний заезд и заезд в плановый день — фактические сутки", () => {
  assert.equal(P("2026-09-20", "2026-09-18", 5), 5);
  assert.equal(P("2026-09-20", "2026-09-20", 3), 3);
});

test("billableDays: досрочный выезд — меньше плана; заезд и выезд в один день — 1 сутки", () => {
  assert.equal(P("2026-09-20", "2026-09-20", 1), 1);
  assert.equal(P("2026-09-20", "2026-09-21", 1), 2);
});

test("billableDays = сутки от min(заезд, плановая дата) до выезда — перебором", () => {
  const days = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
  const from = "2026-09-20";
  for (let i = -5; i <= 5; i++) {
    for (let o = 0; o <= 8; o++) {
      const inDate = days(from, i);
      const out = days(inDate, o);
      const start = inDate < from ? inDate : from;
      assert.equal(P(from, inDate, parkingDays(inDate, out)), Math.max(1, parkingDays(start, out)), `${inDate} → ${out}`);
    }
  }
});

test("billableDays: комната и бронь без отметки заезда — как есть", () => {
  assert.equal(billableDays({ kind: "ROOM", dateFrom: "2026-09-20", inDate: "2026-09-22", actualDays: 1 }), 1);
  assert.equal(P("2026-09-20", null, 2), 2);
});

const row = (o: Partial<Parameters<typeof recalcPending>[0]> = {}) => ({ status: "CHECKED_OUT", kind: "PARKING", days: 3, actualDays: 1, recalcDecidedAt: null, dateFrom: "2026-09-20", inDate: "2026-09-20", ...o });

test("recalcPending: баннер только после выезда, без решения и при расхождении суток к оплате с планом", () => {
  assert.equal(recalcPending(row()), true);
  assert.equal(recalcPending(row({ inDate: "2026-09-22" })), false, "поздний заезд, выезд в плановую дату");
  assert.equal(recalcPending(row({ recalcDecidedAt: new Date() })), false);
  assert.equal(recalcPending(row({ status: "CHECKED_IN" })), false);
  assert.equal(recalcPending(row({ actualDays: null })), false);
  assert.equal(recalcPending(row({ actualDays: 3 })), false);
  assert.equal(recalcPending(row({ actualDays: 4, inDate: "2026-09-19" })), true, "ранний заезд — доплата");
});

test("priceFor: ступень тарифа по суткам, комната — тариф «сутки», нет тарифа — 0", () => {
  assert.deepEqual(priceFor(PARKING, "PARKING", 29, { vehicleType: "CAR" }), { amount: 10150, perDay: 350, tariffCode: "car" });
  assert.deepEqual(priceFor(PARKING, "PARKING", 30, { vehicleType: "CAR" }), { amount: 7500, perDay: 250, tariffCode: "car_long" });
  assert.deepEqual(priceFor(PARKING, "PARKING", 3, { vehicleType: "TRUCK" }), { amount: 0, perDay: 0, tariffCode: "truck" });
  assert.deepEqual(priceFor(PARKING, "PARKING", 3, { vehicleType: "SUV" }), { amount: 0, perDay: 0, tariffCode: null });
  assert.deepEqual(priceFor(PARKING, "PARKING", 0, { vehicleType: "CAR" }), { amount: 0, perDay: 0, tariffCode: null });
  assert.deepEqual(priceFor(ROOMS, "ROOM", 2, { roomType: "twin" }), { amount: 5000, perDay: 2500, tariffCode: "twin:24h" });
});

const plan = (b: { days: number; billDays: number; amount: number; overstayCharge?: number | null }, vehicleType = "CAR") =>
  recalcFrom({ overstayCharge: null, ...b }, {
    plannedAmount: priceFor(PARKING, "PARKING", b.days, { vehicleType }).amount,
    billAmount: priceFor(PARKING, "PARKING", b.billDays, { vehicleType }).amount,
    billPerDay: priceFor(PARKING, "PARKING", b.billDays, { vehicleType }).perDay,
  });

test("recalcFrom: цена по тарифу — сутки к оплате × цена суток", () => {
  assert.deepEqual(plan({ days: 3, billDays: 1, amount: 1050 }), { newAmount: 350, perDay: 350, mode: "tariff", hint: "" });
  assert.deepEqual(plan({ days: 3, billDays: 4, amount: 1050 }), { newAmount: 1400, perDay: 350, mode: "tariff", hint: "" });
});

test("recalcFrom: ступень — по суткам к оплате, одно число у баннера и у действия (30+ суток)", () => {
  assert.equal(plan({ days: 31, billDays: 1, amount: 7750 }).newAmount, 350);
  assert.equal(plan({ days: 31, billDays: 30, amount: 7750 }).newAmount, 7500);
});

test("recalcFrom: смена ступени не делает досрочный выезд дороже плана, а долгую стоянку — дешевле", () => {
  const early = plan({ days: 31, billDays: 29, amount: 7750 });
  assert.equal(early.newAmount, 7750, "29 × 350 = 10 150 > 7 750 — остаётся план");
  assert.match(early.hint, /Ступень тарифа/);
  assert.equal(plan({ days: 29, billDays: 30, amount: 10150 }).newAmount, 10150, "30 × 250 = 7 500 < 10 150 — остаётся план");
  assert.equal(plan({ days: 29, billDays: 31, amount: 10150 }).newAmount, 10150);
  assert.equal(plan({ days: 30, billDays: 32, amount: 7500 }).newAmount, 8000);
});

test("recalcFrom: ручная цена — пропорционально", () => {
  const r = plan({ days: 3, billDays: 1, amount: 900 });
  assert.equal(r.mode, "manual");
  assert.equal(r.newAmount, 300);
  assert.match(r.hint, /пропорционально/);
  assert.equal(plan({ days: 3, billDays: 2, amount: 1000 }).newAmount, 667);
});

test("recalcFrom: ручная цена после перестоя и цена «по запросу» — не пересчитываем", () => {
  for (const overstayCharge of [350, 0]) {
    const r = plan({ days: 5, billDays: 3, amount: 1050, overstayCharge });
    assert.equal(r.mode, "none", String(overstayCharge));
    assert.equal(r.newAmount, 1050);
    assert.match(r.hint, /владелец/);
  }
  const truck = plan({ days: 3, billDays: 1, amount: 5000 }, "TRUCK");
  assert.equal(truck.mode, "none");
  assert.equal(truck.newAmount, 5000);
  assert.match(truck.hint, /по запросу/);
  assert.equal(plan({ days: 4, billDays: 5, amount: 1400, overstayCharge: 350 }).mode, "tariff", "тарифная бронь с начислением остаётся тарифной");
});

test("recalcFrom перебором: сумма ≥ 0, при сутках к оплате = плану сумма прежняя", () => {
  for (let days = 1; days <= 40; days++) {
    for (let bill = 1; bill <= 40; bill += 3) {
      for (const amount of [0, 1, 350 * days, 999, 20000]) {
        for (const overstayCharge of [null, 0, 350]) {
          const r = plan({ days, billDays: bill, amount, overstayCharge });
          assert.ok(r.newAmount >= 0, `${days}/${bill}/${amount}`);
          if (r.mode === "tariff" && bill < days) assert.ok(r.newAmount <= amount, `досрочно не дороже плана: ${days}/${bill}/${amount}`);
          if (r.mode === "tariff" && bill > days) assert.ok(r.newAmount >= amount, `дольше не дешевле плана: ${days}/${bill}/${amount}`);
          if (bill === days) assert.equal(plan({ days, billDays: days, amount, overstayCharge }).newAmount, amount);
        }
      }
    }
  }
});
