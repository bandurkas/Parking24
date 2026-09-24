import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slotHours, moscowMinutes, hhmm, shiftDateOf, tabelToday, windowOf, minutesFrom, startOptions, shiftState, lastOwnAction,
  gridEditCheck, monthDays, monthEnd, addMonths, columnsOf, shortLabel, colorOf, CHIP_COLORS, warningsOf, gapsOf, countsOf,
  csvOfReport, cellKey, type Slot, type MarkKey,
} from "@/lib/workshift";
import { addDays } from "@/server/lib/dates";

const at = (s: string) => new Date(s);
const opts = (now: string, slots: Slot[]) =>
  startOptions(at(now), slots).map((o) => `${o.slot} ${o.date.slice(8)}${o.late ? " поздн" : ""}${o.suggested ? " *" : ""}`);

test("1. slotHours: день и ночь — 12, сутки — 24", () => {
  assert.equal(slotHours("DAY"), 12);
  assert.equal(slotHours("NIGHT"), 12);
  assert.equal(slotHours("FULL"), 24);
});

test("2. moscowMinutes и hhmm по Москве; полночь — 0, не 1440", () => {
  assert.equal(moscowMinutes(at("2026-09-22T04:55:00Z")), 475);
  assert.equal(hhmm(at("2026-09-22T04:55:00Z")), "07:55");
  assert.equal(moscowMinutes(at("2026-09-22T21:00:00Z")), 0);
  assert.equal(hhmm(at("2026-09-22T21:00:00Z")), "00:00");
});

test("3. shiftDateOf и tabelToday: до 02:00 — ещё вчера", () => {
  for (const f of [shiftDateOf, tabelToday]) {
    assert.equal(f(at("2026-09-22T17:05:00Z")), "2026-09-22");
    assert.equal(f(at("2026-09-22T21:30:00Z")), "2026-09-22");
    assert.equal(f(at("2026-09-22T23:30:00Z")), "2026-09-23");
  }
});

test("4. windowOf и minutesFrom", () => {
  assert.deepEqual(windowOf("DAY"), [480, 1200]);
  assert.deepEqual(windowOf("NIGHT"), [1200, 1920]);
  assert.deepEqual(windowOf("FULL"), [480, 1920]);
  assert.equal(minutesFrom("2026-09-22", at("2026-09-22T21:30:00Z")), 1470);
});

test("5. startOptions [DAY, NIGHT]: только начавшиеся или близкие окна", () => {
  const DN: Slot[] = ["DAY", "NIGHT"];
  assert.deepEqual(opts("2026-09-25T06:00:00Z", DN), ["DAY 25 *", "NIGHT 24 поздн"]); // 09:00 — ночи 25-го нет
  assert.deepEqual(opts("2026-09-25T09:30:00Z", DN), ["DAY 25 *"]); // 12:30 — ночь сегодня не предлагается
  assert.deepEqual(opts("2026-09-25T16:00:00Z", DN), ["NIGHT 25 *", "DAY 25"]); // 19:00
  assert.deepEqual(opts("2026-09-25T03:30:00Z", DN), ["DAY 25 *", "NIGHT 24"]); // 06:30
  assert.deepEqual(opts("2026-09-25T00:00:00Z", DN), ["NIGHT 24 *"]); // 03:00 — идёт вчерашняя ночь
  assert.deepEqual(opts("2026-09-24T21:30:00Z", DN), ["NIGHT 24 *"]); // 00:30
});

test("6. startOptions [FULL] и [DAY]: сутки в 03:00 — вчерашние", () => {
  assert.deepEqual(opts("2026-09-25T00:00:00Z", ["FULL"]), ["FULL 24 *"]); // 03:00
  assert.deepEqual(opts("2026-09-25T04:00:00Z", ["FULL"]), ["FULL 25 *", "FULL 24"]); // 07:00
  assert.deepEqual(opts("2026-09-25T06:00:00Z", ["FULL"]), ["FULL 25 *", "FULL 24 поздн"]); // 09:00
  assert.deepEqual(opts("2026-09-25T10:00:00Z", ["FULL"]), ["FULL 25 *"]); // 13:00
  assert.deepEqual(opts("2026-09-25T19:00:00Z", ["DAY"]), ["DAY 25 поздн"]); // 22:00 — предложенного нет
  assert.deepEqual(opts("2026-09-24T23:00:00Z", ["DAY"]), []); // 02:00
});

