import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REASON, UNKNOWN_CODE, UNKNOWN_RESULT, allowed, allowlistRestricts, backoffMs, channelForClient, decide, isExpired, leaseUntil, outboxStatusText,
  parseAllowlist, parseSenderConfig, planPass, resultPlan, senderEnabledFrom, SENDER_KEYS,
  type OutboxRow, type OutboxView, type Provider, type Recipient, type SenderConfig,
} from "@/server/automations/sender-core";
import { ErrorLog, mergeMode, runTickWith, type Locked, type ScanMode, type Step, type TickDeps, type TickResult } from "@/server/automations/tick-core";
import { HHMM, isHHMM, stayMinutes } from "@/lib/periods";
import { fmtDayTime, plannedMoment } from "@/server/lib/dates";

const NOW = new Date("2026-09-24T12:00:00Z");
const H = 3_600_000;

// Конфиг по умолчанию, но список разрешённых выключен — чтобы проверять остальные предохранители по одному
function cfg(over: Partial<SenderConfig> = {}): SenderConfig {
  return { ...parseSenderConfig([]), allowlistOnly: false, ...over };
}
function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return { id: "o1", templateCode: "on_awaiting_payment", channel: "WHATSAPP", renderedText: "Ваше место забронировано", scheduledAt: new Date(NOW.getTime() - 60_000), attempts: 0, clientId: "c1", ...over };
}
const to = (over: Partial<Recipient> = {}): Recipient => ({ phone: "+79990001122", doNotDisturb: false, channelKnown: true, ...over });
const ready: Provider = { kind: "ready", textLimit: (ch) => (ch === "TELEGRAM" ? 1024 : null) };

test("channelForClient: выбранный мессенджер берётся первым, known", () => {
  assert.deepEqual(channelForClient({ messenger: "TELEGRAM", channels: ["WHATSAPP"] }), { channel: "TELEGRAM", known: true });
});

test("channelForClient: мессенджер пуст — первый мессенджер из channels", () => {
  assert.deepEqual(channelForClient({ messenger: null, channels: ["PHONE", "MAX", "WHATSAPP"] }), { channel: "MAX", known: true });
});

test("channelForClient: только PHONE/SITE или «мессенджер» PHONE — канал по умолчанию, не выбран", () => {
  assert.deepEqual(channelForClient({ messenger: null, channels: ["PHONE", "SITE"] }), { channel: "WHATSAPP", known: false });
  assert.deepEqual(channelForClient({ messenger: "PHONE", channels: [] }), { channel: "WHATSAPP", known: false });
});

test("channelForClient: клиента нет — канал по умолчанию, не выбран", () => {
  assert.deepEqual(channelForClient(null), { channel: "WHATSAPP", known: false });
  assert.deepEqual(channelForClient(undefined, "TELEGRAM"), { channel: "TELEGRAM", known: false });
});

test("decide: возраст считается от scheduledAt; старше порога — EXPIRED, ровно на границе — отправляем", () => {
  const c = cfg({ maxAgeHours: 6 });
  assert.deepEqual(decide(row({ scheduledAt: new Date(NOW.getTime() - 6 * H - 1) }), to(), c, NOW, ready), { kind: "skip", status: "EXPIRED", reason: REASON.expired });
  assert.deepEqual(decide(row({ scheduledAt: new Date(NOW.getTime() - 6 * H) }), to(), c, NOW, ready), { kind: "send" });
  assert.equal(isExpired(new Date(NOW.getTime() - 7 * H), NOW, 6), true);
});

test("decide: отложенное «спасибо» через 2 часа после выезда не режется порогом — возраст от scheduledAt, не от createdAt", () => {
  // создано 3 часа назад, назначено на «сейчас − 1 мин»: возраст 1 минута
  assert.deepEqual(decide(row({ scheduledAt: new Date(NOW.getTime() - 60_000) }), to(), cfg({ maxAgeHours: 1 }), NOW, ready), { kind: "send" });
});

