import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking, Client } from "@prisma/client";
import { TEMPLATES } from "../../prisma/templates";
import { buildVars } from "@/server/automations/render";
import { PREVIEW_NUMBER, TEMPLATE_VARS, previewCtx, previewExtras, renderPreview, varSamples } from "@/server/automations/preview";
import { unknownVars, validateTemplateBody } from "@/lib/settings-validate";

test("unknownVars: опечатка найдена, верная переменная — нет", () => {
  assert.deepEqual(unknownVars("Маршрут: {{links.rout}}\nОтзыв: {{ links.review }}", TEMPLATE_VARS), ["links.rout"]);
  assert.deepEqual(unknownVars("Маршрут: {{links.route}}", TEMPLATE_VARS), []);
});

test("тексты поставки не содержат неизвестных переменных", () => {
  for (const t of TEMPLATES) assert.deepEqual(unknownVars(t.body, TEMPLATE_VARS), [], t.code);
});

test("список переменных берётся из рендера: есть видео, договор, обращение", () => {
  for (const k of ["links.video", "links.review", "links.route", "booking.contract", "greeting.hello", "booking.number"]) assert.ok(TEMPLATE_VARS.includes(k), k);
});

test("набор переменных не зависит от данных брони (иначе проверка отклонит законный текст)", () => {
  const a = previewCtx();
  const b = { booking: { ...a.booking, amount: 0, paidAmount: 0, contactName: null, vehicleType: null, plate: null, timeFrom: null, kind: "ROOM" } as unknown as Booking, client: null as Client | null };
  assert.deepEqual(Object.keys(buildVars(b, {})).sort(), Object.keys(buildVars(a, previewExtras({ route: "https://x", review: "https://y", video: "https://z" }))).sort());
});

test("предпросмотр каждого текста поставки без {{ и с номером демонстрационной брони", () => {
  for (const t of TEMPLATES) {
    const out = renderPreview(t.body, { route: "https://example.com/route", review: "", video: "" });
    assert.ok(!out.includes("{{"), t.code);
    if (t.body.includes("{{booking.number}}")) assert.ok(out.includes(String(PREVIEW_NUMBER)), t.code);
  }
});

test("предпросмотр подставляет сохранённые ссылки, пустая ссылка выпадает строкой", () => {
  const body = "Отзыв: {{links.review}}\nВидео: {{links.video}}\nКонец";
  assert.equal(renderPreview(body, { route: "", review: "https://r.example", video: "" }), "Отзыв: https://r.example\nКонец");
  assert.equal(renderPreview(body, { route: "", review: "", video: "https://v.example" }), "Видео: https://v.example\nКонец");
});

test("подсказки: у каждой переменной есть образец значения", () => {
  const s = varSamples({ route: "https://r", review: "", video: "" });
  assert.equal(s.length, TEMPLATE_VARS.length);
  assert.equal(s.find((v) => v.name === "booking.number")?.sample, String(PREVIEW_NUMBER));
  assert.equal(s.find((v) => v.name === "links.route")?.sample, "https://r");
});

test("тексты поставки проходят проверку редактора без ошибок и предупреждений", () => {
  for (const t of TEMPLATES) assert.deepEqual(validateTemplateBody(t.body, TEMPLATE_VARS, t.body), { errors: [], warnings: [] }, t.code);
});
