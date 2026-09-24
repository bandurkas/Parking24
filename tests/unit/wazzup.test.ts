import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { classify } from "@/server/messaging/wazzup/errors";
import { api } from "@/server/messaging/wazzup/client";
import { webhookSecretOk } from "@/server/lib/webhook-auth";
import { normalizePhone } from "@/lib/phone";
import {
  canWriteFirst, channelTransitions, chatIdToE164, dialogThreshold, messageBody, moscowMonth, parseSnapshot, parseWebhook,
  phoneDigits, pickChannel, siteChannelsFrom, statusPatch, TEXT_LIMIT, type WzChannel,
} from "@/server/messaging/wazzup/rules";
import { startWazzupMock, MOCK_CHANNEL_ID } from "../mocks/wazzup-mock.mjs";

const ch = (transport: string, state = "active", id = transport): WzChannel => ({ channelId: id, transport, state, plainId: null });

// ─── Раскладка ошибок ──────────────────────────────────────────────────────

test("BAD_CONTACT: не повторять, уведомление не от адаптера (MESSAGE_FAILED ставит отправщик)", () => {
  const r = classify({ kind: "http", status: 400, code: "BAD_CONTACT" });
  assert.equal(r.retry, false);
  assert.equal(r.notice, null);
  assert.equal(r.code, "BAD_CONTACT");
});

test("MESSAGES_NOT_TEXT_FIRST и спам: не повторять, уведомление про тариф", () => {
  const a = classify({ kind: "http", status: 400, code: "MESSAGES_NOT_TEXT_FIRST" });
  assert.equal(a.retry, false);
  assert.match(a.notice!.text, /Pro или Max/);
  const b = classify({ kind: "http", status: 400, code: "MESSAGES_IS_SPAM" });
  assert.equal(b.retry, false);
  assert.ok(b.notice);
});

test("CHANNEL_NOT_FOUND и CHANNEL_BLOCKED: повторить позже и сбросить кеш каналов", () => {
  for (const code of ["CHANNEL_NOT_FOUND", "CHANNEL_BLOCKED", "WRONG_TRANSPORT"]) {
    const r = classify({ kind: "http", status: 400, code });
    assert.equal(r.retry, true, code);
    assert.equal(r.dropChannelCache, true, code);
  }
});

test("429 — повтор, исход известен; 5xx, таймаут и сеть — повтор с пометкой «исход неизвестен»", () => {
  const rl = classify({ kind: "http", status: 429, code: null });
  assert.deepEqual([rl.retry, rl.uncertain, rl.code], [true, false, "HTTP_429"]);
  for (const f of [{ kind: "http", status: 500, code: "UNKNOWN_ERROR" }, { kind: "http", status: 503, code: null }, { kind: "timeout" }, { kind: "network" }] as const) {
    const r = classify(f);
    assert.equal(r.retry, true, JSON.stringify(f));
    assert.equal(r.uncertain, true, JSON.stringify(f));
    assert.equal(r.notice, null);
  }
});

test("незнакомый 4xx — не повторять, уведомление владельцу с кодом как есть", () => {
  const r = classify({ kind: "http", status: 403, code: "SOMETHING_NEW" });
  assert.equal(r.retry, false);
  assert.match(r.notice!.text, /SOMETHING_NEW/);
  const bare = classify({ kind: "http", status: 404, code: null });
  assert.equal(bare.code, "HTTP_404");
  assert.equal(bare.retry, false);
});

test("401 — ключ не принят: ждать (ключ меняют в .env), уведомить", () => {
  const r = classify({ kind: "http", status: 401, code: "UNAUTHORIZED" });
  assert.equal(r.retry, true);
  assert.match(r.notice!.text, /WAZZUP_API_KEY/);
});

test("message короткий и по-русски, без описания из тела ответа", () => {
  for (const code of ["BAD_CONTACT", "MESSAGES_IS_SPAM", "X"]) {
    const r = classify({ kind: "http", status: 400, code });
    assert.ok(r.message.length < 80 && !/description|Bearer/i.test(r.message), r.message);
  }
});