test("decide: пустой текст — FAILED «пустой текст»", () => {
  assert.deepEqual(decide(row({ renderedText: "  \n " }), to(), cfg(), NOW, ready), { kind: "skip", status: "FAILED", reason: REASON.emptyText });
});

test("decide: нет телефона (заявка без клиента) — SKIPPED «нет получателя», терминально", () => {
  assert.deepEqual(decide(row({ clientId: null }), to({ phone: null }), cfg(), NOW, ready), { kind: "skip", status: "SKIPPED", reason: REASON.noRecipient });
});

test("decide: «не беспокоить» режет только рекламу, служебное уходит (DECISIONS §2)", () => {
  assert.deepEqual(decide(row(), to({ doNotDisturb: true }), cfg(), NOW, ready), { kind: "send" });
  assert.deepEqual(decide(row({ templateCode: "after_checkout_7d" }), to({ doNotDisturb: true }), cfg(), NOW, ready), { kind: "skip", status: "SKIPPED", reason: REASON.dnd });
});

test("decide: канал записи не мессенджер (PHONE) — SKIPPED «нет мессенджера»", () => {
  assert.deepEqual(decide(row({ channel: "PHONE" }), to(), cfg(), NOW, ready), { kind: "skip", status: "SKIPPED", reason: REASON.noChannel });
});

test("decide: мессенджер не выбран — по настройке: слать (по умолчанию) или SKIPPED", () => {
  assert.deepEqual(decide(row(), to({ channelKnown: false }), cfg(), NOW, ready), { kind: "send" });
  assert.deepEqual(decide(row(), to({ channelKnown: false }), cfg({ sendWhenChannelUnknown: false }), NOW, ready), { kind: "skip", status: "SKIPPED", reason: REASON.channelUnknown });
});

test("decide: список разрешённых — номер не в списке ждёт (не терминально), запись «8 999…» с пробелами распознаётся", () => {
  const c = cfg({ allowlistOnly: true, allowlist: parseAllowlist("8 (999) 000-11-22\n+7 912 000 00 00") });
  assert.deepEqual(decide(row(), to({ phone: "+79995556677" }), c, NOW, ready), { kind: "wait", reason: REASON.notAllowed });
  assert.deepEqual(decide(row(), to({ phone: "+79990001122" }), c, NOW, ready), { kind: "send" });
  assert.deepEqual(c.allowlist, ["+79990001122", "+79120000000"]);
});

test("decide: пустой список при включённом режиме теста — не уходит никому (безопасно по умолчанию)", () => {
  const c = parseSenderConfig([]);
  assert.equal(c.allowlistOnly, true);
  assert.equal(decide(row(), to(), c, NOW, ready).kind, "wait");
});

test("decide: список выключен и OUTBOX_ALLOWLIST пуст — ограничения нет", () => {
  assert.equal(allowlistRestricts(cfg()), false);
  assert.deepEqual(decide(row(), to(), cfg(), NOW, ready), { kind: "send" });
});

test("OUTBOX_ALLOWLIST на сервере ограничивает даже при выключенном списке в карточке", () => {
  const c = parseSenderConfig([{ key: SENDER_KEYS.allowlistOnly, value: false }], { OUTBOX_ALLOWLIST: "+79990001122, 89120000000" });
  assert.equal(allowlistRestricts(c), true);
  assert.equal(allowed("+79990001122", c), true);
  assert.equal(allowed("+79120000000", c), true);
  assert.equal(allowed("+79995556677", c), false);
});

test("decide: провайдера нет — терминально SKIPPED_NO_PROVIDER; не отвечает — ждёт без траты попытки", () => {
  assert.deepEqual(decide(row(), to(), cfg(), NOW, { kind: "none" }), { kind: "skip", status: "SKIPPED_NO_PROVIDER", reason: REASON.noProvider });
  assert.deepEqual(decide(row(), to(), cfg(), NOW, { kind: "down", reason: "провайдер недоступен: qridle" }), { kind: "wait", reason: "провайдер недоступен: qridle" });
});

