import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking, Client } from "@prisma/client";
import { renderTemplate } from "@/server/automations/render";
import { TEMPLATES } from "../../prisma/templates";

// В суммах неразрывный пробел: «1 050 ₽» не должно разрываться переносом в мессенджере
const nb = (s: string) => s.replace(/\u00a0/g, " ");

function booking(over: Partial<Booking> = {}): Booking {
  return {
    number: 42,
    kind: "PARKING",
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
  assert.equal(nb(out), "Здравствуйте, Иван Петров! Бронь №42: 17 сент → 19 сент, Легковая А123ВС77, 1 050 ₽.");
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
  // без имени сообщение не должно начинаться со строчной буквы
  assert.equal(renderTemplate("{{greeting.name}}напоминаем о брони", { booking: noName, client: null }), "Напоминаем о брони");
  assert.equal(renderTemplate("{{greeting.name}}напоминаем о брони", { booking: booking(), client: null }), "Иван, напоминаем о брони");
});

test("склонение суток", () => {
  assert.equal(renderTemplate("{{booking.days}}", { booking: booking({ days: 1 }), client: null }), "1 сутки");
  assert.equal(renderTemplate("{{booking.days}}", { booking: booking({ days: 3 }), client: null }), "3 суток");
  assert.equal(renderTemplate("{{booking.days}}", { booking: booking({ days: 21 }), client: null }), "21 сутки");
});

test("строка оплаты зависит от долга", () => {
  assert.equal(nb(renderTemplate("{{booking.dueLine}}", { booking: booking({ amount: 1050, paidAmount: 0 }), client: null })), "К оплате на месте: 1 050 ₽, наличными или картой.");
  assert.equal(renderTemplate("{{booking.dueLine}}", { booking: booking({ amount: 1050, paidAmount: 1050 }), client: null }), "Бронь оплачена.");
  assert.equal(renderTemplate("{{booking.dueLine}}", { booking: booking({ amount: 1050, paidAmount: 2000 }), client: null }), "Бронь оплачена.");
});

test("трансфер бесплатный от 4 суток парковки, галочка брони на это не влияет", () => {
  const line = (over: Partial<Booking>) => renderTemplate("{{booking.transferLine}}", { booking: booking(over), client: null });
  assert.match(line({ days: 4 }), /для вас бесплатный/);
  assert.match(line({ days: 3, transferNeeded: true }), /от 4 суток/);
  assert.match(line({ days: 6, transferNeeded: false }), /для вас бесплатный/);
  assert.match(line({ days: 6, kind: "ROOM" }), /от 4 суток/);
  assert.match(renderTemplate("{{booking.returnLine}}", { booking: booking({ days: 5 }), client: null }), /Пришлём за вами бесплатный трансфер/);
  assert.match(renderTemplate("{{booking.returnLine}}", { booking: booking({ days: 2, transferNeeded: true }), client: null }), /стоимость подскажем/);
});

test("подпись без значения исчезает строкой, со значением остаётся", () => {
  const body = "Бронь № {{booking.number}}\nДоговор № {{booking.contract}}\nПринят: {{booking.checkedInAt}}\nМаршрут: {{links.route}}\nОтзыв, это займёт минуту: {{links.review}}\n\nКонец";
  assert.equal(renderTemplate(body, { booking: booking(), client: null }), "Бронь № 42\n\nКонец");
  assert.equal(
    renderTemplate(body, { booking: booking(), client: null }, { route: "https://r", contract: "001", checkedInAt: "22 сентября, 14:05" }),
    "Бронь № 42\nДоговор № 001\nПринят: 22 сентября, 14:05\nМаршрут: https://r\n\nКонец",
  );
});

test("ссылки и номер договора приходят извне", () => {
  const out = renderTemplate("Маршрут: {{links.route}} · договор №{{booking.contract}} · отзыв: {{links.review}}", { booking: booking(), client: null }, { route: "https://route", review: "https://review", contract: "001" });
  assert.equal(out, "Маршрут: https://route · договор №001 · отзыв: https://review");
});

test("строку с другими фразами не режем: висящая подпись лучше потерянного адреса", () => {
  const out = renderTemplate("Адрес: МО, г.о. Химки, с. Чашниково, схема: {{links.route}}", { booking: booking(), client: null });
  assert.equal(out, "Адрес: МО, г.о. Химки, с. Чашниково, схема:");
});

test("обращение не считается данными: строка без имени не пропадает", () => {
  const noName = booking({ contactName: null });
  assert.equal(renderTemplate("{{greeting.name}}напоминаем о брони на завтра:\nБронь № {{booking.number}}", { booking: noName, client: null }), "Напоминаем о брони на завтра:\nБронь № 42");
});

test("цена 0 (фура по запросу): ни «0 ₽», ни «Бронь оплачена»", () => {
  const truck = booking({ vehicleType: "TRUCK", amount: 0, paidAmount: 0 });
  for (const code of ["awaiting_payment", "booking_confirmed", "reminder_24h"]) {
    const out = renderTemplate(TEMPLATES.find((t) => t.code === code)!.body, { booking: truck, client: null });
    assert.doesNotMatch(nb(out), /\b0 ₽/, code);
    assert.doesNotMatch(out, /Бронь оплачена/, code);
  }
  assert.match(renderTemplate("{{booking.priceLine}}", { booking: truck, client: null }), /Стоимость подскажет администратор/);
  assert.equal(nb(renderTemplate("{{booking.priceLine}}", { booking: booking(), client: null })), "Стоимость: 1 050 ₽ за 3 суток");
});

test("боевые шаблоны из seed без имени и без ссылок не дают обрывков", () => {
  const noName = booking({ contactName: null, days: 2 });
  for (const t of TEMPLATES) {
    const out = renderTemplate(t.body, { booking: noName, client: null });
    assert.doesNotMatch(out, /\{\{/, t.code);
    assert.doesNotMatch(out, /(^|\n)[,.!?:;]/, t.code);
    assert.doesNotMatch(out, /,!|, !/, t.code);
    assert.doesNotMatch(out, /[:№]$/m, `${t.code}: подпись без значения`);
    assert.match(out, /^[А-ЯЁA-Z]/, `${t.code}: начало со строчной`);
  }
});

test("подтверждение оплаченной брони не обещает «предоплата не нужна»", () => {
  const body = TEMPLATES.find((t) => t.code === "booking_confirmed")!.body;
  const paid = renderTemplate(body, { booking: booking({ paidAmount: 1050 }), client: null });
  assert.match(paid, /Бронь оплачена\./);
  assert.doesNotMatch(paid, /Предоплата не нужна/);
  const booked = renderTemplate(TEMPLATES.find((t) => t.code === "awaiting_payment")!.body, { booking: booking(), client: null }, { route: "https://r" });
  assert.match(booked, /Предоплата не нужна/);
  assert.match(booked, /Маршрут: https:\/\/r/);
});