// ─── Каналы по транспорту ──────────────────────────────────────────────────

test("WhatsApp: канал whatsapp, при его отсутствии — wapi; активный важнее порядка", () => {
  const both = pickChannel([ch("wapi"), ch("whatsapp")], "WHATSAPP");
  assert.equal(both.ok && both.channel.transport, "whatsapp");
  const wabaOnly = pickChannel([ch("wapi"), ch("tgapi")], "WHATSAPP");
  assert.equal(wabaOnly.ok && wabaOnly.channel.transport, "wapi");
  const qrDown = pickChannel([ch("whatsapp", "qridle"), ch("wapi")], "WHATSAPP");
  assert.equal(qrDown.ok && qrDown.channel.transport, "wapi");
});

test("канал есть, но не работает — down (ждать); канала нет — absent; подмены на другой мессенджер нет", () => {
  assert.deepEqual(pickChannel([ch("whatsapp", "qridle")], "WHATSAPP"), { ok: false, reason: "down", state: "qridle" });
  assert.deepEqual(pickChannel([ch("whatsapp")], "TELEGRAM"), { ok: false, reason: "absent" });
  assert.deepEqual(pickChannel([ch("whatsapp")], "PHONE"), { ok: false, reason: "absent" });
});

test("Telegram-бот и MAX-бот никогда не пишут первыми", () => {
  assert.equal(canWriteFirst("telegram"), false);
  assert.equal(canWriteFirst("maxbot"), false);
  assert.deepEqual(pickChannel([ch("telegram")], "TELEGRAM"), { ok: false, reason: "absent" });
  assert.equal(canWriteFirst("tgapi"), true);
  const tg = pickChannel([ch("telegram"), ch("tgapi")], "TELEGRAM");
  assert.equal(tg.ok && tg.channel.transport, "tgapi");
});

// ─── Тело сообщения и телефоны ─────────────────────────────────────────────

test("тело для WhatsApp: chatId — цифры без плюса, crmMessageId = id записи Outbox", () => {
  const b = messageBody(ch("whatsapp", "active", "uuid-1"), phoneDigits("+79991234567")!, "текст", "outbox-1");
  assert.deepEqual(b, { channelId: "uuid-1", chatType: "whatsapp", chatId: "79991234567", text: "текст", crmMessageId: "outbox-1" });
});

test("тело для Telegram и MAX: передаётся phone, а не chatId", () => {
  const tg = messageBody(ch("tgapi"), "79991234567", "т", "o");
  assert.equal(tg.chatType, "telegram");
  assert.equal(tg.phone, "79991234567");
  assert.equal(tg.chatId, undefined);
  const max = messageBody(ch("max"), "79991234567", "т", "o");
  assert.equal(max.chatType, "max");
  assert.equal(max.phone, "79991234567");
});

test("телефоны: E.164 ↔ цифры Wazzup; мусор не проходит", () => {
  assert.equal(phoneDigits("+7 (999) 123-45-67"), "79991234567");
  assert.equal(phoneDigits("+6281219010408"), "6281219010408");
  assert.equal(phoneDigits("12"), null);
  assert.equal(chatIdToE164("79991234567"), "+79991234567");
  assert.equal(chatIdToE164("+62 812 1901 0408"), "+6281219010408");
  assert.equal(chatIdToE164(null), null);
  assert.equal(chatIdToE164("abc"), null);
  // номер из chatId совпадает с тем, как нормализован телефон клиента в CRM
  assert.equal(chatIdToE164("79055250660"), normalizePhone("8 (905) 525-06-60"));
});

test("лимит длины по мессенджеру", () => {
  assert.equal(TEXT_LIMIT.WHATSAPP, 10_000);
  assert.equal(TEXT_LIMIT.TELEGRAM, 4_096);
  assert.equal(TEXT_LIMIT.MAX, 4_096);
});

// ─── Вебхук ────────────────────────────────────────────────────────────────

test("parseWebhook: проверочный {test:true}", () => {
  assert.deepEqual(parseWebhook({ test: true }), [{ kind: "test" }]);
});