test("decide: номер не в списке проверяется раньше провайдера — в режиме теста видно, что тест работает", () => {
  const c = cfg({ allowlistOnly: true, allowlist: [] });
  assert.equal(decide(row(), to(), c, NOW, { kind: "none" }).kind, "wait");
});

test("decide: текст длиннее лимита канала — FAILED без вызова адаптера; в WhatsApp тот же текст уходит", () => {
  const long = "я".repeat(1200);
  assert.deepEqual(decide(row({ channel: "TELEGRAM", renderedText: long }), to(), cfg(), NOW, ready), { kind: "skip", status: "FAILED", reason: "сообщение длиннее лимита канала (1024)" });
  assert.deepEqual(decide(row({ channel: "WHATSAPP", renderedText: long }), to(), cfg(), NOW, ready), { kind: "send" });
});

const at = (min: number) => new Date(NOW.getTime() - min * 60_000);

test("planPass: два сообщения одному клиенту — в проход идёт раннее, второе ждёт", () => {
  const rows = [{ id: "b", clientId: "c1", scheduledAt: at(1) }, { id: "a", clientId: "c1", scheduledAt: at(5) }, { id: "x", clientId: "c2", scheduledAt: at(3) }];
  const r = planPass(rows, cfg(), 0);
  assert.deepEqual(r.send.map((s) => s.id), ["a", "x"]);
  assert.deepEqual(r.hold.map((s) => s.id), ["b"]);
});

test("planPass: больше maxPerTick — ровно maxPerTick, по порядку scheduledAt", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, clientId: `c${i}`, scheduledAt: at(10 - i) }));
  const r = planPass(rows, cfg({ maxPerTick: 3 }), 0);
  assert.deepEqual(r.send.map((s) => s.id), ["r0", "r1", "r2"]);
  assert.equal(r.hold.length, 2);
});

test("planPass: остаток часового потолка меньше maxPerTick — берётся остаток, исчерпан — никого", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, clientId: `c${i}`, scheduledAt: at(10 - i) }));
  assert.equal(planPass(rows, cfg({ maxPerTick: 10, maxPerHour: 30 }), 28).send.length, 2);
  assert.equal(planPass(rows, cfg({ maxPerTick: 10, maxPerHour: 30 }), 31).send.length, 0);
});

test("backoffMs: 1 → 1 мин, 2 → 5 мин, 3 → 25 мин (при 3 попытках третья пауза не применяется — чистая функция), потолок 30 мин", () => {
  assert.equal(backoffMs(1), 60_000);
  assert.equal(backoffMs(2), 300_000);
  assert.equal(backoffMs(3), 1_500_000);
  assert.equal(backoffMs(4), 1_800_000);
  assert.equal(backoffMs(0), 60_000);
});

test("resultPlan: ok → SENT с providerMessageId", () => {
  assert.deepEqual(resultPlan({ ok: true, providerMessageId: "m-1" }, 1, cfg(), NOW), { status: "SENT", providerMessageId: "m-1" });
});

test("resultPlan: retry и попытки остались → PENDING, пауза растёт с номером попытки, считается сбоем канала", () => {
  const p1 = resultPlan({ ok: false, retry: true, code: "NET", message: "сеть" }, 1, cfg(), NOW);
  assert.deepEqual(p1, { status: "PENDING", nextAttemptAt: new Date(NOW.getTime() + 60_000), lastError: "NET: сеть", countsAsFail: true });
  const p2 = resultPlan({ ok: false, retry: true, code: "NET", message: "сеть" }, 2, cfg(), NOW);
  assert.equal(p2.status === "PENDING" && p2.nextAttemptAt.getTime() - NOW.getTime(), 300_000);
});

