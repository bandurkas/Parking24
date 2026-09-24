// Ф14 (docs/phases/PHASE_14_WAZZUP.md): адаптер Wazzup за отправщиком Ф4ш0, вебхук, окно чатов — ТОЛЬКО против локальной заглушки.
// Настоящий Wazzup не трогается: заглушка поднимается здесь же, dev-сервер должен смотреть на неё.
// Запуск (dev-сервер со своими переменными, порт заглушки = порт сайта + 800, RUN_SCHEDULER=0):
//   RUN_SCHEDULER=0 WAZZUP_API_BASE=http://localhost:3914/v3 WAZZUP_API_KEY=e2e-wazzup-key-local-only \
//   WAZZUP_WEBHOOK_SECRET=e2e-local-webhook-secret-000000000000000000 WAZZUP_WEBHOOK_BASE=http://localhost:3114 \
//   WAZZUP_TEST_HOOKS=1 npx next dev -p 3114
//   node tests/e2e/f14-wazzup.mjs --base http://localhost:3114 --login owner --password owner12345
// Отправка — настоящим путём: запись Outbox → тик отправщика (секрет крона, как scheduler.mjs) → адаптер → заглушка.
// Провайдер выбирается в карточке «Отправка сообщений» (выключатель один), режим «вкл» и список разрешённых — через базу
// из .env. Чужие неотправленные записи на время теста паркуются, настройки возвращаются в finally (как f4-sender.mjs).
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { BASE, LOGIN, PASSWORD, arg, check, equal, finish, loadPlaywright, cronSecret, testPhone, isoPlus } from "./lib.mjs";
import { startWazzupMock, MOCK_CHANNEL_ID } from "../mocks/wazzup-mock.mjs";

const KEY = process.env.E2E_WAZZUP_KEY ?? "e2e-wazzup-key-local-only";
const SECRET = process.env.E2E_WAZZUP_SECRET ?? "e2e-local-webhook-secret-000000000000000000";
const MOCK_PORT = Number(arg("mock-port", process.env.WAZZUP_MOCK_PORT ?? String(Number(new URL(BASE).port || 3100) + 800)));
const ADMIN_PASSWORD = arg("admin-password", process.env.E2E_ADMIN_PASSWORD ?? "admin12345");
const GUARD_PASSWORD = process.env.E2E_GUARD_PASSWORD ?? "guard12345";

const nb = (s) => (s ?? "").replace(/[  ]/g, " ");
const line = (s) => s.replace(/\s+/g, " ").slice(0, 200);
const count = (text, needle) => text.split(needle).length - 1;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

const webhook = (body, secret = SECRET) => fetch(`${BASE}/api/webhooks/wazzup/${secret}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const siteChannels = async () => (await (await fetch(`${BASE}/api/public/channels`, { cache: "no-store" })).json()).channels;

// На stage (production-сборка) ключ может быть живым: только проверки без Wazzup
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.log(`\nФ14 Wazzup на ${BASE}: без заглушки — только вебхук, список мессенджеров сайта и доступ`);
  equal("вебхук с чужим секретом — 404", (await webhook({ test: true }, "x".repeat(40))).status, 404);
  equal("GET на адрес вебхука — 404", (await fetch(`${BASE}/api/webhooks/wazzup/${"y".repeat(40)}`)).status, 404);
  const pub = await fetch(`${BASE}/api/public/channels`);
  const body = pub.ok ? await pub.json() : null;
  check("список мессенджеров сайта отвечает", !!body && "channels" in body, `статус ${pub.status}`);
  equal("без входа: счётчик неотвеченных — 401", (await fetch(`${BASE}/api/admin/chats/unanswered`)).status, 401);
  finish("Ф14 Wazzup (stage)");
}

const db = new PrismaClient();
const secret = cronSecret();
const KEYS = ["scheduler.scans", "messaging.provider", "messaging.fakeMode", "messaging.senderEnabled",
  "sender.maxAgeHours", "sender.allowlistOnly", "sender.allowlist", "sender.sendWhenChannelUnknown", "sender.maxPerTick", "sender.maxPerHour",
  "sender.maxPerClient", "sender.maxAttempts", "sender.leaseMinutes", "sender.timeoutMs", "sender.budgetMs", "sender.stopAfterFails",
  "sender.failStreak", "sender.dryPreview", "wazzup.chats"];
const put = (key, value) => db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
const setting = async (key) => (await db.setting.findUnique({ where: { key } }))?.value;
const row = (id) => db.outbox.findUnique({ where: { id } });
const failedNotices = (bookingId) => db.adminNotice.count({ where: { kind: "MESSAGE_FAILED", bookingId } });

async function tick() {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${BASE}/api/cron/automations`, { method: "POST", headers: { "X-Cron-Secret": secret } });
    if (r.status !== 200) throw new Error(`тик ответил ${r.status} (секрет?)`);
    const j = await r.json();
    if (!j.busy) return j;
    await wait(1000);
  }
  throw new Error("тик всё время занят");
}

