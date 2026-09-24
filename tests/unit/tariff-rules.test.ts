import { test } from "node:test";
import assert from "node:assert/strict";
import { tariffDisableError, validateTariffPrice, type TariffLike } from "@/lib/settings-validate";

const T = (over: Partial<TariffLike> & { id: string }): TariffLike => ({ kind: "PARKING", unit: "day", minDays: null, vehicleType: "CAR", roomType: null, isActive: true, ...over });
const car = T({ id: "car" });
const carLong = T({ id: "car_long", minDays: 30 });
const suv = T({ id: "suv", vehicleType: "SUV" });

test("цена 0 разрешена только грузовым", () => {
  assert.equal(validateTariffPrice(0, { kind: "PARKING", vehicleType: "TRUCK" }).ok, true);
  assert.equal(validateTariffPrice(0, { kind: "PARKING", vehicleType: "CAR" }).ok, false);
  assert.equal(validateTariffPrice(0, { kind: "ROOM", vehicleType: null }).ok, false);
});

test("цена вне 0…100 000 и дробная — отказ", () => {
  assert.equal(validateTariffPrice(100_000, car).ok, true);
  for (const bad of [-1, 100_001, 350.5, NaN]) assert.equal(validateTariffPrice(bad, car).ok, false, String(bad));
});

test("выключить «Легковая» при действующем «от 30 суток» нельзя: подбор на 3 суток не найдёт тариф", () => {
  assert.match(tariffDisableError(car, [car, carLong, suv]) ?? "", /единственный/);
});

test("выключить «от 30 суток» можно; стартовый тариф при втором стартовом — можно", () => {
  assert.equal(tariffDisableError(carLong, [car, carLong]), null);
  const car2 = T({ id: "car2", minDays: 0 });
  assert.equal(tariffDisableError(car, [car, car2, carLong]), null);
  assert.match(tariffDisableError(car, [car, { ...car2, isActive: false }]) ?? "", /единственный/);
});

test("комнаты: последние сутки номера выключить нельзя, 12 часов — можно", () => {
  const d24 = T({ id: "r24", kind: "ROOM", unit: "24h", vehicleType: null, roomType: "twin" });
  const d12 = T({ id: "r12", kind: "ROOM", unit: "12h", vehicleType: null, roomType: "twin" });
  const other = T({ id: "o24", kind: "ROOM", unit: "24h", vehicleType: null, roomType: "bunk" });
  assert.match(tariffDisableError(d24, [d24, d12, other]) ?? "", /суточный/);
  assert.equal(tariffDisableError(d12, [d24, d12, other]), null);
});
