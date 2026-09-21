import { test } from "node:test";
import assert from "node:assert/strict";
import { daysRange, loadByDay, peakLoad, fits, isPoolType } from "@/lib/occupancy-math";

const span = (dateFrom: string, dateTo: string) => ({ dateFrom, dateTo });

test("daysRange: границы включительно", () => {
  assert.deepEqual(daysRange("2026-09-17", "2026-09-19"), ["2026-09-17", "2026-09-18", "2026-09-19"]);
  assert.deepEqual(daysRange("2026-09-17", "2026-09-17"), ["2026-09-17"]);
  assert.equal(daysRange("2026-09-30", "2026-10-02").length, 3);
});

test("loadByDay: день выезда тоже занят", () => {
  const rows = loadByDay([span("2026-09-17", "2026-09-19")], "2026-09-16", "2026-09-20");
  assert.deepEqual(rows.map((r) => r.busy), [0, 1, 1, 1, 0]);
});

test("loadByDay: пересечения складываются", () => {
  const rows = loadByDay([span("2026-09-17", "2026-09-19"), span("2026-09-19", "2026-09-21")], "2026-09-17", "2026-09-21");
  assert.deepEqual(rows.map((r) => r.busy), [1, 1, 2, 1, 1]);
});

test("peakLoad: берётся максимум по дням отрезка", () => {
  const bookings = [span("2026-09-17", "2026-09-19"), span("2026-09-19", "2026-09-19"), span("2026-09-25", "2026-09-26")];
  assert.equal(peakLoad(bookings, "2026-09-17", "2026-09-20"), 2);
  assert.equal(peakLoad(bookings, "2026-09-22", "2026-09-24"), 0);
});

test("fits: порог 395 — последняя проходящая заявка при занятости 394", () => {
  const busy394 = Array.from({ length: 394 }, () => span("2026-09-17", "2026-09-19"));
  assert.equal(fits(busy394, "2026-09-18", "2026-09-18", 395), true);
  const busy395 = [...busy394, span("2026-09-17", "2026-09-19")];
  assert.equal(fits(busy395, "2026-09-18", "2026-09-18", 395), false);
});

test("fits: один загруженный день закрывает всю бронь", () => {
  // 20-го занято 3 места при пороге 3 — бронь, проходящая через этот день, не помещается,
  // а бронь до 19-го включительно проходит: там занятых нет.
  const bookings = [span("2026-09-20", "2026-09-20"), span("2026-09-20", "2026-09-20"), span("2026-09-20", "2026-09-20")];
  assert.equal(fits(bookings, "2026-09-18", "2026-09-25", 3), false);
  assert.equal(fits(bookings, "2026-09-18", "2026-09-19", 3), true);
});

test("fits: заявка, доводящая занятость ровно до порога, проходит", () => {
  // порог 395 = «пока на стоянке меньше 395»; резерв 10 мест из 405 остаётся администратору
  const busy = Array.from({ length: 394 }, () => span("2026-09-20", "2026-09-20"));
  assert.equal(fits(busy, "2026-09-20", "2026-09-20", 395), true);
});

test("isPoolType: грузовые вне общего пула", () => {
  assert.equal(isPoolType("CAR"), true);
  assert.equal(isPoolType("SUV"), true);
  assert.equal(isPoolType("MOTO"), true);
  assert.equal(isPoolType("TRUCK"), false);
  assert.equal(isPoolType(null), false);
});
