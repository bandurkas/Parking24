import { test } from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, planRuleSync, planTemplateSync, type SeedRule, type TemplateRow } from "../../prisma/templates";

const tpl = { code: "awaiting_payment", name: "Место забронировано", body: "Текст поставки v2" };
const row = (over: Partial<TemplateRow> = {}): TemplateRow => ({ name: tpl.name, body: tpl.body, defaultName: tpl.name, defaultBody: tpl.body, editedAt: null, ...over });

test("seed: неправленый шаблон с устаревшим текстом — текст обновляется", () => {
  assert.deepEqual(planTemplateSync(tpl, row({ body: "Текст поставки v1", defaultBody: "Текст поставки v1" })), { writeDefault: true, writeText: true });
});

test("seed: второй прогон ничего не пишет (идемпотентность, updatedAt не сдвигается)", () => {
  assert.deepEqual(planTemplateSync(tpl, row()), { writeDefault: false, writeText: false });
});

test("seed: правленый в CRM текст не трогается, даже когда поставка изменилась", () => {
  const edited = row({ body: "Текст заказчика", defaultBody: "Текст поставки v1", editedAt: new Date() });
  assert.deepEqual(planTemplateSync(tpl, edited), { writeDefault: true, writeText: false });
  assert.deepEqual(planTemplateSync(tpl, { ...edited, defaultBody: tpl.body }), { writeDefault: false, writeText: false });
});

test("seed: до первого прогона МФ-2 снимка нет — пишется снимок, шаблон не считается правленым", () => {
  assert.deepEqual(planTemplateSync(tpl, row({ defaultBody: null, defaultName: null })), { writeDefault: true, writeText: false });
});

test("seed: после «Вернуть текст по умолчанию» шаблон снова ведёт seed", () => {
  const restored = row({ editedAt: null, body: "Текст поставки v1", defaultBody: "Текст поставки v1" });
  assert.deepEqual(planTemplateSync(tpl, restored), { writeDefault: true, writeText: true });
});

test("seed: у SeedTemplate больше нет признака sync — все тексты поставки ведёт seed", () => {
  for (const t of TEMPLATES) assert.deepEqual(Object.keys(t).sort(), ["body", "code", "name"], t.code);
  const ext = TEMPLATES.find((t) => t.code === "extension_offer")!;
  assert.equal(planTemplateSync(ext, row({ body: "старый", name: ext.name, defaultBody: ext.body, defaultName: ext.name })).writeText, true);
});

const rule: SeedRule = { code: "on_awaiting_payment", name: "Ожидает оплаты → «место подтверждено»", trigger: "STATUS_CHANGED", triggerParams: { status: "AWAITING_PAYMENT", dedupGroup: "confirmation" }, templateId: "t1" };

test("seed правил: одинаковое правило — без записи; jsonb с другим порядком ключей — тоже", () => {
  assert.deepEqual(planRuleSync(rule, { name: rule.name, trigger: rule.trigger, triggerParams: { dedupGroup: "confirmation", status: "AWAITING_PAYMENT" }, templateId: "t1" }), {});
});

test("seed правил: ключ со значением undefined (jsonb его не хранит) — не правка", () => {
  const withUndef = { ...rule, triggerParams: { ...rule.triggerParams, delayHours: undefined } };
  assert.deepEqual(planRuleSync(withUndef, { name: rule.name, trigger: rule.trigger, triggerParams: { status: "AWAITING_PAYMENT", dedupGroup: "confirmation" }, templateId: "t1" }), {});
});

test("seed правил: условия, название и шаблон ведёт seed", () => {
  const patch = planRuleSync(rule, { name: "старое", trigger: "STATUS_CHANGED", triggerParams: { status: "AWAITING_PAYMENT" }, templateId: "t0" });
  assert.deepEqual(patch, { name: rule.name, triggerParams: rule.triggerParams, templateId: "t1" });
});

test("seed правил: isActive при обновлении не пишется никогда — выключенное в CRM не включится выкаткой", () => {
  for (const active of [true, false, undefined]) {
    const patch = planRuleSync({ ...rule, active }, { name: "x", trigger: "BEFORE_CHECKIN", triggerParams: {}, templateId: null });
    assert.equal("isActive" in patch, false);
    assert.equal("active" in patch, false);
  }
});
