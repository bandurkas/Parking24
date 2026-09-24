import { test } from "node:test";
import assert from "node:assert/strict";
import { actualParkingDays, fmtDayTime, moscowIso, overstayDayIso, plannedMoment, toDate } from "@/server/lib/dates";

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

test("отметка датой (12:00 МСК) не уезжает в соседние сутки", () => {
  assert.equal(moscowIso(plannedMoment("2026-09-21")), "2026-09-21");
});

test("льготный час: полдень отметки-даты день не сдвигает (полночь бы сдвинула)", () => {
  assert.equal(overstayDayIso(plannedMoment("2026-09-21")), "2026-09-21");
  assert.equal(overstayDayIso(plannedMoment("2026-09-21", "00:00")), "2026-09-20");
});

test("actualParkingDays: заезд отмечен датой — сутки считаются по датам", () => {
  // заезд 20.09 датой, выезд 21.09 в 10:00 МСК, план до 21.09 → 2 суток
  assert.equal(actualParkingDays(plannedMoment("2026-09-20"), new Date("2026-09-21T07:00:00Z"), "2026-09-21"), 2);
});

// ── Ф3: plannedMoment не зависит от пояса процесса (npm run test:tz — тот же файл под TZ=Asia/Jakarta) ──
import { tzOffsetMs, plannedCheckIn, plannedCheckOut, within24h, before24h } from "@/server/lib/dates";
import { isHHMM } from "@/lib/periods";

test("plannedMoment: кривое время — 12:00 МСК, а не Invalid Date", () => {
  for (const t of ["25:00", "", "7:5", "12:60", "24:00", "ab:cd"]) assert.equal(plannedMoment("2026-10-01", t).toISOString(), "2026-10-01T09:00:00.000Z", t);
  assert.equal(plannedMoment("2026-10-01", "23:59").toISOString(), "2026-10-01T20:59:00.000Z");
  assert.equal(isHHMM("00:00"), true);
  assert.equal(isHHMM("25:00"), false);
});

test("plannedMoment: Date из @db.Date (полночь UTC) — та же календарная дата", () => {
  assert.equal(plannedMoment(toDate("2026-10-01"), "12:00").toISOString(), "2026-10-01T09:00:00.000Z");
});

test("tzOffsetMs: Москва +3 летом и зимой, Джакарта +7", () => {
  assert.equal(tzOffsetMs(new Date("2026-07-01T00:00:00Z")), 3 * 3_600_000);
  assert.equal(tzOffsetMs(new Date("2026-01-01T00:00:00Z")), 3 * 3_600_000);
  assert.equal(tzOffsetMs(new Date("2026-07-01T00:00:00Z"), "Asia/Jakarta"), 7 * 3_600_000);
  assert.equal(tzOffsetMs(new Date("2026-01-01T00:00:00.500Z"), "Asia/Jakarta"), 7 * 3_600_000);
});

test("plannedMoment: несуществующее время (перевод вперёд) — сдвиг вперёд на час", () => {
  // Нью-Йорк 08.03.2026: 02:00 → 03:00; 02:30 не существует → 03:30 EDT = 07:30 UTC
  assert.equal(plannedMoment("2026-03-08", "02:30", "America/New_York").toISOString(), "2026-03-08T07:30:00.000Z");
  // Берлин 29.03.2026: 02:00 → 03:00; 02:30 → 03:30 CEST = 01:30 UTC
  assert.equal(plannedMoment("2026-03-29", "02:30", "Europe/Berlin").toISOString(), "2026-03-29T01:30:00.000Z");
});

test("plannedMoment: неоднозначное время (перевод назад) — более ранний момент", () => {
  // Нью-Йорк 01.11.2026: 01:30 бывает дважды — берём EDT (05:30 UTC), а не EST (06:30 UTC)
  assert.equal(plannedMoment("2026-11-01", "01:30", "America/New_York").toISOString(), "2026-11-01T05:30:00.000Z");
  // Берлин 25.10.2026: 02:30 дважды — CEST (00:30 UTC), а не CET (01:30 UTC)
  assert.equal(plannedMoment("2026-10-25", "02:30", "Europe/Berlin").toISOString(), "2026-10-25T00:30:00.000Z");
  // рядом с переходом, но однозначно
  assert.equal(plannedMoment("2026-11-01", "12:00", "America/New_York").toISOString(), "2026-11-01T17:00:00.000Z");
});

test("plannedCheckIn/plannedCheckOut: без времени — 12:00 МСК того же дня", () => {
  assert.equal(plannedCheckIn({ dateFrom: "2026-10-01", timeFrom: null }).toISOString(), "2026-10-01T09:00:00.000Z");
  assert.equal(plannedCheckOut({ dateTo: toDate("2026-10-03"), timeTo: "" }).toISOString(), "2026-10-03T09:00:00.000Z");
  assert.equal(plannedCheckOut({ dateTo: "2026-10-03", timeTo: "08:15" }).toISOString(), "2026-10-03T05:15:00.000Z");
});

test("within24h/before24h: «сейчас» входит, прошедшее — только в before24h, после 24 ч — никуда", () => {
  const now = new Date("2026-10-01T09:00:00Z");
  const h = (n: number) => new Date(now.getTime() + n * 3_600_000);
  assert.equal(within24h(now, now), true);
  assert.equal(within24h(h(-1 / 60), now), false);
  assert.equal(before24h(h(-72), now), true);
  assert.equal(before24h(h(25), now), false);
  assert.equal(within24h(h(25), now), false);
});
