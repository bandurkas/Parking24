import { test } from "node:test";
import assert from "node:assert/strict";
import { canRejectNow, gateBlockers, gateChecks, gateFacts, reserveText, ruleFires, type GateRule } from "@/lib/autoconfirm-gate";

const confirm: GateRule = { triggerParams: { status: "AWAITING_PAYMENT", dedupGroup: "confirmation" }, kind: null, templateActive: true };
const reject: GateRule = { triggerParams: { status: "REJECTED" }, kind: null, templateActive: true };
const ids = (f: Parameters<typeof gateChecks>[0]) => gateBlockers(gateChecks(f)).map((c) => c.id);

test("gateChecks: все три факта истинны — блокировок нет", () => {
  assert.deepEqual(ids({ confirmRule: true, rejectRule: true, senderEnabled: true }), []);
});

test("gateChecks: нет правила на «Отклонена» — блокировка с подсказкой", () => {
  const b = gateBlockers(gateChecks(gateFacts([confirm], true)));
  assert.deepEqual(b.map((c) => c.id), ["reject_message"]);
  assert.ok(b[0].hint.length > 10);
});

test("gateChecks: правило на «Отклонена» есть, но шаблон выключен — блокировка", () => {
  assert.deepEqual(ids(gateFacts([confirm, { ...reject, templateActive: false }], true)), ["reject_message"]);
});

test("gateChecks: отправщик выключен или ключа нет — блокировка", () => {
  assert.deepEqual(ids(gateFacts([confirm, reject], false)), ["sender"]);
  assert.deepEqual(ids(gateFacts([confirm, reject], null)), ["sender"]);
  assert.deepEqual(ids(gateFacts([confirm, reject], "true")), ["sender"]);
});

test("gateChecks: на свежей базе (правило подтверждения из seed, отправщика нет) не пройдены отказ и отправщик", () => {
  assert.deepEqual(ids(gateFacts([confirm], null)), ["reject_message", "sender"]);
});

test("canRejectNow: без правила отказа — нельзя; без правила подтверждения, но с отказом — можно", () => {
  assert.equal(canRejectNow({ confirmRule: true, rejectRule: false, senderEnabled: true }), false);
  assert.equal(canRejectNow({ confirmRule: false, rejectRule: true, senderEnabled: true }), true);
  assert.equal(canRejectNow({ confirmRule: true, rejectRule: true, senderEnabled: false }), false);
});

test("ruleFires: отказ «отклонено администратором» (rejectKind OTHER) не считается ответом на «мест нет»", () => {
  assert.equal(ruleFires({ ...reject, triggerParams: { status: "REJECTED", rejectKind: "OTHER" } }, "REJECTED"), false);
  assert.equal(ruleFires({ ...reject, triggerParams: { status: "REJECTED", rejectKind: "NO_SPACE" } }, "REJECTED"), true);
});

test("ruleFires: правило только для других источников или для комнат — не сработает на заявку с сайта", () => {
  assert.equal(ruleFires({ ...reject, triggerParams: { status: "REJECTED", source: "CALL" } }, "REJECTED"), false);
  assert.equal(ruleFires({ ...reject, triggerParams: { status: "REJECTED", source: "SITE" } }, "REJECTED"), true);
  assert.equal(ruleFires({ ...reject, kind: "ROOM" }, "REJECTED"), false);
  assert.equal(ruleFires({ ...reject, kind: "PARKING" }, "REJECTED"), true);
});

test("ruleFires: правило на другой статус не подходит", () => {
  assert.equal(ruleFires(confirm, "REJECTED"), false);
  assert.equal(ruleFires(reject, "AWAITING_PAYMENT"), false);
  assert.equal(ruleFires({ triggerParams: null, kind: null, templateActive: true }, "REJECTED"), false);
});

test("reserveText: нулевой резерв — отдельный текст, иначе число с правильным словом", () => {
  assert.equal(reserveText(395, 395), "Резерва нет: автоподтверждение работает до последнего места.");
  assert.match(reserveText(405, 395), /^Последние 10 мест остаются резервом/);
  assert.match(reserveText(405, 404), /^Последние 1 место /);
  assert.match(reserveText(405, 402), /^Последние 3 места /);
});