test("resultPlan: retry, но попытки кончились → FAILED; retry:false → FAILED сразу и не в счётчик самоотключения", () => {
  assert.deepEqual(resultPlan({ ok: false, retry: true, code: "NET", message: "сеть" }, 3, cfg({ maxAttempts: 3 }), NOW), { status: "FAILED", lastError: "NET: сеть", countsAsFail: true });
  assert.deepEqual(resultPlan({ ok: false, retry: false, code: "BAD_CONTACT", message: "номера нет" }, 1, cfg(), NOW), { status: "FAILED", lastError: "BAD_CONTACT: номера нет", countsAsFail: false });
});

test("resultPlan: запрос ушёл, ответа нет (UNKNOWN: таймаут, исключение адаптера) — FAILED «статус неизвестен» без повтора, в счётчик сбоев", () => {
  const p = resultPlan({ ok: false, retry: false, code: UNKNOWN_CODE, message: "нет ответа за 10 с" }, 1, cfg(), NOW);
  assert.deepEqual(p, { status: "FAILED", lastError: `${UNKNOWN_RESULT}: нет ответа за 10 с`, countsAsFail: true });
  const q = resultPlan({ ok: false, retry: true, code: UNKNOWN_CODE, message: "обрыв" }, 1, cfg(), NOW);
  assert.equal(q.status, "FAILED", "даже с retry: true — повтор мог бы дать двойную отправку");
});

test("resultPlan: uncertain (Ф14: таймаут, обрыв, 5xx у Wazzup) — как UNKNOWN: FAILED «статус неизвестен», без повтора, в счётчик сбоев", () => {
  const p = resultPlan({ ok: false, retry: true, code: "HTTP_500", message: "сбой на стороне Wazzup", uncertain: true }, 1, cfg(), NOW);
  assert.deepEqual(p, { status: "FAILED", lastError: `${UNKNOWN_RESULT}: сбой на стороне Wazzup`, countsAsFail: true });
  const known = resultPlan({ ok: false, retry: true, code: "HTTP_429", message: "подождать", uncertain: false }, 1, cfg(), NOW);
  assert.equal(known.status, "PENDING", "исход известен (429 — не принято) — обычный повтор");
});

test("parseSenderConfig: аренда не короче прохода (бюджет + таймаут + минута)", () => {
  assert.equal(parseSenderConfig([{ key: SENDER_KEYS.leaseMinutes, value: 1 }]).leaseMinutes, 2);
  assert.equal(parseSenderConfig([{ key: SENDER_KEYS.leaseMinutes, value: 1 }, { key: SENDER_KEYS.budgetMs, value: 50_000 }, { key: SENDER_KEYS.timeoutMs, value: 30_000 }]).leaseMinutes, 3);
  assert.equal(parseSenderConfig([{ key: SENDER_KEYS.leaseMinutes, value: 10 }]).leaseMinutes, 10);
});

test("leaseUntil: аренда на leaseMinutes от начала прохода", () => {
  assert.equal(leaseUntil(NOW, { leaseMinutes: 5 }).getTime() - NOW.getTime(), 5 * 60_000);
});

test("senderEnabledFrom: true только при «вкл», живом провайдере и без ограничения списком", () => {
  const open = cfg();
  assert.equal(senderEnabledFrom("on", true, open), true);
  assert.equal(senderEnabledFrom("dry", true, open), false);
  assert.equal(senderEnabledFrom("off", true, open), false);
  assert.equal(senderEnabledFrom("on", false, open), false);
  assert.equal(senderEnabledFrom("on", true, cfg({ allowlistOnly: true, allowlist: ["+79990001122"] })), false);
  assert.equal(senderEnabledFrom("on", true, cfg({ envAllowlist: ["+79990001122"] })), false);
});