test("parseWebhook: пакет из сообщений, статусов и смены каналов", () => {
  const ev = parseWebhook({
    messages: [
      { messageId: "m1", channelId: "c1", chatType: "whatsapp", chatId: "79991234567", dateTime: "2026-09-24T10:00:00.000Z", type: "text", isEcho: false, text: "привет", contact: { name: "Иван", phone: "79991234567" } },
      { messageId: "m2", chatType: "whatsapp", chatId: "79991234567", type: "image", isEcho: true, contentUri: "https://x/y.jpg", authorName: "Анна" },
    ],
    statuses: [{ messageId: "m0", status: "delivered", timestamp: "2026-09-24T10:00:01.000Z" }, { messageId: "m9", status: "error", error: { error: "BAD_CONTACT", description: "x" } }],
    channelsUpdates: [{ channelId: "c1", state: "qr", timestamp: 1_758_000_000_000 }],
  });
  assert.equal(ev.length, 5);
  const [m1, m2, s1, s2, c1] = ev;
  assert.ok(m1.kind === "message" && m1.text === "привет" && !m1.isEcho && m1.contactName === "Иван" && m1.at?.toISOString() === "2026-09-24T10:00:00.000Z");
  assert.ok(m2.kind === "message" && m2.isEcho && m2.authorName === "Анна" && m2.contentUri === "https://x/y.jpg");
  assert.ok(s1.kind === "status" && s1.status === "delivered");
  assert.ok(s2.kind === "status" && s2.status === "error" && s2.errorCode === "BAD_CONTACT");
  assert.deepEqual(c1, { kind: "channel", channelId: "c1", state: "qridle" });
});

test("parseWebhook: время без пояса читается как UTC, миллисекунды — как число", () => {
  const [m] = parseWebhook({ messages: [{ messageId: "m", chatType: "whatsapp", dateTime: "2026-09-24T10:00:00.123" }] });
  assert.equal(m.kind === "message" && m.at?.toISOString(), "2026-09-24T10:00:00.123Z");
  const [s] = parseWebhook({ statuses: [{ messageId: "m", status: "read", timestamp: "1790000000000" }] });
  assert.equal(s.kind === "status" && s.at?.getTime(), 1_790_000_000_000);
});

test("parseWebhook: мусор не бросает и даёт пустой список, битые элементы пропускаются", () => {
  for (const body of [null, undefined, "строка", 42, [], { messages: "x" }, { statuses: [null, 1, { status: "read" }] }, { channelsUpdates: [{}] }]) {
    assert.deepEqual(parseWebhook(body), [], JSON.stringify(body));
  }
  assert.equal(parseWebhook({ statuses: [{ messageId: "m", status: "edited" }] }).length, 0);
});

// ─── Статусы только вперёд ─────────────────────────────────────────────────

const none = { deliveredAt: null, readAt: null, failCode: null };
const t1 = new Date("2026-09-24T10:00:00Z");
const t2 = new Date("2026-09-24T10:05:00Z");

test("статусы: delivered → read; delivered после read не затирает read", () => {
  assert.deepEqual(statusPatch(none, { status: "delivered", at: t1, errorCode: null }), { deliveredAt: t1 });
  const delivered = { ...none, deliveredAt: t1 };
  assert.deepEqual(statusPatch(delivered, { status: "read", at: t2, errorCode: null }), { readAt: t2 });
  const read = { ...delivered, readAt: t2 };
  assert.equal(statusPatch(read, { status: "delivered", at: t2, errorCode: null }), null);
  assert.equal(statusPatch(delivered, { status: "delivered", at: t2, errorCode: null }), null);
});

test("статусы: read без delivered ставит обе отметки; sent ничего не меняет", () => {
  assert.deepEqual(statusPatch(none, { status: "read", at: t1, errorCode: null }), { readAt: t1, deliveredAt: t1 });
  assert.equal(statusPatch(none, { status: "sent", at: t1, errorCode: null }), null);
});

