import { test } from "node:test";
import assert from "node:assert/strict";
import { parkingDays, billingPeriods, periodsFromMinutes, stayMinutes, fmtDuration } from "@/lib/periods";

test("parkingDays: даты заезда и выезда включительно", () => {
  assert.equal(parkingDays("2026-09-17", "2026-09-19"), 3);
  assert.equal(parkingDays("2026-09-17", "2026-09-17"), 1);
  assert.equal(parkingDays("2026-10-01", "2026-10-30"), 30);
  assert.equal(parkingDays("2026-09-30", "2026-10-02"), 3);
  assert.equal(parkingDays("2026-12-31", "2027-01-01"), 2);
  assert.equal(parkingDays("2028-02-28", "2028-03-01"), 3);
});

test("parkingDays: некорректные даты дают 0", () => {
  assert.equal(parkingDays("2026-09-19", "2026-09-17"), 0);
  assert.equal(parkingDays("", "2026-09-17"), 0);
  assert.equal(parkingDays("17.09.2026", "19.09.2026"), 0);
});

test("billingPeriods (комнаты): 24-часовые периоды с льготой 60 минут", () => {
  assert.equal(billingPeriods("2026-09-06", "2026-09-06", "10:00", "18:00"), 1);
  assert.equal(billingPeriods("2026-09-06", "2026-09-13", "10:00", "09:30"), 7);
  assert.equal(billingPeriods("2026-09-06", "2026-09-13", "10:00", "11:00"), 7);
  assert.equal(billingPeriods("2026-09-06", "2026-09-13", "10:00", "11:30"), 8);
  assert.equal(billingPeriods("2026-09-13", "2026-09-06"), 0);
});

test("billingPeriods: без времени берётся 12:00", () => {
  assert.equal(billingPeriods("2026-09-06", "2026-09-08"), 2);
  assert.equal(stayMinutes("2026-09-06", "2026-09-08"), 2880);
});

test("periodsFromMinutes: минимум 1, льгота учитывается", () => {
  assert.equal(periodsFromMinutes(0), 1);
  assert.equal(periodsFromMinutes(1440 + 60), 1);
  assert.equal(periodsFromMinutes(1440 + 61), 2);
  assert.equal(periodsFromMinutes(-5), 1);
});

test("fmtDuration", () => {
  assert.equal(fmtDuration(0), "0 мин");
  assert.equal(fmtDuration(1500), "1 сут. 1 ч");
  assert.equal(fmtDuration(10_180), "7 сут. 1 ч 40 мин");
});
