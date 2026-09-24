// Ф14 (docs/phases/PHASE_14_WAZZUP.md): адаптер Wazzup, вебхук, окно чатов — ТОЛЬКО против локальной заглушки.
// Настоящий Wazzup не трогается: заглушка поднимается здесь же, dev-сервер должен смотреть на неё.
// Запуск (dev-сервер со своими переменными, порт заглушки = порт сайта + 800):
//   WAZZUP_API_BASE=http://localhost:3914/v3 WAZZUP_API_KEY=e2e-wazzup-key-local-only \
//   WAZZUP_WEBHOOK_SECRET=e2e-local-webhook-secret-000000000000000000 WAZZUP_WEBHOOK_BASE=http://localhost:3114 \
//   WAZZUP_TEST_HOOKS=1 npx next dev -p 3114
//   node tests/e2e/f14-wazzup.mjs --base http://localhost:3114 --login owner --password owner12345
// Отправщика Ф4ш0 в ветке нет: запись Outbox отправляется тестовой ручкой /api/dev/wazzup-send (адаптер напрямую).
import { randomUUID } from "node:crypto";
import { BASE, LOGIN, PASSWORD, arg, check, equal, finish, loadPlaywright, testPhone, isoPlus } from "./lib.mjs";
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

const hook = async (body) => (await fetch(`${BASE}/api/dev/wazzup-send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const webhook = (body, secret = SECRET) => fetch(`${BASE}/api/webhooks/wazzup/${secret}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const siteChannels = async () => (await (await fetch(`${BASE}/api/public/channels`, { cache: "no-store" })).json()).channels;

// Заявка с сайта: сразу ставит сообщение в Outbox. Свой адрес на каждую — не упираемся в лимит 8 заявок за 10 минут
async function lead(label) {
  const phone = testPhone();
  const from = isoPlus(40 + Math.floor(Math.random() * 200));
  const to = new Date(new Date(from).getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const r = await fetch(`${BASE}/api/public/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip() },
    body: JSON.stringify({ dateFrom: from, dateTo: to, vehicleType: "car", name: `E2E Wazzup ${label}`, phone, dial: "+7", channels: ["WHATSAPP"], primary: "WHATSAPP", ts: Date.now() - 10_000 }),
  });
  const j = await r.json();
  if (!j.number) throw new Error(`заявка ${label} не создана: ${JSON.stringify(j)}`);
  return { phone, digits: `7${phone}`, number: j.number };
}

// На stage (production-сборка) тестовая ручка выключена и боевой ключ живой: сценарий там не запускается
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.log(`\nФ14 Wazzup: только локально против заглушки — на ${BASE} пропущено`);
  process.exit(0);
}

const mock = await startWazzupMock({ port: MOCK_PORT, key: KEY }).catch((e) => {
  console.error(`Заглушка Wazzup не поднялась на порту ${MOCK_PORT}: ${e.message}`);
  process.exit(2);
});
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

async function setProvider(page, on) {
  const card = await openSettings(page);
  const state = card.getByTestId("provider-state");
  const want = on ? /включена/ : /выключена/;
  if (want.test(nb(await state.textContent()))) return true;
  const btn = card.getByRole("button", { name: on ? "Включить отправку" : "Выключить отправку" });
  await hydrated(btn);
  await btn.click();
  await state.filter({ hasText: want }).waitFor({ timeout: 20000 }).catch(() => {});
  return want.test(nb(await state.textContent()));
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

async function bookingId(page, number, phone) {
  await page.goto(`${BASE}/admin/search?q=${phone}`, { waitUntil: "domcontentloaded" });
  const row = page.locator(`a[href^="/admin/bookings/"]`).filter({ hasText: `№${number}` }).first();
  await row.waitFor({ timeout: 15000 });
  return (await row.getAttribute("href")).split("/").pop();
}

async function bookingPage(page, id) {
  await page.goto(`${BASE}/admin/bookings/${id}?t=${Date.now()}`, { waitUntil: "load" });
  return page;
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

let owner;
try {
  console.log(`\nФ14 Wazzup (заглушка ${mock.url}): ${BASE}`);

  // 0. Dev-сервер смотрит на эту заглушку, а не на боевой Wazzup
  const pre = await fetch(`${BASE}/api/dev/wazzup-send`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!pre || pre.base !== mock.url) {
    check("dev-сервер запущен с WAZZUP_TEST_HOOKS=1 и WAZZUP_API_BASE на заглушку", false, pre ? `база сервера ${pre.base}` : "тестовая ручка выключена — см. шапку файла");
    throw new Error("окружение dev-сервера не для Ф14");
  }

  // 1. Вебхук: секрет в адресе
  equal("вебхук с чужим секретом — 404", (await webhook({ test: true }, "x".repeat(40))).status, 404);
  equal("вебхук с коротким секретом — 404", (await webhook({ test: true }, "short")).status, 404);
  equal("GET на верный адрес — 404", (await fetch(`${BASE}/api/webhooks/wazzup/${SECRET}`)).status, 404);
  equal("проверочный {test:true} — 200", (await webhook({ test: true })).status, 200);
  equal("мусорное тело — всё равно 200", (await webhook("не json")).status, 200);

  // 2. Карточка «Сообщения» у владельца: проверка связи, выключатель, вебхук и пользователи
  const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  owner = await login(octx, LOGIN, PASSWORD);
  await readAllNotices(owner); // колокольчик с чистого листа: иначе прошлые непрочитанные глушат новые уведомления
  check("провайдер выключен до теста (или выключен тестом)", await setProvider(owner, false));
  check("окно чатов выключено до теста (или выключено тестом)", await setChats(owner, false));
  equal("сайт при выключенном провайдере не сужает список", await siteChannels(), null);
  let card = await openSettings(owner);
  const checkBtn = card.getByRole("button", { name: "Проверить связь" });
  await hydrated(checkBtn);
  await checkBtn.click();
  await card.getByTestId("wz-result").waitFor({ timeout: 20000 });
  check("«Проверить связь» — связь есть, WhatsApp работает", /Связь есть, работают: WhatsApp/.test(nb(await card.getByTestId("wz-result").textContent())));
  card = await openSettings(owner);
  check("строка канала WhatsApp «работает» в карточке", /WhatsApp[\s\S]*работает/.test(nb(await card.getByTestId("wz-channel").first().innerText())));
  check("владелец включает отправку через Wazzup", await setProvider(owner, true));
  equal("сайт предлагает только купленный WhatsApp", JSON.stringify(await siteChannels()), JSON.stringify(["WHATSAPP"]));

  card = await openSettings(owner);
  const setupBtn = card.getByRole("button", { name: "Подключить вебхук и пользователей" });
  await hydrated(setupBtn);
  await setupBtn.click();
  await card.getByTestId("wz-result").waitFor({ timeout: 45000 });
  check("вебхук зарегистрирован (заглушка получила 200 на {test:true})", mock.state.webhook?.testStatus === 200, JSON.stringify(mock.state.webhook));
  equal("адрес вебхука — наш сайт + секрет", mock.state.webhook?.uri, `${BASE}/api/webhooks/wazzup/${SECRET}`);
  check("подписка на сообщения, статусы и каналы", mock.state.webhook?.subscriptions?.messagesAndStatuses === true && mock.state.webhook?.subscriptions?.channelsUpdates === true);
  check("пользователи CRM переданы в Wazzup (владелец и администраторы)", mock.state.users.length >= 2, `${mock.state.users.length}`);
  check("охрана в Wazzup не передаётся", !mock.state.users.some((u) => /Охрана/.test(u.name)));

  // 3. Форма на сайте: только WhatsApp
  const site = await octx.newPage();
  await site.goto(`${BASE}/`, { waitUntil: "load" });
  const radios = site.locator('#booking [role="radiogroup"][aria-label="Куда прислать подтверждение"] [role="radio"]');
  for (let i = 0; i < 20 && (await radios.count()) !== 1; i++) await wait(250);
  equal("в форме заявки один мессенджер", await radios.count(), 1);
  check("и это WhatsApp", /WhatsApp/.test(await radios.first().innerText().catch(() => "")));
  await site.close();

  // 4. Отправка: правильный запрос, дубль не уходит второй раз
  const A = await lead("A");
  const sentA = await hook({ bookingNumber: A.number });
  check("адаптер: заявка ушла в Wazzup", sentA.result?.ok === true && typeof sentA.result.providerMessageId === "string", JSON.stringify(sentA.result));
  const msgA = mock.state.messages.find((m) => m.crmMessageId === sentA.outboxId);
  check("crmMessageId = id записи Outbox", !!msgA);
  equal("chatType whatsapp", msgA?.chatType, "whatsapp");
  equal("chatId — номер цифрами без плюса", msgA?.chatId, A.digits);
  equal("канал найден по транспорту", msgA?.channelId, MOCK_CHANNEL_ID);
  check("ключ — заголовком Authorization, в теле его нет", mock.state.requests.some((r) => r.path === "/v3/message" && r.auth === `Bearer ${KEY}`) && !JSON.stringify(msgA).includes(KEY));
  const before = mock.state.messages.length;
  const dup = await hook({ outboxId: sentA.outboxId });
  check("повтор той же записи — «уже отправлено», без второго сообщения", dup.result?.ok === true && dup.result.providerMessageId === null && mock.state.messages.length === before, JSON.stringify(dup.result));

  // 5. Ошибки: 429 и 5xx — повторить, 4xx — не повторять
  const B = await lead("B");
  mock.state.failNext.push({ status: 429, body: { error: "TOO_MANY_REQUESTS" } });
  const r429 = await hook({ bookingNumber: B.number });
  check("429 → повторить позже", r429.result?.ok === false && r429.result.retry === true, JSON.stringify(r429.result));
  mock.state.failNext.push({ status: 500, body: { error: "UNKNOWN_ERROR" } });
  const r500 = await hook({ outboxId: r429.outboxId });
  check("500 → повторить позже", r500.result?.ok === false && r500.result.retry === true, JSON.stringify(r500.result));
  const okB = await hook({ outboxId: r429.outboxId });
  check("после сбоя та же запись уходит", okB.result?.ok === true && !!okB.result.providerMessageId, JSON.stringify(okB.result));

  const C = await lead("C");
  mock.state.failNext.push({ status: 400, body: { error: "BAD_CONTACT", description: "no whatsapp" } });
  const bad = await hook({ bookingNumber: C.number });
  check("BAD_CONTACT → не повторять", bad.result?.ok === false && bad.result.retry === false && bad.result.code === "BAD_CONTACT", JSON.stringify(bad.result));
  check("в сообщении об ошибке нет тела ответа", !/no whatsapp/.test(bad.result?.message ?? ""));
  const idC = await bookingId(owner, C.number, C.phone);
  await bookingPage(owner, idC);
  check("запись в карточке — FAILED", /FAILED/.test(nb(await owner.locator("main").innerText())));
  mock.state.failNext.push({ status: 400, body: { error: "MESSAGES_NOT_TEXT_FIRST" } });
  const tariff = await hook({ outboxId: bad.outboxId });
  check("MESSAGES_NOT_TEXT_FIRST → не повторять", tariff.result?.retry === false);
  mock.state.failNext.push({ status: 403, body: { error: "E2E_NEW_CODE" } });
  const unknown = await hook({ outboxId: bad.outboxId });
  check("незнакомый 4xx → не повторять", unknown.result?.retry === false && unknown.result.code === "E2E_NEW_CODE");
  let bell = await bellText(owner);
  check("уведомление про тариф «Pro или Max»", /Pro или Max/.test(bell));
  check("уведомление с незнакомым кодом как есть", /E2E_NEW_CODE/.test(bell));

  // 6. Статусы доставки только вперёд
  const idA = await bookingId(owner, A.number, A.phone);
  const pmA = sentA.result.providerMessageId;
  const mark = async () => nb(await (await bookingPage(owner, idA)).getByTestId("delivery-mark").first().innerText().catch(() => ""));
  equal("статус delivered — 200", (await webhook({ statuses: [{ messageId: pmA, status: "delivered", timestamp: new Date().toISOString() }] })).status, 200);
  check("в карточке «доставлено»", /^доставлено/.test(await mark()));
  await webhook({ statuses: [{ messageId: pmA, status: "read", timestamp: new Date().toISOString() }] });
  check("затем «прочитано»", /^прочитано/.test(await mark()));
  await webhook({ statuses: [{ messageId: pmA, status: "delivered", timestamp: new Date().toISOString() }] });
  check("опоздавший delivered не затирает «прочитано»", /^прочитано/.test(await mark()));
  equal("статус чужого сообщения — 200, без ошибок", (await webhook({ statuses: [{ messageId: randomUUID(), status: "read" }] })).status, 200);
  const idB = await bookingId(owner, B.number, B.phone);
  await webhook({ statuses: [{ messageId: okB.result.providerMessageId, status: "error", error: { error: "BAD_CONTACT", description: "x" } }] });
  await bookingPage(owner, idB);
  check("недоставка после отправки — «не доставлено (BAD_CONTACT)»", /не доставлено \(BAD_CONTACT\)/.test(nb(await owner.getByTestId("delivery-mark").first().innerText().catch(() => ""))));
  check("…а сама запись остаётся SENT", /SENT/.test(nb(await owner.locator("main").innerText())));
  bell = await bellText(owner);
  check("уведомление «не доставлено, позвоните клиенту»", new RegExp(`брони №${B.number} не доставлено \\(BAD_CONTACT\\)\\. Позвоните`).test(bell), line(bell));

  // 7. Входящие: лента брони, колокольчик один на клиента, повтор вебхука не дублирует
  const inA = { messageId: `e2e-in-${randomUUID()}`, channelId: MOCK_CHANNEL_ID, chatType: "whatsapp", chatId: A.digits, dateTime: new Date().toISOString(), type: "text", isEcho: false, text: "E2E: опоздаю на час", contact: { name: "E2E Wazzup A" } };
  await webhook({ messages: [inA] });
  await webhook({ messages: [inA] });
  await bookingPage(owner, idA);
  let feed = nb(await owner.locator("aside").last().innerText());
  equal("входящее в ленте брони ровно один раз", count(feed, "Клиент написал в WhatsApp: E2E: опоздаю на час"), 1);
  await webhook({ messages: [{ ...inA, messageId: `e2e-in-${randomUUID()}`, text: "E2E: второе сообщение" }] });
  bell = await bellText(owner);
  equal("колокольчик: одно уведомление на клиента, пока не прочитано", count(bell, `бронь №${A.number}:`), 1);
  check("в уведомлении текст клиента", /написал в WhatsApp · бронь №\d+: «E2E: опоздаю на час»/.test(bell));

  // 8. Эхо: наше сообщение не дублируется, ответ администратора — «Ответ в WhatsApp (имя)»
  await webhook({ messages: [{ ...inA, messageId: pmA, isEcho: true, text: "наше подтверждение" }] });
  await webhook({ messages: [{ ...inA, messageId: `e2e-echo-${randomUUID()}`, isEcho: true, authorName: "Анна E2E", text: "E2E: ждём вас" }] });
  await bookingPage(owner, idA);
  feed = nb(await owner.locator("aside").last().innerText());
  check("эхо нашего сообщения в ленту не пишется", !feed.includes("наше подтверждение"));
  check("ответ администратора из Wazzup — в ленте с именем", feed.includes("Ответ в WhatsApp (Анна E2E): E2E: ждём вас"));

  // 9. Незнакомый номер
  const stranger = testPhone();
  await webhook({ messages: [{ ...inA, messageId: `e2e-in-${randomUUID()}`, chatId: `7${stranger}`, text: "E2E: кто это?", contact: undefined }] });
  bell = await bellText(owner);
  const pretty = `+7 ${stranger.slice(0, 3)} ${stranger.slice(3, 6)}-${stranger.slice(6, 8)}-${stranger.slice(8)}`;
  check("сообщение с незнакомого номера — уведомление с номером", bell.includes(`${pretty} написал в WhatsApp: «E2E: кто это?»`), line(bell));

  // 10. Канал отвалился: уведомление, карточка красная, сайт WhatsApp не теряет, отправка ждёт; возврат
  mock.state.channels[0].state = "qridle";
  await webhook({ channelsUpdates: [{ channelId: MOCK_CHANNEL_ID, state: "qr", timestamp: Date.now() }] });
  bell = await bellText(owner);
  check("уведомление «нужно заново отсканировать QR-код»", /Канал WhatsApp отключился: нужно заново отсканировать QR-код/.test(bell));
  card = await openSettings(owner);
  check("в карточке настроек канал красный: «нужно отсканировать QR-код»", /нужно отсканировать QR-код/.test(nb(await card.getByTestId("wz-channel").first().innerText())));
  equal("сайт не прячет купленный WhatsApp из-за аварии", JSON.stringify(await siteChannels()), JSON.stringify(["WHATSAPP"]));
  const D = await lead("D");
  const down = await hook({ bookingNumber: D.number });
  check("канал не работает → отправка ждёт (retry)", down.result?.ok === false && down.result.retry === true && down.result.code === "CHANNEL_DOWN", JSON.stringify(down.result));
  mock.state.channels[0].state = "active";
  await webhook({ channelsUpdates: [{ channelId: MOCK_CHANNEL_ID, state: "active", timestamp: Date.now() }] });
  bell = await bellText(owner);
  check("уведомление «канал снова работает»", /Канал WhatsApp снова работает/.test(bell));
  const up = await hook({ outboxId: down.outboxId });
  check("после восстановления запись уходит", up.result?.ok === true, JSON.stringify(up.result));

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

  await bookingPage(owner, idA);
  const openA = owner.getByTestId("chat-panel").getByRole("button", { name: "Открыть чат" });
  await hydrated(openA);
  await openA.click();
  await owner.getByTestId("chat-frame").waitFor({ timeout: 15000 }).catch(() => {});
  const cardReq = mock.state.iframes.at(-1);
  check("панель в карточке брони: scope card, фильтр по номеру клиента", cardReq?.scope === "card" && cardReq.filter?.some((f) => f.chatType === "whatsapp" && f.chatId === A.digits), JSON.stringify(cardReq));
  check("iframe открылся в карточке брони", await owner.getByTestId("chat-frame").isVisible().catch(() => false));
  const clientLink = owner.getByRole("link", { name: "Карточка клиента →" });
  await clientLink.click();
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

  // 12. Выключили провайдера — сайт снова без сужения
  check("владелец выключает отправку", await setProvider(owner, false));
  equal("сайт при выключенном провайдере снова предлагает всё", await siteChannels(), null);
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  check("сценарий Ф14 дошёл до конца", false, e.message);
} finally {
  // Настройки stage-подобной базы возвращаем как были: провайдер выключен, окно чатов выключено
  if (owner) {
    await setProvider(owner, false).catch(() => {});
    await setChats(owner, false).catch(() => {});
  }
  await browser.close();
  await mock.close();
}
finish("Ф14 Wazzup");
