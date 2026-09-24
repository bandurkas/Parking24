import { test } from "node:test";
import assert from "node:assert/strict";
import { cashDiff, expectedCash, reportRows, shiftReportText, shiftTotals, signedRub, type ReportInput } from "@/lib/cash";
import { shiftDateOf } from "@/lib/workshift";

const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const pay = (kind: string, method: string, amount: number, extra: { status?: string; reversalOfId?: string | null } = {}) => ({ kind, method, amount, status: extra.status ?? "SUCCEEDED", reversalOfId: extra.reversalOfId ?? null });

test("расчётный остаток (ТЗ 7.3): начало + наличные − возвраты наличными − инкассации", () => {
  const t = shiftTotals([pay("PAYMENT", "CASH", 3000), pay("PAYMENT", "CASH", 1050), pay("REFUND", "CASH", 700)], [{ amount: 2000 }, { amount: 500 }]);
  assert.deepEqual(t, { cashIn: 4050, cardIn: 0, cashRefund: 700, collected: 2500 });
  assert.equal(expectedCash(5000, t), 5000 + 4050 - 700 - 2500);
});

test("карта, перевод, онлайн и возвраты не наличными на наличный остаток не влияют", () => {
  const t = shiftTotals([pay("PAYMENT", "CARD_TERMINAL", 2100), pay("PAYMENT", "TRANSFER", 900), pay("PAYMENT", "ONLINE", 400), pay("REFUND", "CARD_TERMINAL", 350), pay("REFUND", "TRANSFER", 100)], []);
  assert.deepEqual(t, { cashIn: 0, cardIn: 2100, cashRefund: 0, collected: 0 });
  assert.equal(expectedCash(1000, t), 1000);
});

test("сторно уменьшает оплаты своего способа, а не «возвраты наличными»", () => {
  const t = shiftTotals([pay("PAYMENT", "CASH", 1050), pay("REFUND", "CASH", 1050, { reversalOfId: "p1" }), pay("PAYMENT", "CARD_TERMINAL", 700), pay("REFUND", "CARD_TERMINAL", 700, { reversalOfId: "p2" })], []);
  assert.deepEqual(t, { cashIn: 0, cardIn: 0, cashRefund: 0, collected: 0 });
  // Сторно оплаты из прошлой смены — в текущую: наличные этой смены уходят в минус, расчёт честный
  assert.equal(shiftTotals([pay("REFUND", "CASH", 500, { reversalOfId: "old" })], []).cashIn, -500);
});

test("непроведённые платежи не считаются", () => {
  const t = shiftTotals([pay("PAYMENT", "CASH", 1000, { status: "PENDING" }), pay("PAYMENT", "CASH", 1000, { status: "FAILED" }), pay("PAYMENT", "CASH", 300)], []);
  assert.equal(t.cashIn, 300);
});

test("расхождение: факт больше — плюс, меньше — минус, равно — ноль; расчёт не обрезается в ноль", () => {
  assert.equal(cashDiff(5200, 5000), 200);
  assert.equal(cashDiff(4800, 5000), -200);
  assert.equal(cashDiff(5000, 5000), 0);
  assert.equal(expectedCash(0, { cashIn: 0, cardIn: 0, cashRefund: 0, collected: 1000 }), -1000);
  assert.equal(nb(signedRub(200)), "+200 ₽");
  assert.equal(nb(signedRub(-1500)), "−1 500 ₽");
  assert.equal(nb(signedRub(0)), "0 ₽");
});

test("дата смены: открытие до 02:00 МСК — ещё вчерашняя дата (ночная смена — по дате начала)", () => {
  assert.equal(shiftDateOf(new Date("2026-09-22T17:05:00Z")), "2026-09-22"); // 20:05 МСК
  assert.equal(shiftDateOf(new Date("2026-09-22T22:59:00Z")), "2026-09-22"); // 01:59 МСК 23-го
  assert.equal(shiftDateOf(new Date("2026-09-22T23:00:00Z")), "2026-09-23"); // 02:00 МСК 23-го
  assert.equal(shiftDateOf(new Date("2026-09-23T05:00:00Z")), "2026-09-23"); // 08:00 МСК
});

const report = (actual: number | null): ReportInput => ({
  number: 12,
  date: "22 сентября",
  admin: "Иванов",
  opened: "22 сент, 20:05",
  closed: actual == null ? null : "23 сент, 08:30",
  closedBy: null,
  opening: 5000,
  totals: { cashIn: 12500, cardIn: 31000, cashRefund: 1500, collected: 10000 },
  expected: 6000,
  actual,
  collections: [{ at: "23 сент, 07:00", amount: 10000, takenBy: "Владелец", handedBy: "Иванов" }],
});

test("отчёт смены: все строки ТЗ 7.2, рубли, без «Rp», инкассация — кто забрал и кто передал", () => {
  const text = nb(shiftReportText(report(5800)));
  for (const line of ["Смена №12 · 22 сентября", "Администратор: Иванов", "Остаток на начало смены: 5 000 ₽", "Получено наличными: 12 500 ₽", "Получено картами: 31 000 ₽", "Возвраты наличными: 1 500 ₽", "Инкассация: 10 000 ₽", "забрал: Владелец · передал: Иванов", "Расчётный остаток на конец смены: 6 000 ₽", "Фактический остаток: 5 800 ₽", "Расхождение: −200 ₽"]) {
    assert.ok(text.includes(line), `нет строки «${line}» в\n${text}`);
  }
  assert.ok(!/Rp/.test(text));
});

test("открытая смена: расчётный остаток «сейчас», без факта и расхождения", () => {
  const labels = reportRows(report(null)).map(([l]) => l);
  assert.ok(labels.includes("Расчётный остаток сейчас"));
  assert.ok(!labels.includes("Фактический остаток") && !labels.includes("Расхождение"));
  assert.ok(nb(shiftReportText(report(null))).includes("не закрыта"));
});