test("7. startOptions перебором: не будущее, окна «сейчас» и «прошедшая» соблюдены", () => {
  const sets: Slot[][] = [["DAY", "NIGHT"], ["FULL"], ["DAY"], ["NIGHT"], ["DAY", "NIGHT", "FULL"]];
  const start = at("2026-09-24T21:00:00Z").getTime();
  for (let t = start; t < start + 2 * 86_400_000; t += 15 * 60_000) {
    const now = new Date(t);
    for (const slots of sets) {
      const list = startOptions(now, slots);
      assert.ok(list.filter((o) => o.suggested).length <= 1);
      if (list.some((o) => o.suggested)) assert.ok(list[0].suggested && !list[0].late);
      for (const o of list) {
        assert.ok(o.date <= tabelToday(now), `${now.toISOString()} ${o.slot} ${o.date}`);
        const [s, e] = windowOf(o.slot);
        const m = minutesFrom(o.date, now);
        if (o.late) assert.ok(m >= e && m < e + 240);
        else assert.ok(m >= s - 120 && m < e);
      }
    }
  }
});

test("8. shiftState: открыта — только с openFor и пока окно не истекло", () => {
  const day = { date: "2026-09-25", slot: "DAY" as Slot, startedAt: at("2026-09-25T04:55:00Z"), endedAt: null, openFor: "e1" };
  assert.equal(shiftState({ ...day, startedAt: null }, at("2026-09-25T12:00:00Z")), "manual");
  assert.equal(shiftState({ ...day, endedAt: at("2026-09-25T17:00:00Z"), openFor: null }, at("2026-09-25T18:00:00Z")), "closed");
  assert.equal(shiftState(day, at("2026-09-25T12:00:00Z")), "open");
  assert.equal(shiftState(day, at("2026-09-25T20:59:00Z")), "open"); // 23:59
  assert.equal(shiftState(day, at("2026-09-25T21:01:00Z")), "no-leave"); // 00:01 26-го
  assert.equal(shiftState({ ...day, openFor: null }, at("2026-09-25T12:00:00Z")), "no-leave");
  const full = { date: "2026-09-24", slot: "FULL" as Slot, startedAt: at("2026-09-24T05:00:00Z"), endedAt: null, openFor: "e2" };
  assert.equal(shiftState(full, at("2026-09-25T08:59:00Z")), "open"); // 11:59 25-го
  assert.equal(shiftState(full, at("2026-09-25T09:01:00Z")), "no-leave"); // 12:01
  const late = { date: "2026-09-24", slot: "NIGHT" as Slot, startedAt: at("2026-09-25T06:10:00Z"), endedAt: null, openFor: null };
  assert.equal(shiftState(late, at("2026-09-25T06:11:00Z")), "late");
  const cash = { date: "2026-09-24", slot: "NIGHT" as Slot, startedAt: at("2026-09-24T17:05:00Z"), endedAt: at("2026-09-25T05:00:00Z"), openFor: null };
  assert.equal(shiftState(cash, at("2026-09-25T06:00:00Z")), "closed");
});

test("9. lastOwnAction: последнее своё действие за 15 минут", () => {
  const now = at("2026-09-25T10:00:00Z");
  const ago = (m: number) => new Date(now.getTime() - m * 60_000);
  assert.deepEqual(lastOwnAction([{ id: "a", startedAt: ago(5), endedAt: null }], now), { kind: "start", id: "a", at: ago(5) });
  assert.equal(lastOwnAction([{ id: "a", startedAt: ago(300), endedAt: ago(5) }], now)?.kind, "leave");
  assert.equal(lastOwnAction([{ id: "a", startedAt: ago(16), endedAt: null }], now), null);
  assert.equal(lastOwnAction([{ id: "m", startedAt: null, endedAt: null }], now), null);
  assert.equal(lastOwnAction([{ id: "a", startedAt: ago(10), endedAt: null }, { id: "b", startedAt: ago(3), endedAt: null }], now)?.id, "b");
});