test("parseSenderConfig: значения по умолчанию, числа в пределах, мусор не ломает", () => {
  const d = parseSenderConfig([]);
  assert.equal(d.maxAgeHours, 6);
  assert.equal(d.maxPerTick, 10);
  assert.equal(d.maxPerHour, 30);
  assert.equal(d.maxAttempts, 3);
  assert.equal(d.stopAfterFails, 5);
  assert.deepEqual(d.allowlist, []);
  const c = parseSenderConfig([
    { key: SENDER_KEYS.maxAgeHours, value: "12" },
    { key: SENDER_KEYS.maxPerTick, value: 0 },
    { key: SENDER_KEYS.allowlist, value: ["+79990001122", "мусор", "+79990001122"] },
    { key: SENDER_KEYS.allowlistOnly, value: "false" },
    { key: SENDER_KEYS.stopAfterFails, value: 0 },
  ]);
  assert.equal(c.maxAgeHours, 12);
  assert.equal(c.maxPerTick, 1);
  assert.deepEqual(c.allowlist, ["+79990001122"]);
  assert.equal(c.allowlistOnly, true, "строка — не булево, остаётся безопасное значение");
  assert.equal(c.stopAfterFails, 0);
});

const view = (over: Partial<OutboxView> = {}): OutboxView => ({ status: "PENDING", scheduledAt: new Date("2026-09-24T11:05:00Z"), sentAt: null, nextAttemptAt: null, lockedUntil: null, sendingAt: null, attempts: 0, lastError: null, ...over });
const msk = (d: Date) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(d);

test("outboxStatusText: русские подписи всех статусов, время через переданный формат (по Москве)", () => {
  assert.equal(outboxStatusText(view(), NOW, msk), "запланировано 14:05");
  assert.equal(outboxStatusText(view({ status: "SENT", sentAt: new Date("2026-09-24T11:06:00Z") }), NOW, msk), "отправлено 14:06");
  assert.equal(outboxStatusText(view({ status: "FAILED", lastError: "BAD_CONTACT: номера нет", attempts: 1 }), NOW, msk), "не доставлено: BAD_CONTACT: номера нет, попыток 1");
  assert.equal(outboxStatusText(view({ status: "CANCELLED" }), NOW, msk), "отменено");
  assert.equal(outboxStatusText(view({ status: "SKIPPED_NO_PROVIDER" }), NOW, msk), "канал не подключён");
  assert.equal(outboxStatusText(view({ status: "EXPIRED" }), NOW, msk), "устарело, не отправлено");
  assert.equal(outboxStatusText(view({ status: "SKIPPED", lastError: REASON.noRecipient }), NOW, msk), "пропущено: нет получателя");
});

test("outboxStatusText: ждущая запись показывает причину, попытки и время повтора; в аренде — «отправляется»", () => {
  const next = new Date(NOW.getTime() + 5 * 60_000);
  assert.equal(outboxStatusText(view({ lastError: "NET: сеть", attempts: 1, nextAttemptAt: next }), NOW, msk), `запланировано 14:05 · не отправлено: NET: сеть, попыток 1, повтор ${msk(next)}`);
  assert.equal(outboxStatusText(view({ lastError: REASON.notAllowed, nextAttemptAt: next }), NOW, msk), `запланировано 14:05 · не отправлено: ${REASON.notAllowed}`);
  assert.equal(outboxStatusText(view({ lockedUntil: new Date(NOW.getTime() + 60_000) }), NOW, msk), "отправляется");
  // аренда истекла после передачи адаптеру, отправщик ещё не разобрал — не «запланировано»
  assert.equal(outboxStatusText(view({ lockedUntil: new Date(NOW.getTime() - 60_000), sendingAt: new Date(NOW.getTime() - 400_000), attempts: 1 }), NOW, msk), `${UNKNOWN_RESULT} — проверьте переписку с клиентом`);
});

test("outboxStatusText: «статус неизвестен» — не «не доставлено»: сообщение могло дойти", () => {
  assert.equal(outboxStatusText(view({ status: "FAILED", lastError: `${UNKNOWN_RESULT}: нет ответа за 10 с`, attempts: 1 }), NOW, msk), `${UNKNOWN_RESULT}: нет ответа за 10 с — проверьте переписку с клиентом`);
});

