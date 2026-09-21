import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, formatPhone, normalizePlate, splitPlate } from "@/lib/phone";

test("normalizePhone: российские номера приводятся к +7", () => {
  assert.equal(normalizePhone("8 (905) 525-06-60"), "+79055250660");
  assert.equal(normalizePhone("+7 905 525 06 60"), "+79055250660");
  assert.equal(normalizePhone("9055250660"), "+79055250660");
});

test("normalizePhone: иностранные и мусор", () => {
  assert.equal(normalizePhone("+62 812 1901 0408"), "+6281219010408");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("1234567890123456"), null);
});

test("formatPhone", () => {
  assert.equal(formatPhone("+79055250660"), "+7 905 525-06-60");
  assert.equal(formatPhone("+6281219010408"), "+6281219010408");
  assert.equal(formatPhone(null), "—");
});

test("normalizePlate: латиница в кириллицу, без пробелов, верхний регистр", () => {
  assert.equal(normalizePlate("a 123 bc 77"), "А123ВС77");
  assert.equal(normalizePlate("т001тт-777"), "Т001ТТ777");
});

test("splitPlate", () => {
  assert.deepEqual(splitPlate("А123ВС77"), { left: "А123ВС", region: "77" });
  assert.deepEqual(splitPlate("Т001ТТ777"), { left: "Т001ТТ", region: "777" });
  assert.deepEqual(splitPlate("АБВ"), { left: "АБВ", region: "" });
});
