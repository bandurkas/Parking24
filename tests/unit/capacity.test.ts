import { test } from "node:test";
import assert from "node:assert/strict";
import { belowPeakText, capacityRefusal, checkSpan, overCapacityLine, overCapacityNotice, statusCheck, takesSpace } from "@/lib/capacity";
import { fitOn, holdSinceOf, holdsSpace } from "@/lib/occupancy-math";

const fit = { ok: false, day: "2026-10-12", busy: 405, capacity: 405, overstay: 3 };

test("текст отказа: дата, занятость, вместимость, перестой и что делать", () => {
  assert.equal(capacityRefusal(fit, "POOL"), "На 12 окт мест нет: занято 405 из 405, из них 3 машины в перестое. Освободить место — отметить выезд в «Сегодня»; подтвердить сверх вместимости может владелец.");
  const t = capacityRefusal({ ...fit, busy: 10, capacity: 10, overstay: 0 }, "TRUCK");
  assert.match(t, /^На 12 окт мест для грузовых нет: занято 10 из 10\. /);
  assert.doesNotMatch(t, /перестое/);
  assert.match(capacityRefusal({ ...fit, overstay: 1 }, "POOL"), /из них 1 машина в перестое/);
});

test("строка в ленту и уведомление: сверх вместимости и заезд при полном пуле", () => {
  assert.equal(overCapacityLine(fit, "override", "Отклонена → Ожидает оплаты"), "Сверх вместимости (подтвердил владелец): Отклонена → Ожидает оплаты · на 12 окт занято 405 из 405, из них 3 машины в перестое");
  assert.equal(overCapacityLine(fit, "soft", "Заезд"), "Заезд при полном пуле · на 12 окт занято 405 из 405, из них 3 машины в перестое");
  assert.match(overCapacityNotice(7, fit, "soft", "Заезд"), /^Бронь №7: заезд при полном пуле · /);
});

test("граница потолка: при занятости 404 из 405 бронь проходит, при 405 — нет", () => {
  const spans = (n: number) => Array.from({ length: n }, () => ({ dateFrom: "2026-10-01", dateTo: "2026-10-31" }));
  assert.equal(fitOn(spans(404), "2026-10-10", "2026-10-12", 405).ok, true);
  assert.equal(fitOn(spans(405), "2026-10-10", "2026-10-12", 405).ok, false);
});

test("«Новая заявка» держит место N часов — при N = 24 входит в занятость, после срока и при 0 — нет", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const lead = (ageH: number) => ({ status: "NEW", createdAt: now.getTime() - ageH * 3_600_000, dateFrom: "2026-10-05", dateTo: "2026-10-06" });
  const held = (hours: number) => [lead(1), lead(23), lead(30)].filter((b) => holdsSpace(b, holdSinceOf(now, hours)));
  assert.equal(held(24).length, 2);
  assert.equal(held(48).length, 3);
  assert.equal(held(0).length, 0);
  // держащая «Новая» закрывает последнее место
  assert.equal(fitOn([...Array.from({ length: 404 }, () => ({ dateFrom: "2026-10-05", dateTo: "2026-10-06" })), ...held(24).slice(0, 1)], "2026-10-05", "2026-10-05", 405).ok, false);
});

test("какая проверка: подтверждение места — жёсткая, заезд — мягкая, твёрдая бронь не перепроверяется", () => {
  const today = "2026-10-01";
  assert.equal(statusCheck(null, "CONFIRMED", "2026-10-05", today), "confirm");
  assert.equal(statusCheck(null, "NEW", "2026-10-05", today), null);
  assert.equal(statusCheck("NEW", "AWAITING_PAYMENT", "2026-10-05", today), "confirm");
  assert.equal(statusCheck("REJECTED", "AWAITING_PAYMENT", "2026-10-05", today), "confirm");
  assert.equal(statusCheck("CANCELLED", "CONFIRMED", "2026-10-05", today), "confirm");
  assert.equal(statusCheck("AWAITING_PAYMENT", "CONFIRMED", "2026-10-05", today), null);
  assert.equal(statusCheck("CONFIRMED", "CHECKED_IN", "2026-10-01", today), null);
  assert.equal(statusCheck("CONFIRMED", "CHECKED_IN", "2026-10-05", today), "checkin"); // ранний заезд
  assert.equal(statusCheck("CANCELLED", "CHECKED_IN", "2026-09-28", today), "checkin"); // исправление забытого заезда — не блокируем
  assert.equal(statusCheck("CHECKED_IN", "CHECKED_OUT", "2026-09-28", today), null);
  assert.equal(statusCheck("CONFIRMED", "NO_SHOW", "2026-09-28", today), null); // системный «Не приехал» освобождает место
  assert.equal(takesSpace("NO_SHOW"), false);
  assert.equal(takesSpace("CHECKED_IN"), true);
});

test("какие дни проверять: прошлые — нет, заезд — с сегодня, перевёрнутый отрезок — как есть", () => {
  const today = "2026-10-01";
  assert.deepEqual(checkSpan("confirm", { dateFrom: "2026-09-28", dateTo: "2026-10-03" }, today), { dateFrom: "2026-10-01", dateTo: "2026-10-03" });
  assert.equal(checkSpan("confirm", { dateFrom: "2026-09-20", dateTo: "2026-09-25" }, today), null);
  assert.deepEqual(checkSpan("checkin", { dateFrom: "2026-10-05", dateTo: "2026-10-07" }, today), { dateFrom: "2026-10-01", dateTo: "2026-10-07" });
  assert.deepEqual(checkSpan("checkin", { dateFrom: "2026-09-20", dateTo: "2026-09-25" }, today), { dateFrom: "2026-10-01", dateTo: "2026-10-01" });
  assert.deepEqual(checkSpan("confirm", { dateFrom: "2026-10-05", dateTo: "2026-10-03" }, today), { dateFrom: "2026-10-05", dateTo: "2026-10-03" });
});

test("вместимость ниже пика: текст с числом и датой", () => {
  assert.equal(belowPeakText("POOL", 45, { day: "2026-10-03", busy: 312 }), "Вместимость 45 меньше занятости: на 3 окт занято 312.");
  assert.equal(belowPeakText("TRUCK", 1, { day: "2026-10-03", busy: 2 }), "Мест для грузовых 1 меньше занятости: на 3 окт занято 2.");
});