test("mergeMode: меняет только свой код, чужие режимы и мусор в карте не трогает", () => {
  assert.deepEqual(mergeMode({ overstay: "on", sender: "dry", junk: 5 }, "sender", "off"), { overstay: "on", sender: "off" });
  assert.deepEqual(mergeMode(null, "sender", "on"), { sender: "on" });
});

// Шаги тика (отправщик): вне транзакции скана, режим из той же карты
function tickDeps(modes: Record<string, ScanMode>, steps: Step[], paused = false) {
  const pulses: TickResult[] = [];
  const d: TickDeps<{ id: string }> = {
    scans: [],
    steps,
    loadConfig: async () => ({ paused, modes }),
    withLock: async <T,>(fn: (tx: { id: string }) => Promise<T>): Promise<Locked<T>> => ({ locked: true, value: await fn({ id: "tx" }) }),
    writePulse: async (_tx, r) => { pulses.push({ ...r }); },
    now: () => NOW,
    state: { running: false },
    log: new ErrorLog(() => {}),
  };
  return { d, pulses };
}

test("tick: шаг в режиме off не запускается, без ключа в карте — тоже off", async () => {
  let runs = 0;
  const step: Step = { code: "sender", run: async () => ++runs };
  await runTickWith("http", tickDeps({ sender: "off" }, [step]).d);
  await runTickWith("http", tickDeps({}, [step]).d);
  assert.equal(runs, 0);
});

test("tick: шаг «пробно» кладёт число в dry, «вкл» — в done, получает режим и время тика", async () => {
  const seen: string[] = [];
  const step: Step = { code: "sender", run: async (now, mode) => { seen.push(`${mode}@${now.toISOString()}`); return 3; } };
  const dry = await runTickWith("http", tickDeps({ sender: "dry" }, [step]).d);
  const on = await runTickWith("http", tickDeps({ sender: "on" }, [step]).d);
  assert.deepEqual(dry.dry, { sender: 3 });
  assert.deepEqual(on.done, { sender: 3 });
  assert.deepEqual(seen, [`dry@${NOW.toISOString()}`, `on@${NOW.toISOString()}`]);
});

test("tick: исключение в шаге — в failed, пульс всё равно пишется", async () => {
  const { d, pulses } = tickDeps({ sender: "on" }, [{ code: "sender", run: async () => { throw new Error("сеть"); } }]);
  const r = await runTickWith("http", d);
  assert.deepEqual(r.failed, ["sender"]);
  assert.equal(pulses.length, 1);
});

test("tick: на паузе шаги не запускаются", async () => {
  let runs = 0;
  const r = await runTickWith("http", tickDeps({ sender: "on" }, [{ code: "sender", run: async () => ++runs }], true).d);
  assert.equal(runs, 0);
  assert.equal(r.paused, true);
});

test("isHHMM: «25:00», «07:99», «7:00», «», «12:0» — нет; «00:00», «09:30», «23:59» — да", () => {
  for (const bad of ["25:00", "07:99", "7:00", "", "12:0", "24:00", " 12:00", null, undefined, 1200]) assert.equal(isHHMM(bad), false, String(bad));
  for (const ok of ["00:00", "09:30", "23:59"]) assert.equal(isHHMM(ok), true, ok);
  assert.equal(HHMM.test("19:45"), true);
});

test("кривое время в базе («25:00») читается как 12:00: сообщение, плановый момент, периоды комнат", () => {
  assert.equal(fmtDayTime("2026-10-01", "25:00"), "1 октября, 12:00");
  assert.equal(plannedMoment("2026-10-01", "25:00").toISOString(), "2026-10-01T09:00:00.000Z");
  assert.equal(stayMinutes("2026-10-01", "2026-10-02", "25:00", "12:00"), 1440);
});
