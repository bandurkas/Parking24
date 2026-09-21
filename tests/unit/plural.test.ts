import { test } from "node:test";
import assert from "node:assert/strict";
import { plural, formatRub } from "@/lib/tariffs";

const days = (n: number) => `${n} ${plural(n, "сутки", "суток", "суток")}`;

test("склонение суток в сообщениях клиенту", () => {
  assert.equal(days(1), "1 сутки");
  assert.equal(days(2), "2 суток");
  assert.equal(days(5), "5 суток");
  assert.equal(days(11), "11 суток");
  assert.equal(days(21), "21 сутки");
  assert.equal(days(22), "22 суток");
  assert.equal(days(101), "101 сутки");
  assert.equal(days(111), "111 суток");
});

test("склонение обычных слов", () => {
  assert.equal(plural(1, "место", "места", "мест"), "место");
  assert.equal(plural(3, "место", "места", "мест"), "места");
  assert.equal(plural(14, "место", "места", "мест"), "мест");
  assert.equal(plural(0, "место", "места", "мест"), "мест");
});

test("сумма в рублях с неразрывным пробелом", () => {
  assert.match(formatRub(1050), /^1.050 ₽$/);
  assert.equal(formatRub(0), "0 ₽");
});