test("10. gridEditCheck: будущее, себя, причина, выключенные", () => {
  const base = { actorRole: "ADMIN" as const, actorId: "u1", empUserId: "u2", date: "2026-09-25", today: "2026-09-25", op: "mark" as const };
  assert.equal(gridEditCheck({ ...base, date: "2026-09-26" }).ok, false);
  assert.equal(gridEditCheck({ ...base, empUserId: "u1" }).ok, false);
  assert.deepEqual(gridEditCheck({ ...base, actorRole: "OWNER", empUserId: "u1" }), { ok: true, needReason: false });
  assert.deepEqual(gridEditCheck(base), { ok: true, needReason: false });
  assert.deepEqual(gridEditCheck({ ...base, date: "2026-09-24" }), { ok: true, needReason: false });
  assert.deepEqual(gridEditCheck({ ...base, date: "2026-09-23" }), { ok: true, needReason: true });
  assert.deepEqual(gridEditCheck({ ...base, op: "unmark", selfMade: true }), { ok: true, needReason: true });
  assert.equal(gridEditCheck({ ...base, active: false }).ok, false);
  assert.deepEqual(gridEditCheck({ ...base, actorRole: "OWNER", active: false }), { ok: true, needReason: false });
});

test("11. monthDays: число строк и дни недели не зависят от пояса процесса", () => {
  const sep = monthDays("2026-09");
  assert.equal(sep.length, 30);
  assert.deepEqual(sep[0], { date: "2026-09-01", weekday: "вт", weekend: false });
  assert.deepEqual(sep[4], { date: "2026-09-05", weekday: "сб", weekend: true });
  assert.equal(sep[5].weekend, true);
  assert.equal(monthDays("2028-02").length, 29);
  assert.equal(monthEnd("2026-12"), "2026-12-31");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
});

test("12. columnsOf: порядок, слоты с отметками, выключенные должности", () => {
  const pos = [
    { id: "b", name: "Охрана", slots: ["FULL"] as Slot[], requiredSlots: ["FULL"] as Slot[], sortOrder: 2, isActive: true },
    { id: "a", name: "Администратор", slots: ["NIGHT", "DAY"] as Slot[], requiredSlots: ["DAY"] as Slot[], sortOrder: 1, isActive: true },
    { id: "c", name: "Старое", slots: ["DAY"] as Slot[], requiredSlots: [] as Slot[], sortOrder: 0, isActive: false },
  ];
  const cols = columnsOf(pos, [{ employeeId: "e", positionId: "a", date: "2026-09-03", slot: "FULL" }]);
  assert.deepEqual(cols.map((c) => `${c.positionId}:${c.slot}:${c.required ? "R" : ""}:${c.configured ? "C" : ""}`), ["a:DAY:R:C", "a:NIGHT::C", "a:FULL::", "b:FULL:R:C"]);
  const withOld = columnsOf(pos, [{ employeeId: "e", positionId: "c", date: "2026-09-03", slot: "DAY" }]);
  assert.equal(withOld[0].positionId, "c");
  assert.equal(withOld[0].required, false);
});

test("13. shortLabel и colorOf", () => {
  assert.equal(shortLabel({ name: "Иван Петров", shortName: "Ваня" }), "Ваня");
  assert.equal(shortLabel({ name: "Иван Петров", shortName: " " }), "Иван");
  assert.equal(shortLabel({ name: "" }), "—");
  const c = colorOf("cmabc123");
  assert.equal(c, colorOf("cmabc123"));
  for (const id of ["a", "bb", "cmf0x9", "zzzzzzzzzzzzzzzzzzzz"]) assert.ok(colorOf(id) >= 0 && colorOf(id) < CHIP_COLORS);
});