const mock = await startWazzupMock({ port: MOCK_PORT, key: KEY }).catch((e) => {
  console.error(`Заглушка Wazzup не поднялась на порту ${MOCK_PORT}: ${e.message}`);
  process.exit(2);
});
// Сколько раз адаптер отправил запись в Wazzup (запросы, не только принятые)
const posts = (outboxId) => mock.state.requests.filter((r) => r.method === "POST" && r.path === "/v3/message" && r.body?.crmMessageId === outboxId).length;
const accepted = (outboxId) => mock.state.messages.filter((m) => m.crmMessageId === outboxId);

// Разрешённые номера отправщика: только номера заявок этого сценария
const allow = [];

// Заявка с сайта: сразу ставит сообщение в Outbox. Свой адрес на каждую — не упираемся в лимит 8 заявок за 10 минут.
// Заодно проверка, что сервер и база из .env — одно и то же: иначе тест трогал бы чужую базу
async function lead(label) {
  const phone = testPhone();
  const e164 = `+7${phone}`;
  const from = isoPlus(40 + Math.floor(Math.random() * 200));
  const to = new Date(new Date(from).getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const r = await fetch(`${BASE}/api/public/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip() },
    body: JSON.stringify({ dateFrom: from, dateTo: to, vehicleType: "car", name: `E2E Wazzup ${label}`, phone, dial: "+7", channels: ["WHATSAPP"], primary: "WHATSAPP", ts: Date.now() - 10_000 }),
  });
  const j = await r.json();
  if (!j.number) throw new Error(`заявка ${label} не создана: ${JSON.stringify(j)}`);
  const b = await db.booking.findFirst({ where: { number: j.number, contactPhone: e164 } });
  if (!b) throw new Error(`заявки №${j.number} с ${e164} нет в базе из .env — сервер смотрит в другую базу, тест остановлен`);
  const due = await db.outbox.findMany({ where: { bookingId: b.id, status: "PENDING", scheduledAt: { lte: new Date() } } });
  if (due.length !== 1) throw new Error(`у заявки №${j.number} к отправке ${due.length} сообщений, ожидалось 1`);
  allow.push(e164);
  await put("sender.allowlist", allow);
  return { phone, e164, digits: `7${phone}`, number: j.number, id: b.id, clientId: b.clientId, out: due[0] };
}

// Ещё одна запись в очередь той же брони (тот же клиент, номер уже разрешён)
const extra = (b, tag) =>
  db.outbox.create({ data: { bookingId: b.id, clientId: b.clientId, channel: "WHATSAPP", templateCode: "e2e_probe", renderedText: `E2E ${tag}: проверка Wazzup`, dedupKey: `e2e-f14:${tag}:${b.id}`, scheduledAt: new Date(Date.now() - 60_000) } });

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });

async function login(ctx, user, pass) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [ошибка страницы] ${e.message}`));
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', user);
  await page.fill('input[name="password"]', pass);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }), page.click('button[type="submit"]')]);
  return page;
}

// Кнопка сработает только после гидратации: ждём обработчиков React у самого элемента
async function hydrated(locator) {
  await locator.waitFor({ timeout: 15000 });
  for (let i = 0; i < 40; i++) {
    if (await locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))).catch(() => false)) return;
    await wait(250);
  }
}

async function openSettings(page) {
  await page.goto(`${BASE}/admin/settings?t=${Date.now()}`, { waitUntil: "load" });
  return page.getByTestId("messaging-card");
}

// Провайдер — только в карточке «Отправка сообщений» (Ф4ш0): выключатель один
async function selectProvider(page, code) {
  await page.goto(`${BASE}/admin/settings?t=${Date.now()}`, { waitUntil: "load" });
  const card = page.getByRole("region", { name: "Отправка сообщений" });
  const select = card.getByLabel("Провайдер");
  await hydrated(select);
  await select.selectOption(code);
  return card.getByRole("status").filter({ hasText: "Провайдер сохранён" }).waitFor({ timeout: 15000 }).then(() => true, () => false);
}

async function setChats(page, on) {
  const card = await openSettings(page);
  const btn = card.getByTestId("chats-toggle");
  await btn.waitFor({ timeout: 15000 });
  if ((await btn.textContent()).includes(on ? "Выключить" : "Включить")) return true;
  await hydrated(btn);
  await btn.click();
  await btn.filter({ hasText: on ? "Выключить окно чатов" : "Включить окно чатов" }).waitFor({ timeout: 20000 }).catch(() => {});
  return (await btn.textContent()).includes(on ? "Выключить" : "Включить");
}

async function bookingPage(page, id) {
  await page.goto(`${BASE}/admin/bookings/${id}?t=${Date.now()}`, { waitUntil: "load" });
  return page;
}

