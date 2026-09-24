// Ф5: отбор правил по статусу и виду отказа, задержка, номер договора, тексты поставки, подписи правил
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "@prisma/client";
import { scheduledFor, statusRuleMatches } from "@/lib/status-rules";
import { formatContract } from "@/lib/contract";
import { renderTemplate } from "@/server/automations/render";
import { ruleWhen } from "@/lib/crm/automation-labels";
import { rejectRuleWarning } from "@/lib/settings-validate";
import { ruleFires } from "@/lib/autoconfirm-gate";
import { TEMPLATES, planRuleSync, type SeedRule } from "../../prisma/templates";

const ev = (over: Partial<Parameters<typeof statusRuleMatches>[1]> = {}) => ({ status: "REJECTED", source: "SITE", rejectKind: "NO_SPACE" as const, ...over });

test("отказ «мест нет»: срабатывает на NO_SPACE и не срабатывает на другой причине", () => {
  const p = { status: "REJECTED", rejectKind: "NO_SPACE" as const };
  assert.equal(statusRuleMatches(p, ev()), true);
  assert.equal(statusRuleMatches(p, ev({ rejectKind: "OTHER" })), false);
  assert.equal(statusRuleMatches(p, ev({ rejectKind: null })), false);
});

test("общий отказ: пустой вид отказа у брони читается как «другая причина»", () => {
  const p = { status: "REJECTED", rejectKind: "OTHER" as const };
  assert.equal(statusRuleMatches(p, ev({ rejectKind: null })), true);
  assert.equal(statusRuleMatches(p, ev({ rejectKind: "OTHER" })), true);
  assert.equal(statusRuleMatches(p, ev()), false);
});

test("правило без вида отказа срабатывает на любой отказ; источник и статус отсекают", () => {
  assert.equal(statusRuleMatches({ status: "REJECTED" }, ev()), true);
  assert.equal(statusRuleMatches({ status: "REJECTED" }, ev({ rejectKind: "OTHER" })), true);
  assert.equal(statusRuleMatches({ status: "NEW", source: "SITE" }, ev({ status: "NEW", source: "CALL", rejectKind: null })), false);
  assert.equal(statusRuleMatches({ status: "NEW" }, ev({ status: "NEW", source: "CALL", rejectKind: null })), true);
  assert.equal(statusRuleMatches({ status: "CHECKED_IN", rejectKind: "NO_SPACE" }, ev()), false);
});

test("задержка: 120 минут — через 2 часа; без параметра, ноль, минус и мусор — сразу", () => {
  const t = new Date("2026-09-24T10:00:00Z");
  assert.equal(scheduledFor({ delayMinutes: 120 }, t).toISOString(), "2026-09-24T12:00:00.000Z");
  for (const bad of [undefined, 0, -5, NaN, "120" as unknown as number]) assert.equal(scheduledFor({ delayMinutes: bad }, t).getTime(), t.getTime(), String(bad));
});

test("номер договора: 001, 042, 999, 1000; нет номера — null", () => {
  assert.equal(formatContract(1), "001");
  assert.equal(formatContract(42), "042");
  assert.equal(formatContract(999), "999");
  assert.equal(formatContract(1000), "1000");
  assert.equal(formatContract(null), null);
  assert.equal(formatContract(0), null);
});

const body = (code: string) => TEMPLATES.find((t) => t.code === code)!.body;
function booking(over: Partial<Booking> = {}): Booking {
  return {
    number: 128, kind: "PARKING", contactName: "Иван", contactPhone: "+79055250660",
    dateFrom: new Date("2026-09-17T00:00:00Z"), dateTo: new Date("2026-09-19T00:00:00Z"), timeFrom: "10:00", timeTo: "18:30",
    vehicleType: "CAR", plate: "А123ВС77", amount: 1050, paidAmount: 0, days: 3, transferNeeded: false, ...over,
  } as unknown as Booking;
}
const ctx = { booking: booking(), client: null };

test("«Автомобиль принят»: номер брони, договор 001 и время заезда", () => {
  const out = renderTemplate(body("checkin_accepted"), ctx, { contract: "001", checkedInAt: "17 сентября, 09:40" });
  assert.match(out, /^Иван, автомобиль принят на стоянку\./);
  assert.match(out, /\nБронь № 128\nДоговор № 001\nАвтомобиль: Легковая А123ВС77\nПринят: 17 сентября, 09:40\nПлановый выезд: 19 сентября, 18:30\n/);
});

test("«Автомобиль принят» без номера договора: строка «Договор №» выпадает, остальное на месте", () => {
  const out = renderTemplate(body("checkin_accepted"), ctx, { contract: null, checkedInAt: "17 сентября, 09:40" });
  assert.doesNotMatch(out, /Договор/);
  assert.match(out, /\nБронь № 128\nАвтомобиль: Легковая А123ВС77\nПринят: 17 сентября, 09:40\n/);
  assert.match(out, /Хорошего полёта!$/);
});