test("14. warningsOf: пересечение или стык окон, точка на поздней дате", () => {
  const n = () => "Иванов";
  const w = (marks: MarkKey[]) => warningsOf(marks, n).map((x) => `${x.date.slice(5)} ${x.text.includes("подряд") ? "стык" : "пересеч"}`);
  const m = (date: string, slot: Slot, employeeId = "e"): MarkKey => ({ employeeId, positionId: "p", date, slot });
  assert.deepEqual(w([m("2026-09-03", "NIGHT"), m("2026-09-04", "DAY")]), ["09-04 стык"]);
  assert.deepEqual(w([m("2026-09-03", "DAY"), m("2026-09-03", "NIGHT")]), ["09-03 стык"]);
  assert.deepEqual(w([m("2026-09-03", "FULL"), m("2026-09-03", "DAY")]), ["09-03 пересеч"]);
  assert.deepEqual(w([m("2026-09-03", "NIGHT"), m("2026-09-04", "FULL")]), ["09-04 стык"]);
  assert.deepEqual(w([m("2026-09-03", "FULL"), m("2026-09-04", "FULL")]), ["09-04 стык"]);
  assert.deepEqual(w([m("2026-08-31", "NIGHT"), m("2026-09-01", "DAY")]), ["09-01 стык"]);
  assert.deepEqual(w([m("2026-09-03", "DAY"), m("2026-09-04", "DAY")]), []);
  assert.deepEqual(w([m("2026-09-03", "NIGHT", "a"), m("2026-09-04", "DAY", "b")]), []);
  assert.match(warningsOf([m("2026-09-03", "NIGHT"), m("2026-09-04", "DAY")], n)[0].text, /^Иванов: ночь 3 сент и день 4 сент подряд$/);
});

test("15. gapsOf: только обязательные слоты и только прошедшие даты", () => {
  const cols = columnsOf(
    [{ id: "a", name: "А", slots: ["DAY", "NIGHT"], requiredSlots: ["DAY"], sortOrder: 0, isActive: true }],
    [],
  );
  const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
  const g = gapsOf(cols, days, [{ employeeId: "e", positionId: "a", date: "2026-09-01", slot: "DAY" }], "2026-09-03");
  assert.deepEqual([...g], [cellKey("a", "DAY", "2026-09-02")]);
});

test("16. countsOf: по паре сотрудник + должность, часы из hours", () => {
  const rows = countsOf([
    { employeeId: "e", employee: "Иван", positionId: "a", position: "Адм", slot: "DAY", hours: 12, manual: false },
    { employeeId: "e", employee: "Иван", positionId: "a", position: "Адм", slot: "NIGHT", hours: 11, manual: true },
    { employeeId: "e", employee: "Иван", positionId: "b", position: "Охрана", slot: "FULL", hours: 24, manual: true },
  ]);
  assert.deepEqual(rows, [
    { employee: "Иван", position: "Адм", day: 1, night: 1, full: 0, total: 2, hours: 23, manual: 1 },
    { employee: "Иван", position: "Охрана", day: 0, night: 0, full: 1, total: 1, hours: 24, manual: 1 },
  ]);
  assert.deepEqual(countsOf([]), []);
});

test("17. csvOfReport: заголовок, «;», кавычки удвоены, без денег", () => {
  const csv = csvOfReport([{ employee: 'Иван "Ваня"', position: "Адм;ночь", day: 1, night: 0, full: 0, total: 1, hours: 12, manual: 1 }]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], '"Сотрудник";"Должность";"День";"Ночь";"Сутки";"Всего смен";"Часов";"Из них вручную"');
  assert.equal(lines[1], '"Иван ""Ваня""";"Адм;ночь";1;0;0;1;12;1');
  assert.equal(lines[2], '"Итого";"";1;0;0;1;12;1');
  assert.ok(!/ставк|₽|сумм/i.test(csv));
});

test("tabelToday и startOptions согласованы с addDays на границе месяца", () => {
  const now = at("2026-09-30T22:30:00Z"); // 01:30 МСК 1 октября
  assert.equal(tabelToday(now), "2026-09-30");
  assert.deepEqual(startOptions(now, ["NIGHT"]).map((o) => o.date), ["2026-09-30"]);
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
});
