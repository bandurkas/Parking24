import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCorrection, checkDates, checkMinDate, neededDates, type Marks } from "@/lib/correction";

const none: Marks = { checkedIn: false, checkedOut: false };

test("neededDates: «Подтверждена» → «Заехал» без отметки — только дата заезда", () => {
  assert.deepEqual(neededDates("CHECKED_IN", none), { in: true, out: false });
});

test("neededDates: «Выехал» → «Заехал», заезд уже отмечен — дат не нужно", () => {
  assert.deepEqual(neededDates("CHECKED_IN", { checkedIn: true, checkedOut: true }), { in: false, out: false });
});

test("neededDates: «Заехал» → «Выехал» — только дата выезда", () => {
  assert.deepEqual(neededDates("CHECKED_OUT", { checkedIn: true, checkedOut: false }), { in: false, out: true });
});

test("neededDates: «Ожидает оплаты» → «Выехал» — обе даты", () => {
  assert.deepEqual(neededDates("CHECKED_OUT", none), { in: true, out: true });
});

test("neededDates: «Заехал» → «Отменена» и «Заехал» → «Подтверждена» — дат не нужно", () => {
  assert.deepEqual(neededDates("CANCELLED", { checkedIn: true, checkedOut: false }), { in: false, out: false });
  assert.deepEqual(neededDates("CONFIRMED", { checkedIn: true, checkedOut: false }), { in: false, out: false });
});

test("neededDates: «Заехал» → «Отклонена» — дат не нужно, отметка сохраняется", () => {
  assert.deepEqual(neededDates("REJECTED", { checkedIn: true, checkedOut: false }), { in: false, out: false });
});

test("checkDates: дата заезда в будущем — ошибка", () => {
  assert.match(checkDates({ in: "2026-09-25" }, "2026-09-24")!, /заезда.*будущем/);
});

test("checkDates: выезд раньше заезда — ошибка", () => {
  assert.equal(checkDates({ in: "2026-09-22", out: "2026-09-21" }, "2026-09-24"), "Выезд не может быть раньше заезда");
});

test("checkDates: формат «21.09.2026» — ошибка формата", () => {
  assert.match(checkDates({ in: "21.09.2026" }, "2026-09-24")!, /ГГГГ-ММ-ДД/);
});

test("checkDates: несуществующая дата — ошибка формата, а не перенос в следующий месяц", () => {
  assert.match(checkDates({ in: "2026-02-31" }, "2026-09-24")!, /заезда в формате/);
  assert.match(checkDates({ out: "2026-09-31" }, "2026-10-05")!, /выезда в формате/);
  assert.match(checkDates({ in: "2026-09-00" }, "2026-09-24")!, /заезда в формате/);
});

test("checkDates: обе даты сегодня — null", () => {
  assert.equal(checkDates({ in: "2026-09-24", out: "2026-09-24" }, "2026-09-24"), null);
});

test("checkDates: заезд и выезд в один прошедший день — null", () => {
  assert.equal(checkDates({ in: "2026-09-20", out: "2026-09-20" }, "2026-09-24"), null);
});

test("checkMinDate: раньше даты создания брони — ошибка с датой", () => {
  assert.equal(checkMinDate({ in: "2026-09-20" }, "2026-09-21"), "Дата заезда не может быть раньше создания брони (21 сентября)");
  assert.match(checkMinDate({ out: "2026-09-19" }, "2026-09-21")!, /выезда.*создания брони/);
});

test("checkMinDate: дата равна дате создания — null", () => {
  assert.equal(checkMinDate({ in: "2026-09-21", out: "2026-09-21" }, "2026-09-21"), null);
  assert.equal(checkMinDate({}, "2026-09-21"), null);
});

test("checkCorrection: исправление без ввода дат не перепроверяет старые кривые отметки", () => {
  const r = checkCorrection("CANCELLED", { in: "2026-09-22", out: "2026-09-20" }, {}, "2026-09-24", "2026-09-01");
  assert.deepEqual(r, { need: { in: false, out: false }, error: null });
});

test("checkCorrection: дата выезда раньше сохранённого заезда — отказ", () => {
  const r = checkCorrection("CHECKED_OUT", { in: "2026-09-22", out: null }, { out: "2026-09-21" }, "2026-09-24", "2026-09-01");
  assert.deepEqual(r.need, { in: false, out: true });
  assert.equal(r.error, "Выезд не может быть раньше заезда");
});

test("checkCorrection: нужная дата не введена — «Укажите дату», лишняя введённая дата не учитывается", () => {
  assert.equal(checkCorrection("CHECKED_OUT", { in: null, out: null }, { out: "2026-09-23" }, "2026-09-24", "2026-09-01").error, "Укажите дату заезда");
  // заезд уже отмечен — присланная дата заезда игнорируется, в том числе заведомо будущая
  assert.equal(checkCorrection("CHECKED_OUT", { in: "2026-09-22", out: null }, { in: "2030-01-01", out: "2026-09-23" }, "2026-09-24", "2026-09-01").error, null);
});

test("checkCorrection: нижняя граница — только у введённых дат", () => {
  // сохранённый заезд раньше даты создания (старая бронь) не мешает ввести выезд
  assert.equal(checkCorrection("CHECKED_OUT", { in: "2026-08-30", out: null }, { out: "2026-09-02" }, "2026-09-24", "2026-09-01").error, null);
  assert.match(checkCorrection("CHECKED_IN", { in: null, out: null }, { in: "2026-08-31" }, "2026-09-24", "2026-09-01").error!, /раньше создания брони \(1 сентября\)/);
});
