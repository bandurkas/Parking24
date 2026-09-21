import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingDays, actualParkingDays, addDays, daysBetweenIso, toDate, toIso, fmtDate, fmtRange, fmtDateTime } from "@/server/lib/dates";

test("bookingDays: парковка по датам включительно, время на цену не влияет", () => {
  assert.equal(bookingDays("2026-09-17", "2026-09-19", "23:30", "00:30"), 3);
  assert.equal(bookingDays("2026-09-17", "2026-09-19", null, null, "PARKING"), 3);
});

test("bookingDays: комнаты по 24-часовым периодам", () => {
  assert.equal(bookingDays("2026-09-17", "2026-09-19", "12:00", "12:00", "ROOM"), 2);
  assert.equal(bookingDays("2026-09-17", "2026-09-19", "12:00", "14:00", "ROOM"), 3);
});

test("actualParkingDays: календарные дни по московскому времени", () => {
  // 23:50 МСК → 00:10 МСК следующего дня = 2 суток
  assert.equal(actualParkingDays(new Date("2026-09-17T20:50:00Z"), new Date("2026-09-17T21:10:00Z")), 2);
  // тот же московский день
  assert.equal(actualParkingDays(new Date("2026-09-17T06:00:00Z"), new Date("2026-09-17T18:00:00Z")), 1);
  // 21:30 UTC — это уже следующий день по Москве
  assert.equal(actualParkingDays(new Date("2026-09-16T21:30:00Z"), new Date("2026-09-19T09:00:00Z")), 3);
  // выезд раньше заезда не даёт 0
  assert.equal(actualParkingDays(new Date("2026-09-19T09:00:00Z"), new Date("2026-09-17T09:00:00Z")), 1);
});

test("addDays, daysBetweenIso, toDate/toIso", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetweenIso("2026-09-17", "2026-09-19"), 2);
  assert.equal(toIso(toDate("2026-09-17")), "2026-09-17");
});

test("форматирование дат", () => {
  assert.equal(fmtDate("2026-09-17"), "17 сент");
  assert.equal(fmtRange("2026-09-17", "2026-09-19"), "17 сент → 19 сент");
  // 09:05 UTC = 12:05 МСК
  assert.match(fmtDateTime(new Date("2026-09-17T09:05:00Z")), /17 сент.*12:05/);
});
