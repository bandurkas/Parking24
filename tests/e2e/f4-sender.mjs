// Ф4 шаг 0 — отправщик сообщений и предохранители (docs/phases/PHASE_04_SENDER.md, раздел «Код»).
// Сообщение по брони уходит через заглушку провайдера: SENT, providerMessageId, время по Москве в «Сообщения клиенту»;
// «пробно» — ничего не меняется, но видно в журнале карточки; старое, вне списка разрешённых, без получателя — не уходит;
// двойной тик и чужая аренда — одна отправка; зависшая аренда после передачи адаптеру — «статус неизвестен» без повтора,
// до передачи — просто назад в очередь; таймаут — «статус неизвестен»; повтор и отказ; бюджет прохода; отмена и оживление
// записи во время отправки; «Убрать устаревшие»; самоотключение после серии сбоев (карта режимов сканов не затирается);
// «25:00» в заявке — отказ; оживление отменённого подтверждения через «Исправить статус».
// Только локально: заглушка есть лишь вне production, а расстановка данных идёт через базу из .env (RUN_SCHEDULER=0).
// Чужие неотправленные записи на время теста «паркуются» (scheduledAt в будущее) и возвращаются в finally.
// Вход владельцем: --login owner --password owner12345
import { PrismaClient } from "@prisma/client";
import { BASE, withBrowser, adminLogin, check, equal, finish, cronSecret, testPhone, testPlate, isoPlus, fillReliably } from "./lib.mjs";

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.log(`\nОтправщик: ${BASE} — сценарий только для локального сервера (заглушка провайдера и база из .env). Пропуск.\n`);
  process.exit(0);
}

const db = new PrismaClient();
const secret = cronSecret();
const T0 = new Date();
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msk = (d) => nb(new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d).replace(".", ""));
const KEYS = ["scheduler.scans", "messaging.provider", "messaging.fakeMode", "messaging.senderEnabled",
  "sender.maxAgeHours", "sender.allowlistOnly", "sender.allowlist", "sender.sendWhenChannelUnknown", "sender.maxPerTick", "sender.maxPerHour",
  "sender.maxPerClient", "sender.maxAttempts", "sender.leaseMinutes", "sender.timeoutMs", "sender.budgetMs", "sender.stopAfterFails",
  "sender.failStreak", "sender.dryPreview"];