// Подпись очереди у записи в карточке брони (OutboxList)
async function outboxCaption(page, bookingId, text) {
  await bookingPage(page, bookingId);
  return nb(await page.getByTestId("outbox-item").filter({ hasText: text }).getByTestId("outbox-status").innerText().catch(() => ""));
}

async function readAllNotices(page) {
  await page.goto(`${BASE}/admin/settings?t=${Date.now()}`, { waitUntil: "load" });
  const bell = page.getByRole("button", { name: /^Уведомлени/ });
  await hydrated(bell);
  await bell.click();
  const read = page.getByRole("button", { name: "Прочитано" });
  if (await read.isVisible({ timeout: 2000 }).catch(() => false)) {
    await read.click();
    await read.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  }
}

async function bellText(page) {
  await page.goto(`${BASE}/admin/settings?t=${Date.now()}`, { waitUntil: "load" });
  const bell = page.getByRole("button", { name: /^Уведомлени/ });
  await hydrated(bell);
  await bell.click();
  const list = page.locator("ul.max-h-96");
  await list.waitFor({ timeout: 5000 }).catch(() => {});
  const text = nb(await list.innerText().catch(() => ""));
  await page.keyboard.press("Escape").catch(() => {});
  return text;
}

const saved = await db.setting.findMany({ where: { key: { in: KEYS } } });
let parked = [];
let owner;
try {
  console.log(`\nФ14 Wazzup (заглушка ${mock.url}): ${BASE}`);
  if (!secret) throw new Error("нет секрета крона: --secret, E2E_CRON_SECRET или CRON_SECRET в .env");

  // 1. Вебхук: секрет в адресе
  equal("вебхук с чужим секретом — 404", (await webhook({ test: true }, "x".repeat(40))).status, 404);
  equal("вебхук с коротким секретом — 404", (await webhook({ test: true }, "short")).status, 404);
  equal("GET на верный адрес — 404", (await fetch(`${BASE}/api/webhooks/wazzup/${SECRET}`)).status, 404);
  equal("проверочный {test:true} — 200", (await webhook({ test: true })).status, 200);
  equal("мусорное тело — всё равно 200", (await webhook("не json")).status, 200);

  // 2. Первая заявка (сверка базы), чужие неотправленные — в будущее, настройки отправщика — по умолчанию
  const A = await lead("A");
  parked = await db.outbox.findMany({ where: { status: "PENDING", NOT: { bookingId: A.id } }, select: { id: true, scheduledAt: true } });
  if (parked.length) await db.outbox.updateMany({ where: { id: { in: parked.map((p) => p.id) } }, data: { scheduledAt: new Date(Date.now() + 3650 * 86_400_000) } });
  await db.setting.deleteMany({ where: { key: { in: KEYS.filter((k) => k !== "scheduler.scans") } } });
  const scans = (await setting("scheduler.scans")) ?? {};
  await put("scheduler.scans", { ...(typeof scans === "object" ? Object.fromEntries(Object.entries(scans).filter(([k]) => k !== "sender")) : {}), sender: "on" });
  await put("sender.allowlist", allow); // «только из списка» — по умолчанию включено
  await put("sender.maxPerHour", 1000); // повторные прогоны за час не упираются в потолок

  // 3. Карточка «Сообщения»: второго выключателя нет, провайдер не выбран; «Проверить связь» — и проверка, что сервер смотрит в заглушку
  const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  owner = await login(octx, LOGIN, PASSWORD);
  await readAllNotices(owner); // колокольчик с чистого листа: иначе прошлые непрочитанные глушат новые уведомления
  let card = await openSettings(owner);
  const stateText = nb(await card.getByTestId("provider-state").innerText());
  check("карточка «Сообщения»: ключ Wazzup на сервере есть", !/нет ключа/.test(stateText), stateText);
  check("карточка «Сообщения»: провайдер не выбран — отсылает к «Отправка сообщений»", /не выбран.*«Отправка сообщений»/.test(stateText), stateText);
  equal("в карточке «Сообщения» нет своего выключателя отправки", await card.getByRole("button", { name: /отправку/i }).count(), 0);
  equal("сайт при невыбранном провайдере не сужает список", await siteChannels(), null);
  const checkBtn = card.getByRole("button", { name: "Проверить связь" });
  await hydrated(checkBtn);
  await checkBtn.click();
  await card.getByTestId("wz-result").waitFor({ timeout: 20000 }).catch(() => {});
  if (!mock.state.requests.some((r) => r.path === "/v3/channels" && r.auth === `Bearer ${KEY}`)) {
    check("dev-сервер запущен с WAZZUP_API_BASE на эту заглушку и её ключом", false, "заглушка не получила GET /v3/channels — см. шапку файла");
    throw new Error("окружение dev-сервера не для Ф14");
  }
  check("«Проверить связь» — связь есть, WhatsApp работает", /Связь есть, работают: WhatsApp/.test(nb(await card.getByTestId("wz-result").textContent())));
  card = await openSettings(owner);
  check("строка канала WhatsApp «работает» в карточке", /WhatsApp[\s\S]*работает/.test(nb(await card.getByTestId("wz-channel").first().innerText())));

  // 4. Один выключатель: провайдер «Wazzup» в карточке «Отправка сообщений»
  check("владелец выбирает провайдера «Wazzup» в «Отправка сообщений»", await selectProvider(owner, "wazzup"));
  equal("выбор записан одной настройкой messaging.provider", await setting("messaging.provider"), "wazzup");
  card = await openSettings(owner);
  check("карточка «Сообщения» видит выбор", /Wazzup выбран в карточке «Отправка сообщений»/.test(nb(await card.getByTestId("provider-state").innerText())));
  equal("сайт предлагает только купленный WhatsApp", JSON.stringify(await siteChannels()), JSON.stringify(["WHATSAPP"]));

  const setupBtn = card.getByRole("button", { name: "Подключить вебхук и пользователей" });
  await hydrated(setupBtn);
  await setupBtn.click();
  await card.getByTestId("wz-result").waitFor({ timeout: 45000 });
  check("вебхук зарегистрирован (заглушка получила 200 на {test:true})", mock.state.webhook?.testStatus === 200, JSON.stringify(mock.state.webhook));
  equal("адрес вебхука — наш сайт + секрет", mock.state.webhook?.uri, `${BASE}/api/webhooks/wazzup/${SECRET}`);
  check("подписка на сообщения, статусы и каналы", mock.state.webhook?.subscriptions?.messagesAndStatuses === true && mock.state.webhook?.subscriptions?.channelsUpdates === true);
  check("пользователи CRM переданы в Wazzup (владелец и администраторы)", mock.state.users.length >= 2, `${mock.state.users.length}`);
  check("охрана в Wazzup не передаётся", !mock.state.users.some((u) => /Охрана/.test(u.name)));

  // Форма на сайте: только WhatsApp
  const site = await octx.newPage();
  await site.goto(`${BASE}/`, { waitUntil: "load" });
  const radios = site.locator('#booking [role="radiogroup"][aria-label="Куда прислать подтверждение"] [role="radio"]');
  for (let i = 0; i < 20 && (await radios.count()) !== 1; i++) await wait(250);
  equal("в форме заявки один мессенджер", await radios.count(), 1);
  check("и это WhatsApp", /WhatsApp/.test(await radios.first().innerText().catch(() => "")));
  await site.close();

  // 5. Отправка настоящим путём: тик отправщика → адаптер → заглушка
  await tick();
  const a1 = await row(A.out.id);
  const msgA = accepted(A.out.id)[0];
  check("тик: заглушка получила POST /v3/message, crmMessageId = id записи Outbox", !!msgA);
  equal("A: запись SENT", a1.status, "SENT");
  check("A: providerMessageId записан — id сообщения у Wazzup", !!a1.providerMessageId && a1.providerMessageId === msgA?.messageId, `${a1.providerMessageId} / ${msgA?.messageId}`);
  equal("chatType whatsapp", msgA?.chatType, "whatsapp");
  equal("chatId — номер цифрами без плюса", msgA?.chatId, A.digits);
  equal("канал найден по транспорту", msgA?.channelId, MOCK_CHANNEL_ID);
  check("ключ — заголовком Authorization, в теле его нет", mock.state.requests.some((r) => r.path === "/v3/message" && r.auth === `Bearer ${KEY}`) && !JSON.stringify(msgA).includes(KEY));
  await tick();
  equal("второй тик — второй отправки нет", posts(A.out.id), 1);
  check("карточка брони: «отправлено»", /^отправлено /.test(await outboxCaption(owner, A.id, A.out.renderedText.slice(0, 20))));

  // 429 — Wazzup не принял: повтор с паузой той же записью
  const B = await lead("B");
  mock.state.failNext.push({ status: 429, body: { error: "TOO_MANY_REQUESTS" } });
  await tick();
  let b1 = await row(B.out.id);
  check("429 → ждёт повтора: PENDING, попыток 1, пауза", b1.status === "PENDING" && b1.attempts === 1 && !!b1.nextAttemptAt && /TOO_MANY_REQUESTS/.test(b1.lastError ?? ""), `${b1.status} ${b1.attempts} ${b1.lastError}`);
  await db.outbox.update({ where: { id: B.out.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  await tick();
  b1 = await row(B.out.id);
  check("после паузы та же запись уходит: SENT, попыток 2", b1.status === "SENT" && b1.attempts === 2 && !!b1.providerMessageId, `${b1.status} ${b1.attempts}`);
  equal("клиенту B — одно сообщение", accepted(B.out.id).length, 1);

  // 5xx — исход неизвестен (Wazzup мог и отправить): FAILED «статус неизвестен», без повтора, одно уведомление
  const E = await lead("E");
  mock.state.failNext.push({ status: 500, body: { error: "UNKNOWN_ERROR" } });
  await tick();
  const e1 = await row(E.out.id);
  check("5xx → FAILED «статус отправки неизвестен», без повтора", e1.status === "FAILED" && /^статус отправки неизвестен/.test(e1.lastError ?? "") && !e1.nextAttemptAt && e1.attempts === 1, `${e1.status} ${e1.lastError}`);
  await tick();
  equal("5xx: второго запроса в Wazzup нет", posts(E.out.id), 1);
  equal("5xx: одно уведомление «проверьте переписку»", await failedNotices(E.id), 1);

  // Таймаут: Wazzup принял сообщение, но ответ опоздал — у клиента оно одно, повтора нет
  const T = await lead("T");
  await put("sender.timeoutMs", 1000);
  mock.state.failNext.push({ delayMs: 3000 });
  await tick();
  const t1 = await row(T.out.id);
  await db.setting.delete({ where: { key: "sender.timeoutMs" } });
  check("таймаут → FAILED «статус отправки неизвестен», без повтора", t1.status === "FAILED" && t1.lastError === "статус отправки неизвестен: нет ответа за 1 с (TIMEOUT)" && !t1.nextAttemptAt && !t1.lockedUntil, `${t1.status} ${t1.lastError}`);
  await wait(3500);
  await tick();
  equal("таймаут: сообщение у клиента одно (ответ опоздал, повтора нет)", accepted(T.out.id).length, 1);
  equal("таймаут: запрос в Wazzup был один", posts(T.out.id), 1);
  equal("таймаут: одно уведомление", await failedNotices(T.id), 1);
  equal("карточка брони: «статус неизвестен — проверьте переписку»", await outboxCaption(owner, T.id, T.out.renderedText.slice(0, 20)), "статус отправки неизвестен: нет ответа за 1 с (TIMEOUT) — проверьте переписку с клиентом");

  // BAD_CONTACT — FAILED без повтора, «позвоните клиенту» одно (от отправщика), адаптер второго не создаёт
  const C = await lead("C");
  mock.state.failNext.push({ status: 400, body: { error: "BAD_CONTACT", description: "no whatsapp" } });
  const beforeBad = new Date();
  await tick();
  const c1 = await row(C.out.id);
  check("BAD_CONTACT → FAILED, попыток 1", c1.status === "FAILED" && c1.attempts === 1 && /^BAD_CONTACT/.test(c1.lastError ?? ""), `${c1.status} ${c1.lastError}`);
  check("в причине нет тела ответа", !/no whatsapp/.test(c1.lastError ?? ""));
  await tick();
  equal("BAD_CONTACT: повтора нет", posts(C.out.id), 1);
  equal("BAD_CONTACT: уведомление MESSAGE_FAILED одно", await failedNotices(C.id), 1);
  equal("BAD_CONTACT: других уведомлений по отправке нет", await db.adminNotice.count({ where: { kind: { in: ["MESSAGE_FAILED", "CHANNEL_DOWN"] }, createdAt: { gte: beforeBad } } }), 1);
  equal("карточка брони: «не доставлено: причина, попыток 1»", await outboxCaption(owner, C.id, C.out.renderedText.slice(0, 20)), "не доставлено: BAD_CONTACT: номера нет в мессенджере, попыток 1");

  // Тариф и незнакомый код: уведомления владельцу от адаптера
  const P1 = await extra(C, "tariff");
  mock.state.failNext.push({ status: 400, body: { error: "MESSAGES_NOT_TEXT_FIRST" } });
  await tick();
  check("MESSAGES_NOT_TEXT_FIRST → FAILED", (await row(P1.id)).status === "FAILED");
  const P2 = await extra(C, "unknown");
  mock.state.failNext.push({ status: 403, body: { error: "E2E_NEW_CODE" } });
  await tick();
  const p2 = await row(P2.id);
  check("незнакомый 4xx → FAILED с кодом", p2.status === "FAILED" && /E2E_NEW_CODE/.test(p2.lastError ?? ""), p2.lastError);
  let bell = await bellText(owner);
  check("уведомление про тариф «Pro или Max»", /Pro или Max/.test(bell));
  check("уведомление с незнакомым кодом как есть", /E2E_NEW_CODE/.test(bell));

  // 6. Статусы доставки только вперёд — отметка в «Сообщения клиенту» (OutboxList)
  const pmA = a1.providerMessageId;
  const mark = async (id) => nb(await (await bookingPage(owner, id)).locator('[data-testid="outbox-item"][data-status="SENT"]').getByTestId("delivery-mark").first().innerText().catch(() => ""));
  equal("статус delivered — 200", (await webhook({ statuses: [{ messageId: pmA, status: "delivered", timestamp: new Date().toISOString() }] })).status, 200);
  check("в карточке брони у отправленного «доставлено»", /^доставлено/.test(await mark(A.id)));
  await webhook({ statuses: [{ messageId: pmA, status: "read", timestamp: new Date().toISOString() }] });
  check("затем «прочитано»", /^прочитано/.test(await mark(A.id)));
  await webhook({ statuses: [{ messageId: pmA, status: "delivered", timestamp: new Date().toISOString() }] });
  check("опоздавший delivered не затирает «прочитано»", /^прочитано/.test(await mark(A.id)));
  equal("статус чужого сообщения — 200, без ошибок", (await webhook({ statuses: [{ messageId: randomUUID(), status: "read" }] })).status, 200);
  await webhook({ statuses: [{ messageId: b1.providerMessageId, status: "error", error: { error: "BAD_CONTACT", description: "x" } }] });
  check("недоставка после отправки — «не доставлено (BAD_CONTACT)»", /не доставлено \(BAD_CONTACT\)/.test(await mark(B.id)));
  equal("…а сама запись остаётся SENT", (await row(B.out.id)).status, "SENT");
  bell = await bellText(owner);
  check("уведомление «не доставлено, позвоните клиенту»", new RegExp(`брони №${B.number} не доставлено \\(BAD_CONTACT\\)\\. Позвоните`).test(bell), line(bell));
  await readAllNotices(owner); // дальше — уведомления входящих и каналов с чистого листа (в колокольчике до 20 непрочитанных)

  // 7. Входящие: лента брони, колокольчик один на клиента, повтор вебхука не дублирует
  const inA = { messageId: `e2e-in-${randomUUID()}`, channelId: MOCK_CHANNEL_ID, chatType: "whatsapp", chatId: A.digits, dateTime: new Date().toISOString(), type: "text", isEcho: false, text: "E2E: опоздаю на час", contact: { name: "E2E Wazzup A" } };
  await webhook({ messages: [inA] });
  await webhook({ messages: [inA] });
  await bookingPage(owner, A.id);
  let feed = nb(await owner.locator("aside").last().innerText());
  equal("входящее в ленте брони ровно один раз", count(feed, "Клиент написал в WhatsApp: E2E: опоздаю на час"), 1);
  await webhook({ messages: [{ ...inA, messageId: `e2e-in-${randomUUID()}`, text: "E2E: второе сообщение" }] });
  bell = await bellText(owner);
  equal("колокольчик: одно уведомление на клиента, пока не прочитано", count(bell, `бронь №${A.number}:`), 1);
  check("в уведомлении текст клиента", /написал в WhatsApp · бронь №\d+: «E2E: опоздаю на час»/.test(bell));

  // Входящее с дополнительного телефона клиента привязывается к его брони
  const extraPhone = testPhone();
  await bookingPage(owner, A.id);
  await owner.getByRole("link", { name: "Карточка клиента →" }).click();
  await owner.waitForURL(/\/admin\/clients\//, { timeout: 15000 });
  const edit = owner.locator("section").filter({ has: owner.getByRole("heading", { name: "Данные" }) }).getByRole("button", { name: "Изменить" });
  await hydrated(edit);
  await edit.click();
  const extraInput = owner.getByPlaceholder(/через запятую/);
  await extraInput.fill(`+7${extraPhone}`);
  await extraInput.locator("xpath=ancestor::form").getByRole("button", { name: "Сохранить" }).click();
  await owner.getByText(`+7${extraPhone}`).first().waitFor({ timeout: 15000 }).catch(() => {});
  await webhook({ messages: [{ ...inA, messageId: `e2e-in-${randomUUID()}`, chatId: `7${extraPhone}`, text: "E2E: пишу со второго номера" }] });
  await bookingPage(owner, A.id);
  feed = nb(await owner.locator("aside").last().innerText());
  check("входящее с доп. телефона — в ленте брони клиента", feed.includes("Клиент написал в WhatsApp: E2E: пишу со второго номера"));

  // 8. Эхо: наше сообщение не дублируется, ответ администратора — «Ответ в WhatsApp (имя)»
  await webhook({ messages: [{ ...inA, messageId: pmA, isEcho: true, text: "наше подтверждение" }] });
  await webhook({ messages: [{ ...inA, messageId: `e2e-echo-${randomUUID()}`, isEcho: true, authorName: "Анна E2E", text: "E2E: ждём вас" }] });
  await bookingPage(owner, A.id);
  feed = nb(await owner.locator("aside").last().innerText());
  check("эхо нашего сообщения в ленту не пишется", !feed.includes("наше подтверждение"));
  check("ответ администратора из Wazzup — в ленте с именем", feed.includes("Ответ в WhatsApp (Анна E2E): E2E: ждём вас"));

  // 9. Незнакомый номер
  const stranger = testPhone();
  await webhook({ messages: [{ ...inA, messageId: `e2e-in-${randomUUID()}`, chatId: `7${stranger}`, text: "E2E: кто это?", contact: undefined }] });
  bell = await bellText(owner);
  const pretty = `+7 ${stranger.slice(0, 3)} ${stranger.slice(3, 6)}-${stranger.slice(6, 8)}-${stranger.slice(8)}`;
  check("сообщение с незнакомого номера — уведомление с номером", bell.includes(`${pretty} написал в WhatsApp: «E2E: кто это?»`), line(bell));

  // 10. Канал отвалился: уведомление, карточка красная, сайт WhatsApp не теряет, отправщик ждёт без траты попытки; возврат
  mock.state.channels[0].state = "qridle";
  await webhook({ channelsUpdates: [{ channelId: MOCK_CHANNEL_ID, state: "qr", timestamp: Date.now() }] });
  bell = await bellText(owner);
  check("уведомление «нужно заново отсканировать QR-код»", /Канал WhatsApp отключился: нужно заново отсканировать QR-код/.test(bell));
  card = await openSettings(owner);
  check("в карточке настроек канал красный: «нужно отсканировать QR-код»", /нужно отсканировать QR-код/.test(nb(await card.getByTestId("wz-channel").first().innerText())));
  equal("сайт не прячет купленный WhatsApp из-за аварии", JSON.stringify(await siteChannels()), JSON.stringify(["WHATSAPP"]));
  const D = await lead("D");
  await tick();
  const d1 = await row(D.out.id);
  check("канал не работает → сообщение ждёт: PENDING, попытка не потрачена, причина", d1.status === "PENDING" && d1.attempts === 0 && /провайдер недоступен/.test(d1.lastError ?? ""), `${d1.status} ${d1.attempts} ${d1.lastError}`);
  equal("канал не работает → в Wazzup ничего не ушло", posts(D.out.id), 0);
  mock.state.channels[0].state = "active";
  await webhook({ channelsUpdates: [{ channelId: MOCK_CHANNEL_ID, state: "active", timestamp: Date.now() }] });
  bell = await bellText(owner);
  check("уведомление «канал снова работает»", /Канал WhatsApp снова работает/.test(bell));
  await db.outbox.update({ where: { id: D.out.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  await tick();
  const d2 = await row(D.out.id);
  check("после восстановления запись уходит: SENT, попыток 1", d2.status === "SENT" && d2.attempts === 1, `${d2.status} ${d2.attempts}`);
  // «Упал → поднялся → упал» без чтения колокольчика: вторая авария не глохнет из-за непрочитанной первой
  mock.state.channels[0].state = "qridle";
  await webhook({ channelsUpdates: [{ channelId: MOCK_CHANNEL_ID, state: "qr", timestamp: Date.now() }] });
  bell = await bellText(owner);
  equal("повторная авария — второе уведомление про QR", count(bell, "Канал WhatsApp отключился: нужно заново отсканировать QR-код"), 2);
  mock.state.channels[0].state = "active";
  await webhook({ channelsUpdates: [{ channelId: MOCK_CHANNEL_ID, state: "active", timestamp: Date.now() }] });

  // Wazzup не принимает ключ: отправщик ждёт, владелец узнаёт из проверки связи в тике — одно уведомление, пока не прочитано
  const K = await lead("K");
  // Непрочитанное от прошлого прогона заглушило бы новое (notifyOnce) — считаем с чистого листа
  await db.adminNotice.updateMany({ where: { readAt: null, text: { contains: "Wazzup не принимает ключ API" } }, data: { readAt: new Date() } });
  const beforeKey = new Date();
  mock.state.channelsFail = { status: 401, body: { error: "UNAUTHORIZED" } };
  await tick();
  await tick();
  mock.state.channelsFail = null;
  const k1 = await row(K.out.id);
  check("ключ не принят → сообщение ждёт, попытка не потрачена", k1.status === "PENDING" && k1.attempts === 0 && /провайдер недоступен/.test(k1.lastError ?? "") && posts(K.out.id) === 0, `${k1.status} ${k1.attempts} ${k1.lastError}`);
  equal("ключ не принят → одно уведомление «проверьте WAZZUP_API_KEY» за два тика", await db.adminNotice.count({ where: { createdAt: { gte: beforeKey }, text: { contains: "Wazzup не принимает ключ API" } } }), 1);
  await db.outbox.update({ where: { id: K.out.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  await tick();
  equal("ключ снова принят → запись уходит", (await row(K.out.id)).status, "SENT");

  // 11. Окно чатов: выключено по умолчанию, у владельца и администратора — есть, у охраны — нет
  await owner.goto(`${BASE}/admin/chats?t=${Date.now()}`, { waitUntil: "load" });
  check("окно чатов выключено — страница объясняет, где включить", await owner.getByTestId("chats-off").isVisible().catch(() => false));
  mock.state.unanswered = 3;
  check("владелец включает окно чатов", await setChats(owner, true));
  const iframesBefore = mock.state.iframes.length;
  await owner.goto(`${BASE}/admin/chats?t=${Date.now()}`, { waitUntil: "load" });
  const frame = owner.getByTestId("chat-frame");
  await frame.waitFor({ timeout: 15000 }).catch(() => {});
  check("страница «Чаты»: iframe с адресом Wazzup", ((await frame.getAttribute("src").catch(() => "")) ?? "").startsWith(`http://localhost:${mock.port}/chat-frame`));
  equal("iframe с разрешениями микрофона и буфера", await frame.getAttribute("allow").catch(() => ""), "microphone *; clipboard-write *");
  const g = mock.state.iframes[iframesBefore];
  check("запрос окна: scope global, пользователь CRM", g?.scope === "global" && typeof g?.user?.id === "string" && !!g?.user?.name, JSON.stringify(g));
  const html = await owner.content();
  check("в HTML страницы нет ни ключа, ни секрета вебхука", !html.includes(KEY) && !html.includes(SECRET));
  const badge = owner.getByTestId("chats-unanswered");
  await badge.waitFor({ timeout: 15000 }).catch(() => {});
  equal("у пункта «Чаты» — 3 неотвеченных", nb(await badge.innerText().catch(() => "")), "3");

  await bookingPage(owner, A.id);
  const openA = owner.getByTestId("chat-panel").getByRole("button", { name: "Открыть чат" });
  await hydrated(openA);
  await openA.click();
  await owner.getByTestId("chat-frame").waitFor({ timeout: 15000 }).catch(() => {});
  const cardReq = mock.state.iframes.at(-1);
  check("панель в карточке брони: scope card, фильтр по номеру клиента", cardReq?.scope === "card" && cardReq.filter?.some((f) => f.chatType === "whatsapp" && f.chatId === A.digits), JSON.stringify(cardReq));
  check("iframe открылся в карточке брони", await owner.getByTestId("chat-frame").isVisible().catch(() => false));
  await owner.getByRole("link", { name: "Карточка клиента →" }).click();
  await owner.waitForURL(/\/admin\/clients\//, { timeout: 15000 });
  const openC = owner.getByTestId("chat-panel").getByRole("button", { name: "Открыть чат" });
  await hydrated(openC);
  await openC.click();
  await owner.getByTestId("chat-frame").waitFor({ timeout: 15000 }).catch(() => {});
  const clientReq = mock.state.iframes.at(-1);
  check("панель в карточке клиента: scope card по телефонам клиента", clientReq?.scope === "card" && clientReq.filter?.some((f) => f.chatId === A.digits), JSON.stringify(clientReq));

  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await login(actx, "admin", ADMIN_PASSWORD);
  await admin.goto(`${BASE}/admin/chats`, { waitUntil: "load" });
  check("администратор: окно чатов открывается", await admin.getByTestId("chat-frame").waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
  await actx.close();

  const gctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guard = await login(gctx, "guard", GUARD_PASSWORD);
  await guard.goto(`${BASE}/admin/chats`, { waitUntil: "load" });
  check("охрана: /admin/chats уводит на её экран", !guard.url().includes("/admin/chats"), guard.url());
  check("охрана: окна чатов нет", (await guard.getByTestId("chat-frame").count()) === 0);
  equal("охрана: счётчик неотвеченных — 403", (await guard.request.get(`${BASE}/api/admin/chats/unanswered`)).status(), 403);
  await gctx.close();
  equal("без входа: счётчик неотвеченных — 401", (await fetch(`${BASE}/api/admin/chats/unanswered`)).status, 401);

  card = await openSettings(owner);
  check("счётчик диалогов месяца в карточке", /Диалогов в этом месяце: [1-9]\d* из 500/.test(nb(await card.getByTestId("wz-dialogs").innerText())), nb(await card.getByTestId("wz-dialogs").innerText()));

  // 12. Провайдер снят в «Отправка сообщений» — сайт снова без сужения, карточка «Сообщения» это видит
  check("владелец снимает провайдера («Не подключён»)", await selectProvider(owner, "none"));
  equal("сайт при снятом провайдере снова предлагает всё", await siteChannels(), null);
  card = await openSettings(owner);
  check("карточка «Сообщения»: снова «не выбран»", /не выбран/.test(nb(await card.getByTestId("provider-state").innerText())));
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  check("сценарий Ф14 дошёл до конца", false, e.message);
} finally {
  // Настройки и чужие записи — как были (провайдер, режим отправщика, окно чатов)
  await db.setting.deleteMany({ where: { key: { in: KEYS } } }).catch(() => {});
  for (const s of saved) await put(s.key, s.value).catch(() => {});
  for (const p of parked) await db.outbox.updateMany({ where: { id: p.id, status: "PENDING" }, data: { scheduledAt: p.scheduledAt } }).catch(() => {});
  await browser.close();
  await mock.close();
  await db.$disconnect();
}
finish("Ф14 Wazzup");
