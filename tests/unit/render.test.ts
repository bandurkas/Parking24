import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking, Client } from "@prisma/client";
import { renderTemplate } from "@/server/automations/render";

const booking = {
  number: 42, contactName: "Иван", contactPhone: "+79055250660", dateFrom: new Date("2026-09-17T00:00:00Z"), dateTo: new Date("2026-09-19T00:00:00Z"),
  vehicleType: "CAR", plate: "А123ВС77", amount: 1050,
} as unknown as Booking;

test("renderTemplate: подстановка переменных брони и клиента", () => {
  const client = { name: "Иван Петров", phone: "+79055250660" } as unknown as Client;
  const out = renderTemplate("Здравствуйте, {{client.name}}! Бронь №{{booking.number}}: {{booking.dates}}, {{ booking.vehicle }}, {{booking.amount}} ₽.", { booking, client });
  assert.equal(out, "Здравствуйте, Иван Петров! Бронь №42: 17 сент → 19 сент, Легковая А123ВС77, 1050 ₽.");
});

test("renderTemplate: без клиента берётся контакт брони, неизвестная переменная пустая", () => {
  const out = renderTemplate("{{client.name}} {{client.phone}} {{unknown.var}}", { booking, client: null });
  assert.equal(out, "Иван +79055250660");
});