test("error после отправки пишет failCode, после доставки — игнорируется", () => {
  assert.deepEqual(statusPatch(none, { status: "error", at: t1, errorCode: "BAD_CONTACT" }), { failCode: "BAD_CONTACT" });
  assert.deepEqual(statusPatch(none, { status: "error", at: t1, errorCode: null }), { failCode: "ERROR" });
  assert.equal(statusPatch({ ...none, deliveredAt: t1 }, { status: "error", at: t2, errorCode: "X" }), null);
  assert.equal(statusPatch({ ...none, failCode: "X" }, { status: "error", at: t2, errorCode: "Y" }), null);
});

// ─── Состояние каналов ─────────────────────────────────────────────────────

test("active → qridle: одно уведомление про QR; повтор того же состояния молчит", () => {
  const n = channelTransitions([ch("whatsapp", "active", "c1")], [ch("whatsapp", "qridle", "c1")]);
  assert.equal(n.length, 1);
  assert.match(n[0].text, /QR-код/);
  assert.equal(n[0].key, "channel-down:whatsapp:qridle");
  assert.deepEqual(channelTransitions([ch("whatsapp", "qridle", "c1")], [ch("whatsapp", "qridle", "c1")]), []);
});

test("возврат в active — «снова работает»; запуск (init) и первый рабочий канал молчат", () => {
  const back = channelTransitions([ch("whatsapp", "qridle", "c1")], [ch("whatsapp", "active", "c1")]);
  assert.equal(back.length, 1);
  assert.match(back[0].text, /снова работает/);
  assert.deepEqual(channelTransitions(null, [ch("whatsapp", "active", "c1")]), []);
  assert.deepEqual(channelTransitions([ch("whatsapp", "active", "c1")], [ch("whatsapp", "init", "c1")]), []);
  assert.deepEqual(channelTransitions([ch("whatsapp", "init", "c1")], [ch("whatsapp", "active", "c1")]), []);
});

test("впервые увиденный неработающий канал и неоплата — уведомление со своим текстом", () => {
  assert.match(channelTransitions(null, [ch("whatsapp", "notEnoughMoney", "c1")])[0].text, /не оплачен/);
  assert.match(channelTransitions(null, [ch("tgapi", "blocked", "c2")])[0].text, /Telegram заблокирован/);
});

test("сайт: без провайдера и без снимка список не сужается; купленный канал в аварии остаётся", () => {
  const snap = (list: WzChannel[]) => ({ at: "2026-09-24T10:00:00Z", list });
  assert.equal(siteChannelsFrom("none", snap([ch("whatsapp")])), null);
  assert.equal(siteChannelsFrom("wazzup", null), null);
  assert.equal(siteChannelsFrom("wazzup", snap([])), null);
  assert.deepEqual(siteChannelsFrom("wazzup", snap([ch("whatsapp", "qridle")])), ["WHATSAPP"]);
  assert.deepEqual(siteChannelsFrom("wazzup", snap([ch("max"), ch("wapi")])), ["WHATSAPP", "MAX"]);
  assert.equal(siteChannelsFrom("wazzup", snap([ch("telegram")])), null);
  assert.equal(siteChannelsFrom("wazzup", snap([ch("whatsapp", "disabled")])), null);
});

test("снимок каналов из Setting: битые записи отбрасываются", () => {
  assert.equal(parseSnapshot(null), null);
  assert.deepEqual(parseSnapshot({ at: "x", list: [{ channelId: "c", transport: "whatsapp", state: "active" }, { transport: "x" }] })?.list, [
    { channelId: "c", transport: "whatsapp", state: "active", plainId: null },
  ]);
});

// ─── Диалоги месяца ────────────────────────────────────────────────────────

test("месяц по Москве: 30.09 21:30 UTC — уже октябрь", () => {
  const m = moscowMonth(new Date("2026-09-30T21:30:00Z"));
  assert.equal(m.key, "2026-10");
  assert.equal(m.from.toISOString(), "2026-09-30T21:00:00.000Z");
  assert.equal(m.to.toISOString(), "2026-10-31T21:00:00.000Z");
  assert.equal(moscowMonth(new Date("2026-12-15T12:00:00Z")).to.toISOString(), "2026-12-31T21:00:00.000Z");
});

