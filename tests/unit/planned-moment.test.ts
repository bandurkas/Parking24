import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDayTime, plannedMoment, toDate } from "@/server/lib/dates";

test("fmtDayTime: дата и время для сообщения", () => {
  assert.equal(fmtDayTime("2026-10-01", "12:00"), "1 октября, 12:00");
  assert.equal(fmtDayTime("2026-10-01", null), "1 октября, 12:00");
  assert.equal(fmtDayTime(toDate("2026-12-31"), "08:30"), "31 декабря, 08:30");
});

test("plannedMoment: московское время переводится в UTC", () => {
  // 12:00 МСК = 09:00 UTC
  assert.equal(plannedMoment("2026-10-01", "12:00").toISOString(), "2026-10-01T09:00:00.000Z");
  // 00:30 МСК = 21:30 UTC предыдущего дня
  assert.equal(plannedMoment("2026-10-01", "00:30").toISOString(), "2026-09-30T21:30:00.000Z");
  // без времени берётся полдень
  assert.equal(plannedMoment("2026-10-01").toISOString(), "2026-10-01T09:00:00.000Z");
  // зимой смещение то же: в России перехода на летнее время нет
  assert.equal(plannedMoment("2026-01-15", "12:00").toISOString(), "2026-01-15T09:00:00.000Z");
});

test("plannedMoment: понятен как момент времени для сравнения", () => {
  const a = plannedMoment("2026-10-01", "12:00");
  const b = plannedMoment("2026-10-02", "12:00");
  assert.equal(b.getTime() - a.getTime(), 86_400_000);
});
