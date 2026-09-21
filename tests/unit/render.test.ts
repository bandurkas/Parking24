import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking, Client } from "@prisma/client";
import { renderTemplate } from "@/server/automations/render";

function booking(over: Partial<Booking> = {}): Booking {
  return {
    number: 42,
    contactName: "Иван",
    contactPhone: "+79055250660",
    dateFrom: new Date("2026-09-17T00:00:00Z"),
    dateTo: new Date("2026-09-19T00:00:00Z"),
    timeFrom: "10:00",
    timeTo: "18:30",
    vehicleType: "CAR",
    plate: "А123ВС77",
    amount: 1050,
    paidAmount: 0,
    days: 3,
    transferNeeded: false,
    ...over,
  } as unknown as Booking;
}

test("подстановка переменных брони и клиента", () => {
  const client = { name: "Иван Петров", phone: "+79055250660" } as unknown as Client;
  const out = renderTemplate("Здравствуйте, {{client.name}}! Бронь №{{booking.number}}: {{booking.dates}}, {{ booking.vehicle }}, {{booking.amount}} ₽.", { booking: booking(), client });
  assert.equal(out, "Здравствуйте, Иван Петров! Бронь №42: 17 сент → 19 сент, Легковая А123ВС77, 1050 ₽.");
});

test("без клиента берётся контакт брони, неизвестная переменная пустая", () => {
  const out = renderTemplate("{{client.name}} {{client.phone}} {{unknown.var}}", { booking: booking(), client: null });
  assert.equal(out, "Иван +79055250660");
});

test("переносы строк и абзацы сохраняются", () => {
  const body = "Здравствуйте!\n\nБронь №{{booking.number}}.\nЗаезд: {{booking.arrival}}\nВыезд: {{booking.departure}}\n\nЖдём вас.";
  const out = renderTemplate(body, { booking: booking(), client: null });
  assert.equal(out, "Здравствуйте!\n\nБронь №42.\nЗаезд: 17 сентября, 10:00\nВыезд: 19 сентября, 18:30\n\nЖдём вас.");
});

test("лишние пробелы убираются, знаки препинания не повисают", () => {
  const out = renderTemplate("Текст   с   пробелами {{unknown}} , и точка {{unknown}} .", { booking: booking(), client: null });
  assert.equal(out, "Текст с пробелами, и точка.");
});

test("пустая переменная не оставляет лишних пустых строк", () => {
  const out = renderTemplate("Первая строка\n{{unknown}}\n\nПоследняя строка", { booking: booking(), client: null });
  assert.equal(out, "Первая строка\n\nПоследняя строка");
});

test("обращение без имени не даёт «Здравствуйте, !»", () => {
  const noName = booking({ contactName: null });
  assert.equal(renderTemplate("{{greeting.hello}}", { booking: noName, client: null }), "Здравствуйте!");
  assert.equal(renderTemplate("{{greeting.hello}}", { booking: booking(), client: null }), "Здравствуйте, Иван!");
  assert.equal(renderTemplate("{{greeting.name}}напоминаем о брони", { booking: noName, client: null }), "напоминаем о брони");
  assert.equal(renderTemplate("{{greeting.name}}напоминаем о брони", { booking: booking(), client: null }), "Иван, напоминаем о брони");
});

test("склонение суток", () => {
  assert.equal(renderTemplate("{{booking.days}}", { booking: booking({ days: 1 }), client: null }), "1 сутки");
  assert.equal(renderTemplate("{{booking.days}}", { booking: booking({ days: 3 }), client: null }), "3 суток");
  assert.equal(renderTemplate("{{booking.days}}", { booking: booking({ days: 21 }), client: null }), "21 сутки");
});

test("строка оплаты зависит от долга", () => {
  // В сумме неразрывный пробел: «1 050 ₽» не должно разрываться переносом в мессенджере
  const nb = (s: string) => s.replace(/\u00a0/g, " ");
  assert.equal(nb(renderTemplate("{{booking.dueLine}}", { booking: booking({ amount: 1050, paidAmount: 0 }), client: null })), "К оплате на месте: 1 050 ₽, наличными или картой.");
  assert.equal(renderTemplate("{{booking.dueLine}}", { booking: booking({ amount: 1050, paidAmount: 1050 }), client: null }), "Бронь оплачена.");
  assert.equal(renderTemplate("{{booking.dueLine}}", { booking: booking({ amount: 1050, paidAmount: 2000 }), client: null }), "Бронь оплачена.");
});

test("строки про трансфер зависят от признака брони", () => {
  const free = renderTemplate("{{booking.transferLine}}", { booking: booking({ transferNeeded: true }), client: null });
  const paid = renderTemplate("{{booking.transferLine}}", { booking: booking({ transferNeeded: false }), client: null });
  assert.match(free, /бесплатный/);
  assert.match(paid, /от 4 суток/);
  assert.match(renderTemplate("{{booking.returnLine}}", { booking: booking({ transferNeeded: true }), client: null }), /Пришлём за вами бесплатный трансфер/);
});

test("ссылки и номер договора приходят извне", () => {
  const out = renderTemplate("Маршрут: {{links.route}} · договор №{{booking.contract}} · отзыв: {{links.review}}", { booking: booking(), client: null }, { route: "https://route", review: "https://review", contract: "001" });
  assert.equal(out, "Маршрут: https://route · договор №001 · отзыв: https://review");
});