test("пороги диалогов 80 и 100 % — по одному разу за месяц", () => {
  assert.equal(dialogThreshold(399, 500, null, "2026-09"), null);
  assert.equal(dialogThreshold(400, 500, null, "2026-09"), 80);
  assert.equal(dialogThreshold(450, 500, { month: "2026-09", pct: 80 }, "2026-09"), null);
  assert.equal(dialogThreshold(500, 500, { month: "2026-09", pct: 80 }, "2026-09"), 100);
  assert.equal(dialogThreshold(520, 500, { month: "2026-09", pct: 100 }, "2026-09"), null);
  assert.equal(dialogThreshold(420, 500, { month: "2026-08", pct: 100 }, "2026-09"), 80);
  assert.equal(dialogThreshold(10, 0, null, "2026-09"), null);
});

// ─── Секрет вебхука ────────────────────────────────────────────────────────

test("секрет вебхука: верный — да, неверный — нет, короче 32 символов — нет при любом входе", () => {
  const secret = "s".repeat(32);
  assert.equal(webhookSecretOk(secret, secret), true);
  assert.equal(webhookSecretOk("s".repeat(31) + "x", secret), false);
  assert.equal(webhookSecretOk(null, secret), false);
  const short = "s".repeat(31);
  assert.equal(webhookSecretOk(short, short), false);
  assert.equal(webhookSecretOk("", undefined), false);
});

// ─── HTTP-клиент против заглушки ───────────────────────────────────────────

test("клиент: ключ в заголовке, 201 с messageId, повтор crmMessageId и коды ошибок", async () => {
  const mock = await startWazzupMock({ key: "k-unit" });
  try {
    const cfg = { base: mock.url, key: "k-unit" };
    const body = { channelId: MOCK_CHANNEL_ID, chatType: "whatsapp", chatId: "79991234567", text: "т", crmMessageId: "o-1" };
    const ok = await api<{ messageId: string }>(cfg, "POST", "/message", body, { timeoutMs: 2_000 });
    assert.ok(ok.ok && ok.status === 201 && typeof ok.json?.messageId === "string");
    assert.equal(mock.state.requests.at(-1)!.auth, "Bearer k-unit");
    const again = await api(cfg, "POST", "/message", body, { timeoutMs: 2_000 });
    assert.deepEqual(again, { ok: false, kind: "http", status: 400, code: "REPEATED_CRM_MESSAGE_ID" });
    mock.state.failNext.push({ status: 500, body: "не json" });
    assert.deepEqual(await api(cfg, "POST", "/message", { ...body, crmMessageId: "o-2" }, { timeoutMs: 2_000 }), { ok: false, kind: "http", status: 500, code: null });
    const bad = await api({ ...cfg, key: "wrong-key" }, "GET", "/channels", undefined, { timeoutMs: 2_000 });
    assert.deepEqual(bad, { ok: false, kind: "http", status: 401, code: "UNAUTHORIZED" });
  } finally {
    await mock.close();
  }
});

test("клиент: таймаут и обрыв связи различаются", async () => {
  const mock = await startWazzupMock({ key: "k", delayMs: 500 });
  try {
    assert.deepEqual(await api({ base: mock.url, key: "k" }, "GET", "/channels", undefined, { timeoutMs: 100 }), { ok: false, kind: "timeout" });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 50);
    assert.deepEqual(await api({ base: mock.url, key: "k" }, "GET", "/channels", undefined, { timeoutMs: 5_000, signal: ctl.signal }), { ok: false, kind: "timeout" });
  } finally {
    await mock.close();
  }
  // закрытый порт: сеть недоступна
  const dead = createServer();
  await new Promise<void>((r) => dead.listen(0, () => r()));
  const port = (dead.address() as { port: number }).port;
  await new Promise<void>((r) => dead.close(() => r()));
  assert.deepEqual(await api({ base: `http://localhost:${port}/v3`, key: "k" }, "GET", "/channels", undefined, { timeoutMs: 2_000 }), { ok: false, kind: "network" });
});