test("«Спасибо и отзыв»: со ссылкой — строка про отзыв есть, без ссылки — выпадает без висящего двоеточия", () => {
  const withLink = renderTemplate(body("checkout_thanks"), ctx, { review: "https://yandex.ru/maps/org/pitstop" });
  assert.match(withLink, /Будем благодарны за отзыв, это займёт минуту: https:\/\/yandex\.ru\/maps\/org\/pitstop\n/);
  const without = renderTemplate(body("checkout_thanks"), ctx, { review: "" });
  assert.doesNotMatch(without, /отзыв/);
  assert.match(without, /^Иван, спасибо, что доверили нам автомобиль\. Надеемся, поездка прошла хорошо\.\n\nЕсли что-то было не так, напишите нам прямо сюда — разберёмся\./);
});

test("«Мест нет»: номер заявки и даты; общий отказ — без слов про места", () => {
  const no = renderTemplate(body("reject_no_space"), ctx);
  assert.match(no, /^Здравствуйте, Иван!\nК сожалению, на выбранные даты свободных мест нет/);
  assert.match(no, /\nЗаявка № 128\nДаты: 17 сент → 19 сент\n/);
  const other = renderTemplate(body("reject_other"), ctx);
  assert.match(other, /К сожалению, ваша заявка № 128 отклонена\./);
  assert.doesNotMatch(other, /мест/);
});

test("четыре текста Ф5: без эмодзи, без разметки, без {{ после подстановки, телефон в одном виде", () => {
  for (const code of ["reject_no_space", "reject_other", "checkin_accepted", "checkout_thanks"]) {
    const src = body(code);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, code);
    assert.doesNotMatch(src, /[*_#`]/, code);
    const out = renderTemplate(src, ctx, { contract: "001", checkedInAt: "17 сентября, 09:40", review: "https://r" });
    assert.doesNotMatch(out, /\{\{|\}\}/, code);
    for (const phone of out.match(/\+7[\d ()-]+\d/g) ?? []) assert.equal(phone, "+7 905 525-06-60", code);
  }
});

test("«Когда срабатывает»: вид отказа и задержка человеческим языком", () => {
  assert.equal(ruleWhen("STATUS_CHANGED", { status: "REJECTED", rejectKind: "NO_SPACE", dedupGroup: "rejection" }), "Бронь переходит в «Отклонена», причина — нет мест");
  assert.equal(ruleWhen("STATUS_CHANGED", { status: "REJECTED", rejectKind: "OTHER" }), "Бронь переходит в «Отклонена», причина — другая");
  assert.equal(ruleWhen("STATUS_CHANGED", { status: "CHECKED_OUT", delayMinutes: 120 }), "Бронь переходит в «Выехал», сообщение через 2 часа");
  assert.equal(ruleWhen("STATUS_CHANGED", { status: "CHECKED_OUT", delayMinutes: 90 }), "Бронь переходит в «Выехал», сообщение через 90 мин");
});

test("предохранитель: правило «мест нет» закрывает проверку отказа, общий отказ — нет", () => {
  const rule = (rejectKind: string) => ({ triggerParams: { status: "REJECTED", rejectKind }, kind: null, templateActive: true });
  assert.equal(ruleFires(rule("NO_SPACE"), "REJECTED"), true);
  assert.equal(ruleFires(rule("OTHER"), "REJECTED"), false);
  const active = { trigger: "STATUS_CHANGED", isActive: true };
  assert.match(rejectRuleWarning({ ...active, triggerParams: { status: "REJECTED", rejectKind: "NO_SPACE" } }, false, true) ?? "", /Автоподтверждение включено/);
  assert.equal(rejectRuleWarning({ ...active, triggerParams: { status: "REJECTED", rejectKind: "OTHER" } }, false, true), null);
});

test("seed правил: «только парковка» ведётся всегда, как условия срабатывания", () => {
  const r: SeedRule = { code: "on_checked_in", name: "Заехал", trigger: "STATUS_CHANGED", triggerParams: { status: "CHECKED_IN" }, templateId: "t", kind: "PARKING", active: false };
  const row = { name: r.name, trigger: r.trigger, triggerParams: r.triggerParams, templateId: "t" };
  assert.deepEqual(planRuleSync(r, { ...row, kind: "PARKING" }), {});
  assert.deepEqual(planRuleSync(r, { ...row, kind: null }), { kind: "PARKING" });
  assert.deepEqual(planRuleSync({ ...r, kind: undefined }, { ...row, kind: "PARKING" }), { kind: null });
  assert.deepEqual(planRuleSync({ ...r, kind: undefined }, row), {});
});
