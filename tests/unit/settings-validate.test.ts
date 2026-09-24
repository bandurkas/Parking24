import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLink, validateLogin, validateNoShowHours, validatePassword, validateTemplateBody, validateTitle } from "@/lib/settings-validate";
import { TEMPLATE_VARS } from "@/server/automations/preview";

const check = (body: string, prev?: string) => validateTemplateBody(body, TEMPLATE_VARS, prev);

test("текст шаблона: пустой и длиннее 4000 — ошибка", () => {
  assert.equal(check("   \n ").errors.length, 1);
  assert.match(check("а".repeat(4001)).errors.join(), /4000/);
  assert.deepEqual(check("а".repeat(4000)).errors, []);
});

test("текст шаблона: неизвестная переменная и пустые скобки — ошибка с именем переменной", () => {
  assert.match(check("Маршрут: {{links.rout}}").errors.join(), /\{\{links\.rout\}\}/);
  assert.equal(check("Привет {{ }}").errors.length, 1);
  assert.equal(check("Привет {{booking.number").errors.length, 1);
});

test("текст шаблона: пропал номер брони, эмодзи, разметка — предупреждение, не запрет", () => {
  const prev = "Бронь № {{booking.number}}";
  const r = check("Бронь подтверждена", prev);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(), /номер брони/);
  assert.deepEqual(check("Бронь подтверждена", "Без номера").warnings, []);
  assert.match(check("Ждём вас 🚗").warnings.join(), /эмодзи/);
  assert.match(check("Это *важно*").warnings.join(), /разметка/);
  assert.match(check("# Заголовок").warnings.join(), /разметка/);
  assert.deepEqual(check("Сумма 1 050 ₽, до терминала 3–5 минут. Бронь № {{booking.number}}", prev).warnings, []);
});

test("ссылка: https и пусто — да, javascript:/mailto:/текст — нет, пробелы обрезаются", () => {
  assert.deepEqual(validateLink("  https://example.com/r  "), { ok: true, value: "https://example.com/r" });
  assert.deepEqual(validateLink(""), { ok: true, value: "" });
  assert.equal(validateLink("http://x.ru").ok, true);
  for (const bad of ["javascript:alert(1)", "mailto:a@b.ru", "просто текст", "data:text/html,1", "https://" + "a".repeat(500), "https://a.ru/\nОплатите на карту 1234", "https://a.ru/ x", "https://a.ru/\tx"]) {
    assert.equal(validateLink(bad).ok, false, bad);
  }
});

test("логин: нижний регистр, 3–32 латиницей", () => {
  assert.deepEqual(validateLogin("admin2"), { ok: true, value: "admin2" });
  assert.deepEqual(validateLogin(" Admin "), { ok: true, value: "admin" });
  for (const bad of ["ad", "ад", "a b", "_admin", "a".repeat(33)]) assert.equal(validateLogin(bad).ok, false, bad);
});

test("пароль: 9 символов — нет, 10 — да, больше 200 — нет", () => {
  assert.equal(validatePassword("123456789").ok, false);
  assert.equal(validatePassword("1234567890").ok, true);
  assert.equal(validatePassword("x".repeat(201)).ok, false);
});

test("название и часы «Не приехал»", () => {
  assert.deepEqual(validateTitle("  Место   забронировано ", "Название"), { ok: true, value: "Место забронировано" });
  assert.equal(validateTitle("  ", "Название").ok, false);
  assert.equal(validateNoShowHours(48).ok, true);
  for (const bad of [0, 169, 1.5, NaN]) assert.equal(validateNoShowHours(bad).ok, false, String(bad));
});
