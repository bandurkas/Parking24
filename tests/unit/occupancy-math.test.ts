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

// ── Ф3: одно правило занятости, потолок, окно 24 ч ──
import { poolOf, holdsSpace, holdSinceOf, worstDay, fitOn, effectiveSpan, dueState, DUE_WINDOW_H, loadByDayByType, OPEN_END } from "@/lib/occupancy-math";

test("poolOf: фура — свой пул, всё остальное (и без типа) — общий", () => {
  assert.equal(poolOf("TRUCK"), "TRUCK");
  for (const t of ["CAR", "SUV", "MOTO", null, undefined]) assert.equal(poolOf(t), "POOL");
});

test("holdsSpace: «Ожидает оплаты», «Подтверждена», «Заехал» держат всегда", () => {
  for (const status of ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"]) assert.equal(holdsSpace({ status, createdAt: 0 }, null), true);
});

test("holdsSpace: «Новая заявка» 23 ч держит при 24 ч, 25 ч — нет", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const since = holdSinceOf(now, 24);
  assert.equal(holdsSpace({ status: "NEW", createdAt: now.getTime() - 23 * 3_600_000 }, since), true);
  assert.equal(holdsSpace({ status: "NEW", createdAt: now.getTime() - 25 * 3_600_000 }, since), false);
});

test("holdsSpace: при 0 часов «Новая заявка» не держит никогда", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  assert.equal(holdSinceOf(now, 0), null);
  assert.equal(holdsSpace({ status: "NEW", createdAt: now }, holdSinceOf(now, 0)), false);
});

test("holdsSpace: закрытые и отклонённые не держат", () => {
  const since = new Date(0);
  for (const status of ["CANCELLED", "NO_SHOW", "REJECTED", "CHECKED_OUT"]) assert.equal(holdsSpace({ status, createdAt: Date.now() }, since), false);
});

test("fits: перевёрнутый отрезок — не помещается (раньше «проходил»)", () => {
  assert.equal(fits([], "2026-10-05", "2026-10-01", 395), false);
});

test("worstDay: день с максимумом, при равенстве — первый; отрезок из одного дня", () => {
  const spans = [span("2026-10-02", "2026-10-03"), span("2026-10-03", "2026-10-04"), span("2026-10-04", "2026-10-04")];
  assert.deepEqual(worstDay(spans, "2026-10-01", "2026-10-05"), { day: "2026-10-03", busy: 2 });
  assert.deepEqual(worstDay(spans, "2026-10-05", "2026-10-05"), { day: "2026-10-05", busy: 0 });
});

test("fitOn: граница 404/405 и перестой в тексте", () => {
  const busy = (n: number, overstay = 0) => Array.from({ length: n }, (_, i) => ({ ...span("2026-10-01", "2026-10-10"), overstay: i < overstay }));
  assert.equal(fitOn(busy(404), "2026-10-03", "2026-10-04", 405).ok, true);
  const full = fitOn(busy(405, 3), "2026-10-03", "2026-10-04", 405);
  assert.deepEqual(full, { ok: false, day: "2026-10-03", busy: 405, capacity: 405, overstay: 3 });
  assert.equal(fitOn([], "2026-10-05", "2026-10-01", 405).ok, false);
});

test("effectiveSpan + loadByDay: перестой занимает день через месяц (Ф2а)", () => {
  const s = effectiveSpan({ status: "CHECKED_IN", dateFrom: "2026-09-20", dateTo: "2026-09-25" }, "2026-10-01");
  assert.equal(s.dateTo, OPEN_END);
  assert.deepEqual(loadByDay([s], "2026-11-01", "2026-11-01").map((d) => d.busy), [1]);
});

test("loadByDayByType: категории считаются отдельно, без вместимости", () => {
  const rows = loadByDayByType([{ ...span("2026-10-01", "2026-10-02"), vehicleType: "CAR" }, { ...span("2026-10-02", "2026-10-02"), vehicleType: "TRUCK" }], "2026-10-01", "2026-10-02", ["CAR", "TRUCK"]);
  assert.deepEqual(rows.map((r) => [r.vehicleType, r.days.map((d) => d.busy)]), [["CAR", [1, 1]], ["TRUCK", [0, 1]]]);
});

test("dueState: прошло — late, до 24 ч включительно — soon, дальше — null", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  assert.equal(DUE_WINDOW_H, 24);
  assert.equal(dueState(at(-0.01), now), "late");
  assert.equal(dueState(at(-72), now), "late");
  assert.equal(dueState(now, now), "soon");
  assert.equal(dueState(at(24), now), "soon");
  assert.equal(dueState(at(24.01), now), null);
  assert.equal(dueState(at(5), now, 4), null);
});