async function tick() {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${BASE}/api/cron/automations`, { method: "POST", headers: { "X-Cron-Secret": secret } });
    if (r.status !== 200) throw new Error(`тик ответил ${r.status} (секрет?)`);
    const j = await r.json();
    if (!j.busy) return j;
    await sleep(1000);
  }
  throw new Error("тик всё время занят");
}
const put = (key, value) => db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
const setting = async (key) => (await db.setting.findUnique({ where: { key } }))?.value;
const row = (id) => db.outbox.findUnique({ where: { id } });

async function live(locator, timeout = 30000) {
  const el = locator.first();
  await el.waitFor({ timeout });
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await el.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactProps"))).catch(() => false)) return el;
    await el.page().waitForTimeout(150);
  }
  return el;
}

const saved = await db.setting.findMany({ where: { key: { in: KEYS } } });
let parked = [];

await withBrowser(async (page) => {
  console.log(`\nОтправщик: ${BASE}`);
  if (!secret) throw new Error("нет секрета: --secret, E2E_CRON_SECRET или CRON_SECRET в .env");
  try {
    // Заявка с сайта — настоящий путь до очереди. Заодно проверка, что сервер и база из .env — одно и то же:
    // иначе дальше тест трогал бы чужую базу
    const phoneA = `+7${testPhone()}`;
    const lead = await fetch(`${BASE}/api/public/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ dateFrom: isoPlus(20), dateTo: isoPlus(22), vehicleType: "car", name: "E2E Отправщик", phone: phoneA.slice(2), dial: "+7", channels: ["TELEGRAM"], primary: "TELEGRAM", website: "", ts: Date.now() - 5000 }),
    }).then((r) => r.json());
    if (!lead.ok || !lead.number) throw new Error(`заявка не создана: ${JSON.stringify(lead)}`);
    const A = await db.booking.findFirst({ where: { number: lead.number, contactPhone: phoneA } });
    if (!A) throw new Error(`заявки №${lead.number} с ${phoneA} нет в базе из .env — сервер смотрит в другую базу, тест остановлен`);

    // Чужие неотправленные — в будущее: тест трогает только свои записи
    parked = await db.outbox.findMany({ where: { status: "PENDING", NOT: { bookingId: A.id } }, select: { id: true, scheduledAt: true } });
    if (parked.length) await db.outbox.updateMany({ where: { id: { in: parked.map((p) => p.id) } }, data: { scheduledAt: new Date(Date.now() + 3650 * 86_400_000) } });
    // Настройки отправщика — по умолчанию (в finally вернутся прежние)
    await db.setting.deleteMany({ where: { key: { in: KEYS.filter((k) => k !== "scheduler.scans") } } });
    const scans = (await setting("scheduler.scans")) ?? {};
    await put("scheduler.scans", { ...(typeof scans === "object" ? Object.fromEntries(Object.entries(scans).filter(([k]) => k !== "sender")) : {}), e2e_probe: "dry" });

    const settings = async () => {
      await page.goto(`${BASE}/admin/settings?t=${Date.now()}`, { waitUntil: "load" });
      return page.getByRole("region", { name: "Отправка сообщений" });
    };
    const status = async (card, text) => card.getByRole("status").filter({ hasText: text }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    async function setMode(label) {
      const card = await settings();
      await (await live(card.getByRole("button", { name: label, exact: true }))).click();
      await card.locator('button[aria-pressed="true"]', { hasText: label }).waitFor({ timeout: 15000 });
      return card;
    }

    // 1. Карточка владельца, режим по умолчанию — «Выключено»; тик его не трогает
    await adminLogin(page);
    let card = await settings();
    check("карточка «Отправка сообщений» видна владельцу", await card.isVisible().catch(() => false));
    check("режим по умолчанию — «Выключено»", (await card.locator('button[aria-pressed="true"]').innerText().catch(() => "")) === "Выключено");
    check("по умолчанию: «только на номера из списка» включено, порог 6 ч", (await card.getByRole("checkbox").isChecked()) && (await card.getByLabel("Порог по возрасту, часов").inputValue()) === "6");
    const off = await tick();
    check("выключен — в ответе тика нет sender", !("sender" in off.done) && !("sender" in off.dry), JSON.stringify({ done: off.done, dry: off.dry }));

    // 2. Данные: сообщение заявки A и расстановка крайних случаев через базу
    const [A1] = await db.outbox.findMany({ where: { bookingId: A.id, status: "PENDING" } });
    if (!A1) throw new Error(`у заявки №${lead.number} нет сообщения в очереди (статус ${A.status})`);
    equal("заявка с выбранным Telegram встала в очередь с каналом Telegram", A1.channel, "TELEGRAM");

    const board = await db.board.findUniqueOrThrow({ where: { kind: "PARKING" } });
    const day = (n) => new Date(`${isoPlus(n)}T00:00:00.000Z`);
    async function booking(phone, name) {
      const client = phone ? await db.client.create({ data: { phone, name, messenger: "WHATSAPP", channels: ["WHATSAPP"] } }) : null;
      return db.booking.create({ data: { boardId: board.id, kind: "PARKING", status: "NEW", clientId: client?.id ?? null, contactPhone: phone, contactName: name, vehicleType: "CAR", plate: testPlate(), dateFrom: day(20), dateTo: day(22), days: 3, amount: 1050, source: "CALL" } });
    }
    const msg = (b, tag, over = {}) => db.outbox.create({ data: { bookingId: b.id, clientId: b.clientId, channel: "WHATSAPP", templateCode: "e2e_probe", renderedText: `E2E ${tag}: проверка отправщика`, dedupKey: `e2e-f4:${tag}:${b.id}`, scheduledAt: new Date(Date.now() - 60_000), ...over } });
    const phoneC = `+7${testPhone()}`;
    const C = await booking(phoneC, "E2E Не в списке");
    const N = await booking(null, "E2E Без телефона");
    const Aold = await msg(A, "old", { scheduledAt: new Date(Date.now() - 48 * 3_600_000) });
    const C1 = await msg(C, "c1");
    const N1 = await msg(N, "n1");
    const Afut = await msg(A, "future", { scheduledAt: new Date(Date.now() + 3_600_000) });

    // 3. Провайдер — заглушка, список разрешённых — номер A
    card = await settings();
    await (await live(card.getByLabel("Провайдер"))).selectOption("fake");
    check("провайдер «Заглушка» сохранён", await status(card, "Провайдер сохранён"));
    card = await settings();
    await live(card.getByLabel("Разрешённые номера"));
    await fillReliably(card.getByLabel("Разрешённые номера"), phoneA.replace("+7", "8 "));
    await card.getByRole("button", { name: "Сохранить", exact: true }).click();
    check("список разрешённых сохранён («8 …» → E.164)", await status(card, "Предохранители сохранены"));
    equal("в базе список — номер A в E.164", JSON.stringify(await setting("sender.allowlist")), JSON.stringify([phoneA]));

    // 4. «Пробно»: в базе ничего не меняется, в ответе и журнале карточки — «ушло бы»
    await setMode("Пробно");
    const dry = await tick();
    equal("пробно: в ответе тика dry.sender = 1", dry.dry.sender, 1);
    const a1dry = await row(A1.id);
    check("пробно: запись не тронута (PENDING, попыток 0, без аренды и причины)", a1dry.status === "PENDING" && a1dry.attempts === 0 && !a1dry.lockedUntil && !a1dry.lastError);
    check("пробно: старая и без получателя тоже не тронуты", (await row(Aold.id)).status === "PENDING" && (await row(N1.id)).status === "PENDING");
    card = await settings();
    const journal = nb(await card.getByTestId("sender-dry").innerText().catch(() => ""));
    check("пробно: в журнале карточки «ушло бы» по брони A", journal.includes(`№${A.number}`) && /ушло бы 1/i.test(journal) && journal.includes("устарело"), journal.slice(0, 200));

    // 5. «Включено»: A уходит через заглушку, старое — устарело, без получателя — пропущено, вне списка — ждёт
    await setMode("Включено");
    const on = await tick();
    equal("вкл: в ответе тика done.sender = 1", on.done.sender, 1);
    const a1 = await row(A1.id);
    equal("A: статус SENT", a1.status, "SENT");
    equal("A: providerMessageId от заглушки, первый вызов", a1.providerMessageId, `fake-${A1.id}-1`);
    check("A: sentAt записан, аренда снята", !!a1.sentAt && !a1.lockedUntil);
    equal("старое (48 ч от scheduledAt): EXPIRED", (await row(Aold.id)).status, "EXPIRED");
    const n1 = await row(N1.id);
    check("без получателя: SKIPPED «нет получателя»", n1.status === "SKIPPED" && n1.lastError === "нет получателя", `${n1.status} ${n1.lastError}`);
    const c1 = await row(C1.id);
    check("вне списка: остаётся PENDING с причиной, попытка не потрачена", c1.status === "PENDING" && c1.attempts === 0 && /не в списке разрешённых/.test(c1.lastError ?? "") && !!c1.nextAttemptAt, `${c1.status} ${c1.attempts} ${c1.lastError}`);
    equal("список разрешённых ограничивает — messaging.senderEnabled = false", await setting("messaging.senderEnabled"), false);
    const fut = await row(Afut.id);
    check("назначенное через час не тронуто (сдвиг пояса поймался бы здесь)", fut.status === "PENDING" && fut.attempts === 0 && !fut.lastError && !fut.lockedUntil && !fut.sendingAt, `${fut.status} ${fut.attempts} ${fut.lastError}`);

    await page.goto(`${BASE}/admin/bookings/${A.id}`, { waitUntil: "load" });
    const itemA = page.getByTestId("outbox-item").filter({ has: page.getByTestId("outbox-code").filter({ hasText: A1.templateCode }) });
    const capA = nb(await itemA.getByTestId("outbox-status").innerText().catch(() => ""));
    equal("карточка брони: «отправлено» и время по Москве", capA, `отправлено ${msk(a1.sentAt)}`);
    check("карточка брони: код правила и канал по-русски", nb(await itemA.innerText()).includes(A1.templateCode) && nb(await itemA.innerText()).includes("Telegram"));
    equal("карточка брони: старое — «устарело, не отправлено»", nb(await page.getByTestId("outbox-item").filter({ hasText: "E2E old" }).getByTestId("outbox-status").innerText()), "устарело, не отправлено");
    const feed = nb(await page.locator("aside", { has: page.locator("h2", { hasText: "История" }) }).innerText());
    check("лента брони: исходящее сообщение записано", feed.includes(`Отправлено клиенту в Telegram: ${A1.templateCode}`));
    await page.goto(`${BASE}/admin/bookings/${N.id}`, { waitUntil: "load" });
    equal("карточка брони без телефона: «пропущено: нет получателя»", nb(await page.getByTestId("outbox-status").first().innerText()), "пропущено: нет получателя");
    await page.goto(`${BASE}/admin/bookings/${C.id}`, { waitUntil: "load" });
    equal("карточка брони вне списка: причина и время по Москве", nb(await page.getByTestId("outbox-status").first().innerText()), `запланировано ${msk(c1.scheduledAt)} · не отправлено: номер не в списке разрешённых (режим теста)`);

    // 6. Двойной тик: второй отправки нет
    const pair = await Promise.all([fetch(`${BASE}/api/cron/automations`, { method: "POST", headers: { "X-Cron-Secret": secret } }).then((r) => r.json()), fetch(`${BASE}/api/cron/automations`, { method: "POST", headers: { "X-Cron-Secret": secret } }).then((r) => r.json())]);
    const again = await tick();
    check("два тика разом и третий следом — ни одной новой отправки", pair.every((p) => !p.done?.sender) && !again.done.sender, JSON.stringify([...pair.map((p) => p.done), again.done]));
    equal("A: providerMessageId тот же (заглушку не звали второй раз)", (await row(A1.id)).providerMessageId, `fake-${A1.id}-1`);
    equal("A: в ленте одна исходящая", await db.interaction.count({ where: { bookingId: A.id, type: "MESSAGE", direction: "OUT" } }), 1);

    // 7. Чужая аренда (второй процесс шлёт прямо сейчас) — не трогаем. Процесс упал: переданная адаптеру —
    // «статус неизвестен» без повтора; не дошедшая до адаптера — назад в очередь и уходит обычным путём
    const L = await msg(A, "lease", { lockedUntil: new Date(Date.now() + 5 * 60_000), sendingAt: new Date(), attempts: 1 });
    await tick();
    const l1 = await row(L.id);
    check("чужая аренда: запись не тронута", l1.status === "PENDING" && l1.attempts === 1 && !l1.providerMessageId);
    await db.outbox.update({ where: { id: L.id }, data: { lockedUntil: new Date(Date.now() - 60_000) } });
    const L2 = await msg(C, "lease-idle", { lockedUntil: new Date(Date.now() - 60_000), scheduledAt: new Date(Date.now() - 120_000) });
    await put("sender.allowlist", [phoneA, phoneC]);
    const noticesBefore = await db.adminNotice.count({ where: { kind: "MESSAGE_FAILED", bookingId: A.id } });
    const crash = await tick();
    const l2 = await row(L.id);
    check("упал после передачи адаптеру: FAILED «статус неизвестен», повторно не отправлено", l2.status === "FAILED" && /^статус отправки неизвестен/.test(l2.lastError ?? "") && !l2.providerMessageId && !l2.lockedUntil && !l2.sendingAt, `${l2.status} ${l2.lastError}`);
    const lastNotice = await db.adminNotice.findFirst({ where: { kind: "MESSAGE_FAILED", bookingId: A.id }, orderBy: { createdAt: "desc" } });
    check("упал после передачи: уведомление «проверьте переписку», а не «не доставлено»", (await db.adminNotice.count({ where: { kind: "MESSAGE_FAILED", bookingId: A.id } })) === noticesBefore + 1 && /Проверьте переписку/.test(lastNotice?.text ?? "") && !/не доставлено/.test(lastNotice?.text ?? ""), lastNotice?.text);
    const l3 = await row(L2.id);
    check("упал до передачи адаптеру: запись вернулась в очередь и ушла одна", l3.status === "SENT" && l3.providerMessageId === `fake-${L2.id}-1` && l3.attempts === 1 && crash.done.sender === 1, `${l3.status} ${l3.providerMessageId} ${l3.attempts} ${JSON.stringify(crash.done)}`);
    await put("sender.allowlist", [phoneA]);
    await page.goto(`${BASE}/admin/bookings/${A.id}`, { waitUntil: "load" });
    equal("карточка: «статус неизвестен — проверьте переписку»", nb(await page.getByTestId("outbox-item").filter({ hasText: "E2E lease:" }).getByTestId("outbox-status").innerText()), "статус отправки неизвестен: сбой во время отправки — проверьте переписку с клиентом");

    // 8. Сбой сети — повтор с паузой; отказ провайдера — FAILED и «позвоните клиенту»
    await put("messaging.fakeMode", "fail");
    const F = await msg(A, "fail");
    await tick();
    const f1 = await row(F.id);
    const wait = f1.nextAttemptAt ? f1.nextAttemptAt.getTime() - Date.now() : 0;
    check("сбой сети: PENDING, попыток 1, повтор примерно через минуту", f1.status === "PENDING" && f1.attempts === 1 && wait > 20_000 && wait <= 61_000 && /FAKE_NETWORK/.test(f1.lastError ?? ""), `${f1.status} ${f1.attempts} ${wait} ${f1.lastError}`);
    equal("сбой сети: счётчик сбоев канала 1", await setting("sender.failStreak"), 1);
    await put("messaging.fakeMode", "bad");
    const B = await msg(A, "bad");
    await tick();
    const b1 = await row(B.id);
    check("отказ провайдера: FAILED без повтора", b1.status === "FAILED" && b1.attempts === 1 && /FAKE_BAD_CONTACT/.test(b1.lastError ?? ""), `${b1.status} ${b1.lastError}`);
    const notice = await db.adminNotice.findFirst({ where: { kind: "MESSAGE_FAILED", bookingId: A.id }, orderBy: { createdAt: "desc" } });
    check("отказ провайдера: уведомление «позвоните клиенту»", !!notice && notice.text.includes(`№${A.number}`) && /Позвоните клиенту/.test(notice.text), notice?.text);
    await page.goto(`${BASE}/admin/bookings/${A.id}`, { waitUntil: "load" });
    check("карточка: повтор — причина, попытки и время повтора", /^запланировано .+ · не отправлено: FAKE_NETWORK: заглушка: сбой сети, попыток 1, повтор .+/.test(nb(await page.getByTestId("outbox-item").filter({ hasText: "E2E fail" }).getByTestId("outbox-status").innerText())));
    equal("карточка: отказ — «не доставлено: причина, попыток 1»", nb(await page.getByTestId("outbox-item").filter({ hasText: "E2E bad" }).getByTestId("outbox-status").innerText()), "не доставлено: FAKE_BAD_CONTACT: заглушка: номера нет в мессенджере, попыток 1");

    // 8а. Адаптер не ответил в срок — запрос мог уйти: «статус неизвестен», без повтора, в счётчик сбоев канала
    await put("messaging.fakeMode", "slow");
    await put("sender.timeoutMs", 1000);
    const T = await msg(A, "timeout");
    await tick();
    const t1 = await row(T.id);
    check("таймаут (адаптер оборвал по сроку и просит повтор): FAILED «статус неизвестен», без повтора", t1.status === "FAILED" && t1.lastError === "статус отправки неизвестен: нет ответа за 1 с (FAKE_TIMEOUT)" && !t1.nextAttemptAt && !t1.lockedUntil, `${t1.status} ${t1.lastError}`);
    equal("таймаут: счётчик сбоев канала 2", await setting("sender.failStreak"), 2);
    await db.setting.delete({ where: { key: "sender.timeoutMs" } });

    // 9. «Убрать устаревшие из очереди»: только своё устаревшее (чужое запарковано), повтор ничего не ломает
    const S = await msg(A, "stale", { scheduledAt: new Date(Date.now() - 30 * 3_600_000) });
    card = await settings();
    const clean = await live(card.getByRole("button", { name: /Убрать устаревшие из очереди \(1\)/ }));
    await clean.click();
    check("кнопка: «Убрано из очереди: 1»", await status(card, "Убрано из очереди: 1"));
    const s1 = await row(S.id);
    check("устаревшее убрано: EXPIRED, клиенту ничего не ушло", s1.status === "EXPIRED" && !s1.sentAt && !s1.providerMessageId);
    card = await settings();
    check("после уборки кнопка неактивна (0)", await card.getByRole("button", { name: /Убрать устаревшие из очереди \(0\)/ }).isDisabled());

    // 10. Список выключен — уходит всем; senderEnabled = true (реальному клиенту дойдёт)
    await put("messaging.fakeMode", "ok");
    await db.outbox.update({ where: { id: F.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } }); // пауза повтора прошла
    card = await settings();
    await (await live(card.getByRole("checkbox"))).uncheck();
    await card.getByRole("button", { name: "Сохранить", exact: true }).click();
    check("«только из списка» выключено и сохранено", await status(card, "Предохранители сохранены"));
    const open = await tick();
    check("без ограничения: ушли C и повтор A (разные клиенты — оба в проходе)", open.done.sender === 2 && (await row(C1.id)).status === "SENT" && (await row(F.id)).status === "SENT", JSON.stringify(open.done));
    equal("messaging.senderEnabled = true", await setting("messaging.senderEnabled"), true);
    equal("успех обнулил счётчик сбоев", await setting("sender.failStreak"), 0);
    card = await settings();
    check("карточка: «Включено · отправляет через «Заглушка…»»", /Включено · отправляет через «Заглушка/.test(nb(await card.getByTestId("sender-state").innerText())));

    // 10а. Бюджет прохода: не успевшая запись возвращается в очередь без траты попытки
    await put("messaging.fakeMode", "slow");
    await put("sender.budgetMs", 1000);
    const BA = await msg(A, "budget-a", { scheduledAt: new Date(Date.now() - 120_000) });
    const BC = await msg(C, "budget-c");
    const budget = await tick();
    const ba = await row(BA.id);
    const bc = await row(BC.id);
    check("бюджет: первая ушла, вторая в очереди — PENDING, попыток 0, без аренды и отметки передачи", budget.done.sender === 1 && ba.status === "SENT" && bc.status === "PENDING" && bc.attempts === 0 && !bc.lockedUntil && !bc.sendingAt, `${JSON.stringify(budget.done)} ${ba.status} ${bc.status} ${bc.attempts}`);
    await db.setting.delete({ where: { key: "sender.budgetMs" } });
    await db.outbox.update({ where: { id: BC.id }, data: { status: "CANCELLED" } });

    // 10б. Бронь отменили, пока сообщение отправлялось: ушло — значит SENT (правда); оживили — запись не трогаем
    const X = await msg(A, "cancel-in-flight");
    let p = tick();
    await sleep(1200);
    await db.outbox.update({ where: { id: X.id }, data: { status: "CANCELLED" } });
    await p;
    const x1 = await row(X.id);
    check("отмена во время отправки: сообщение ушло — SENT с id провайдера", x1.status === "SENT" && x1.providerMessageId === `fake-${X.id}-1`, `${x1.status} ${x1.providerMessageId}`);
    const Y = await msg(C, "revive-in-flight");
    p = tick();
    await sleep(1200);
    await db.outbox.update({ where: { id: Y.id }, data: { status: "PENDING", lockedUntil: null, sendingAt: null, attempts: 0, providerMessageId: null, renderedText: "E2E revive-in-flight: новый текст" } });
    await p;
    const y1 = await row(Y.id);
    check("оживили во время отправки: ожившая запись не помечена SENT старой отправкой", y1.status === "PENDING" && !y1.providerMessageId && y1.attempts === 0 && !y1.sentAt, `${y1.status} ${y1.providerMessageId} ${y1.attempts}`);
    await db.outbox.update({ where: { id: Y.id }, data: { status: "CANCELLED" } });

    // 11. Самоотключение после серии сбоев канала: режим «выкл» слиянием, чужой ключ карты цел, CHANNEL_DOWN
    await put("messaging.fakeMode", "fail");
    await put("sender.stopAfterFails", 2);
    await msg(A, "stop-a");
    await msg(C, "stop-c");
    await tick();
    const modes = await setting("scheduler.scans");
    check("самоотключение: sender = off, чужой режим в карте сохранён", modes?.sender === "off" && modes?.e2e_probe === "dry", JSON.stringify(modes));
    equal("самоотключение: messaging.senderEnabled = false", await setting("messaging.senderEnabled"), false);
    check("самоотключение: уведомление CHANNEL_DOWN", (await db.adminNotice.count({ where: { kind: "CHANNEL_DOWN", createdAt: { gte: T0 }, text: { contains: "Отправка сообщений клиентам остановлена" } } })) === 1);
    card = await settings();
    check("карточка после самоотключения — «Выключено»", (await card.locator('button[aria-pressed="true"]').innerText()) === "Выключено");
    const afterOff = await tick();
    check("выключен — следующий тик отправщик не запускает", !("sender" in afterOff.done));

    // 12. Строгое время: «25:00» в заявке мимо формы — понятный отказ
    const bad = await fetch(`${BASE}/api/public/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ dateFrom: isoPlus(20), dateTo: isoPlus(22), timeFrom: "25:00", vehicleType: "car", phone: testPhone(), dial: "+7", website: "", ts: Date.now() - 5000 }),
    });
    const badBody = await bad.json().catch(() => ({}));
    check("заявка с «25:00» — 400 и «ЧЧ:ММ» в ответе", bad.status === 400 && /ЧЧ:ММ/.test(badBody.error ?? ""), `${bad.status} ${badBody.error}`);
    // 13. Оживление отменённой записи (dispatcher: отменённое ключ не держит) — та же запись снова в очереди, следы прошлых попыток сброшены
    const answer = (d) => d.accept("e2e отмена").catch(() => {});
    page.on("dialog", answer);
    const bookingStatus = async () => (await db.booking.findUniqueOrThrow({ where: { id: A.id } })).status;
    const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(300); } return null; };
    await page.goto(`${BASE}/admin/bookings/${A.id}`, { waitUntil: "load" });
    await (await live(page.getByRole("button", { name: "Подтвердить место", exact: true }))).click();
    const conf = await until(() => db.outbox.findUnique({ where: { dedupKey: `confirmation:${A.id}` } }));
    check("«Подтвердить место» — подтверждение встало в очередь", conf?.status === "PENDING", conf?.status);
    await db.outbox.update({ where: { id: conf.id }, data: { attempts: 2, nextAttemptAt: new Date(Date.now() + 3_600_000), lastError: "NET: e2e", providerMessageId: `e2e-old-${conf.id}` } });
    await page.goto(`${BASE}/admin/bookings/${A.id}`, { waitUntil: "load" });
    await (await live(page.getByRole("button", { name: "Отменить", exact: true }))).click();
    check("отмена брони — запись очереди CANCELLED", !!(await until(async () => (await row(conf.id)).status === "CANCELLED")));
    await page.goto(`${BASE}/admin/bookings/${A.id}`, { waitUntil: "load" });
    const form = page.locator("form", { has: page.getByLabel("Новый статус") });
    const openBtn = await live(page.getByRole("button", { name: /Исправить статус/ }));
    for (let i = 0; i < 4 && !(await form.isVisible().catch(() => false)); i++) { await openBtn.click().catch(() => {}); await form.waitFor({ timeout: 3000 }).catch(() => {}); }
    await form.getByLabel("Новый статус").selectOption({ label: "Новая заявка" });
    await fillReliably(form.getByLabel("Причина"), "e2e: вернуть для проверки оживления");
    await form.getByRole("button", { name: "Исправить", exact: true }).click();
    check("владелец вернул бронь в «Новая заявка»", !!(await until(async () => (await bookingStatus()) === "NEW")));
    await page.goto(`${BASE}/admin/bookings/${A.id}`, { waitUntil: "load" });
    await (await live(page.getByRole("button", { name: "Подтвердить место", exact: true }))).click();
    const revived = await until(async () => { const r = await row(conf.id); return r.status === "PENDING" ? r : null; });
    check("повторное «Подтвердить место» оживило ту же запись", !!revived && revived.id === conf.id);
    check("оживлённая: попытки, пауза, ошибка и id провайдера сброшены", !!revived && revived.attempts === 0 && !revived.nextAttemptAt && !revived.lastError && !revived.providerMessageId, JSON.stringify(revived && { a: revived.attempts, n: revived.nextAttemptAt, e: revived.lastError, p: revived.providerMessageId }));
    equal("подтверждение по брони одно (ключ confirmation)", await db.outbox.count({ where: { bookingId: A.id, dedupKey: `confirmation:${A.id}` } }), 1);
    page.off("dialog", answer);
  } finally {
    // Вернуть настройки и чужие записи как были; уведомление о самоотключении — тестовое
    await db.setting.deleteMany({ where: { key: { in: KEYS } } }).catch(() => {});
    for (const s of saved) await put(s.key, s.value).catch(() => {});
    for (const p of parked) await db.outbox.updateMany({ where: { id: p.id, status: "PENDING" }, data: { scheduledAt: p.scheduledAt } }).catch(() => {});
    await db.adminNotice.deleteMany({ where: { kind: "CHANNEL_DOWN", createdAt: { gte: T0 }, text: { contains: "Отправка сообщений клиентам остановлена" } } }).catch(() => {});
    await db.$disconnect();
  }
  finish("Отправщик");
});
