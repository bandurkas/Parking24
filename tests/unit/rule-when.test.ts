import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleIsTimed, ruleWhen } from "@/lib/crm/automation-labels";
import { isRejectRule, rejectRuleWarning } from "@/lib/settings-validate";

test("ruleWhen: все четыре триггера человеческим языком", () => {
  assert.equal(ruleWhen("STATUS_CHANGED", { status: "AWAITING_PAYMENT", dedupGroup: "confirmation" }), "Бронь переходит в «Ожидает оплаты»");
  assert.equal(ruleWhen("STATUS_CHANGED", { status: "NEW", source: "SITE" }), "Бронь переходит в «Новая заявка», только заявки из источника «Сайт»");
  assert.equal(ruleWhen("BEFORE_CHECKIN", { hoursBefore: 24 }), "За 24 часа до планового заезда");
  assert.equal(ruleWhen("BEFORE_CHECKOUT", { daysBefore: 2 }), "За 2 дня до планового выезда");
  assert.equal(ruleWhen("AFTER_CHECKOUT", { daysAfter: 7 }), "Через 7 дней после выезда");
});

test("ruleWhen: пустые и кривые параметры не роняют страницу", () => {
  assert.equal(ruleWhen("STATUS_CHANGED", {}), "Меняется статус брони");
  assert.equal(ruleWhen("BEFORE_CHECKIN", null), "Перед плановым заездом");
  assert.equal(ruleWhen("BEFORE_CHECKOUT", { daysBefore: "два" }), "Перед плановым выездом");
  assert.equal(ruleWhen("AFTER_CHECKOUT", []), "После выезда");
  assert.equal(ruleWhen("SOMETHING_NEW", {}), "По событию SOMETHING_NEW");
});

test("правила по времени отличаются от событийных", () => {
  assert.equal(ruleIsTimed("BEFORE_CHECKIN"), true);
  assert.equal(ruleIsTimed("AFTER_CHECKOUT"), true);
  assert.equal(ruleIsTimed("STATUS_CHANGED"), false);
});

test("правило отказа: предупреждение только при выключении и включённом автоподтверждении", () => {
  const reject = { trigger: "STATUS_CHANGED", triggerParams: { status: "REJECTED" }, isActive: true };
  assert.equal(isRejectRule(reject.trigger, reject.triggerParams), true);
  assert.match(rejectRuleWarning(reject, false, true) ?? "", /Автоподтверждение включено/);
  assert.equal(rejectRuleWarning(reject, false, false), null);
  assert.equal(rejectRuleWarning(reject, true, true), null);
  assert.equal(rejectRuleWarning({ ...reject, triggerParams: { status: "CONFIRMED" } }, false, true), null);
});
