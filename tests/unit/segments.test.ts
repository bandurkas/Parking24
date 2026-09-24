import { test } from "node:test";
import assert from "node:assert/strict";
import type { SegBooking, SegClient } from "@/lib/segments";
import { NO_SPACE_CSV_HEAD, csvCell, noSpaceCsv, noSpaceRow, noSpaceRows } from "@/lib/segments";

const D = (s: string) => new Date(s);
let n = 0;
function bk(p: Partial<SegBooking>): SegBooking {
  n += 1;
  return { id: `b${n}`, number: 100 + n, status: "REJECTED", rejectKind: null, rejectedAt: null, createdAt: D("2026-09-01T10:00:00Z"), dateFrom: D("2026-10-01T00:00:00Z"), dateTo: D("2026-10-05T00:00:00Z"), ...p };
}
const reject = (at: string, p: Partial<SegBooking> = {}) => bk({ rejectKind: "NO_SPACE", rejectedAt: D(at), createdAt: D(at), ...p });
const client = (bookings: SegBooking[], p: Partial<SegClient> = {}): SegClient => ({ id: "c1", name: "Иван", phone: "+79991234567", messenger: "TELEGRAM", doNotDisturb: false, bookings, ...p });

test("без отказа NO_SPACE клиента в сегменте нет", () => {
  assert.equal(noSpaceRow(client([bk({ status: "CONFIRMED" }), bk({ rejectKind: "OTHER", rejectedAt: D("2026-09-02T10:00:00Z") })])), null);
});

test("один отказ, других броней нет — «потом забронировал: нет», даты заявки и время отказа", () => {
  const r = reject("2026-09-10T09:00:00Z", { dateFrom: D("2026-11-03T00:00:00Z"), dateTo: D("2026-11-05T00:00:00Z") });
  const row = noSpaceRow(client([r]))!;
  assert.equal(row.rejectCount, 1);
  assert.equal(row.lastRejectedAt.toISOString(), "2026-09-10T09:00:00.000Z");
  assert.deepEqual(row.missed, { id: r.id, number: r.number, dateFrom: r.dateFrom, dateTo: r.dateTo });
  assert.equal(row.bookedLater, null);
  assert.equal(row.messenger, "TELEGRAM");
});

test("бронь в работе, созданная после отказа, — «потом забронировал»", () => {
  const later = bk({ status: "AWAITING_PAYMENT", createdAt: D("2026-09-11T09:00:00Z") });
  const row = noSpaceRow(client([reject("2026-09-10T09:00:00Z"), later]))!;
  assert.deepEqual(row.bookedLater, { id: later.id, number: later.number, status: "AWAITING_PAYMENT" });
});

test("бронь, созданная до отказа, «потом» не считается: на эти даты он не попал", () => {
  const before = bk({ status: "CHECKED_OUT", createdAt: D("2026-09-01T09:00:00Z") });
  assert.equal(noSpaceRow(client([before, reject("2026-09-10T09:00:00Z")]))!.bookedLater, null);
});

test("новая, отменённая, не приехал, отклонённая после отказа — не «забронировал»", () => {
  const after = (status: SegBooking["status"]) => bk({ status, createdAt: D("2026-09-12T09:00:00Z") });
  for (const s of ["NEW", "CANCELLED", "NO_SHOW", "REJECTED"] as const) {
    assert.equal(noSpaceRow(client([reject("2026-09-10T09:00:00Z"), after(s)]))!.bookedLater, null, s);
  }
});

test("два отказа: счётчик 2, последний — поздний, «потом» — относительно последнего", () => {
  const first = reject("2026-09-05T09:00:00Z");
  const between = bk({ status: "CONFIRMED", createdAt: D("2026-09-07T09:00:00Z") });
  const second = reject("2026-09-10T09:00:00Z", { dateFrom: D("2026-12-01T00:00:00Z"), dateTo: D("2026-12-02T00:00:00Z") });
  const row = noSpaceRow(client([second, between, first]))!;
  assert.equal(row.rejectCount, 2);
  assert.equal(row.missed.id, second.id);
  assert.equal(row.bookedLater, null, "бронь между отказами не закрывает последний отказ");
});

test("после Ф10: последний отказ возвращён в работу (отметка не стёрта) — «потом забронировал» эта же заявка", () => {
  const back = reject("2026-09-10T09:00:00Z", { status: "AWAITING_PAYMENT", createdAt: D("2026-09-10T08:59:00Z") });
  assert.equal(noSpaceRow(client([back]))!.bookedLater?.id, back.id);
  // возвращённый ранний отказ не закрывает более поздний
  const early = reject("2026-09-01T09:00:00Z", { status: "CONFIRMED" });
  assert.equal(noSpaceRow(client([early, reject("2026-09-10T09:00:00Z")]))!.bookedLater, null);
});

test("пустой rejectedAt — берётся время создания, строка не теряется", () => {
  const r = bk({ rejectKind: "NO_SPACE", rejectedAt: null, createdAt: D("2026-09-03T09:00:00Z") });
  assert.equal(noSpaceRow(client([r]))!.lastRejectedAt.toISOString(), "2026-09-03T09:00:00.000Z");
});

test("noSpaceRows: свежие отказы сверху, клиенты без NO_SPACE выпадают", () => {
  const rows = noSpaceRows([
    client([reject("2026-09-01T09:00:00Z")], { id: "old" }),
    client([bk({ status: "CONFIRMED" })], { id: "none" }),
    client([reject("2026-09-20T09:00:00Z")], { id: "new" }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["new", "old"]);
});

test("csvCell: кавычки удваиваются, «;» внутри кавычек, формулы Excel обезврежены", () => {
  assert.equal(csvCell('Иван "Ваня"; мл.'), '"Иван ""Ваня""; мл."');
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(csvCell("+7 999 123-45-67"), `"'+7 999 123-45-67"`);
  assert.equal(csvCell("-1"), `"'-1"`);
  assert.equal(csvCell("@x"), `"'@x"`);
  assert.equal(csvCell(5), '"5"');
});

test("noSpaceCsv: заголовок, время отказа по Москве, календарные даты, пометки", () => {
  const later = bk({ status: "CONFIRMED", createdAt: D("2026-09-11T09:00:00Z") });
  const r = reject("2026-09-10T21:30:00Z", { dateFrom: D("2026-11-03T00:00:00Z"), dateTo: D("2026-11-05T00:00:00Z") });
  const rows = noSpaceRows([client([r, later], { doNotDisturb: true, name: "=cmd" })]);
  const [head, line, extra] = noSpaceCsv(rows).split("\r\n");
  assert.equal(head, NO_SPACE_CSV_HEAD.map((h) => `"${h}"`).join(";"));
  assert.equal(extra, undefined);
  const cells = line.split(";");
  assert.equal(cells.length, NO_SPACE_CSV_HEAD.length);
  assert.deepEqual(cells, [
    `"'+7 999 123-45-67"`, `"'=cmd"`, '"Telegram"', '"да"',
    '"11.09.2026 00:30"', // 21:30 UTC = 00:30 МСК следующего дня
    '"1"', '"03.11.2026"', '"05.11.2026"', `"${r.number}"`, `"${later.number}"`,
  ]);
});
