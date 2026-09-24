// Перестой, Ф2б (docs/phases/PHASE_02_OVERSTAY.md §4.6–4.8, §7 п. 11–15): скан «Перестой» в режимах «пробно» и «вкл»,
// одно уведомление на бронь и дату выезда, само закрытие после выезда, «Машина выехала, не оплачено N ₽» без дублей,
// колокольчик (опрос раз в минуту, «Прочитано» гасит только показанные), /api/admin/notices только владельцу и администратору,
// режимы сканов в карточке «Планировщик» (только владелец, журнал). Режим скана запоминается и возвращается в finally.
// Вход владельцем; тик — POST /api/cron/automations с секретом (--secret, E2E_CRON_SECRET или CRON_SECRET из .env).
// «Прочитано» гасит все показанные уведомления — на stage этот шаг пропускается (иначе погасит настоящие); включить: E2E_READ=1.
// Не запускать с 00:00 до 01:00 МСК — перестоя ещё нет (льготный час).
import { BASE, withBrowser, adminLogin, check, equal, finish, testPhone, testPlate, moscowPlus, fillReliably, cronSecret } from "./lib.mjs";

const secret = cronSecret();
const from = moscowPlus(-2);
const to = moscowPlus(-1);
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) || process.env.E2E_READ === "1";
const PASS = {
  admin: process.env.E2E_ADMIN_PASSWORD ?? "admin12345",
  guard: process.env.E2E_GUARD_PASSWORD ?? "guard12345",
  driver: process.env.E2E_DRIVER_PASSWORD ?? "driver12345",
  parker: process.env.E2E_PARKER_PASSWORD ?? "parker12345",
};
const MODE_LABEL = { off: "Выкл", dry: "Пробно", on: "Вкл" };
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// На stage таймерный тик того же процесса может ответить раньше: «занят» повторяем
async function tick() {
  for (let i = 0; i < 15; i++) {
    const res = await fetch(`${BASE}/api/cron/automations`, { method: "POST", headers: { "X-Cron-Secret": secret } });
    const body = res.status === 200 ? await res.json() : null;
    if (body && !body.busy) return body;
    await sleep(2000);
  }
  throw new Error("тик всё время занят");
}

await withBrowser(async (page) => {
  console.log(`\nПерестой, уведомления (Ф2б): ${BASE}, заезд ${from}, выезд ${to}`);
  if (!secret) throw new Error("нет секрета: --secret, E2E_CRON_SECRET или CRON_SECRET в .env");
  await adminLogin(page);
  const ctx = page.context();
  const acceptDialogs = (p) => p.on("dialog", (d) => d.accept().catch(() => {}));
  acceptDialogs(page);
  const body = async (p = page) => nb(await p.locator("body").innerText());

  async function live(locator) {
    await locator.waitFor({ timeout: 20000 });
    for (let i = 0; i < 100 && !(await locator.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactProps"))).catch(() => false)); i++) await locator.page().waitForTimeout(150);
    return locator;
  }

  async function createQuick(name, plate) {
    await page.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    const drawer = page.getByRole("dialog", { name: "Новая заявка" });
    await page.locator("header").getByRole("button", { name: /Новая заявка/i }).click();
    if (!(await drawer.isVisible().catch(() => false))) {
      await page.waitForTimeout(1500);
      await page.keyboard.press("n");
    }
    await drawer.waitFor({ timeout: 15000 });
    await fillReliably(drawer.getByPlaceholder("+7 9xx xxx-xx-xx"), testPhone());
    await fillReliably(drawer.getByPlaceholder("Имя (необязательно)"), name);
    await fillReliably(drawer.getByLabel("Заезд", { exact: true }), from);
    await fillReliably(drawer.getByLabel("Выезд", { exact: true }), to);
    await fillReliably(drawer.getByPlaceholder("Госномер: А123ВС77"), plate);
    await page.waitForTimeout(800);
    await drawer.getByRole("button", { name: /^Создать$/ }).click();
    const toastLink = page.getByRole("link", { name: "открыть" });
    await toastLink.waitFor({ timeout: 15000 });
    await toastLink.click();
    await page.waitForURL(/\/admin\/bookings\//, { timeout: 15000 });
    return page.url();
  }

  async function pay(amount) {
    await page.getByRole("button", { name: "Принять оплату" }).click();
    await page.getByLabel("Сумма").fill(String(amount));
    await page.locator("form select").first().selectOption({ label: "Наличные" });
    await page.getByRole("button", { name: "Провести" }).click();
    await page.waitForTimeout(1500);
  }

  async function move(p, verb) {
    await (await live(p.getByRole("button", { name: verb, exact: true }).first())).click();
    await p.waitForTimeout(1500);
  }

  async function correct(p, status, reason) {
    await p.getByRole("button", { name: /Исправить статус/ }).click();
    const form = p.locator("form", { has: p.getByLabel("Новый статус") });
    await form.getByLabel("Новый статус").selectOption({ label: status });
    await p.waitForTimeout(200);
    await form.getByLabel("Причина").fill(reason);
    await form.getByRole("button", { name: "Исправить", exact: true }).click();
    await p.waitForTimeout(1500);
  }

  const scanRow = () => page.getByTestId("scan-overstay");
  async function openSettings() {
    await page.goto(`${BASE}/admin/settings?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await scanRow().waitFor({ timeout: 15000 });
  }
  async function currentMode() {
    await openSettings();
    for (const [mode, label] of Object.entries(MODE_LABEL)) {
      if ((await scanRow().getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed")) === "true") return mode;
    }
    return "off";
  }
  async function setMode(mode) {
    await openSettings();
    const btn = scanRow().getByRole("button", { name: MODE_LABEL[mode], exact: true });
    if ((await btn.getAttribute("aria-pressed")) === "true") return;
    await (await live(btn)).click();
    await scanRow().locator(`button[aria-pressed="true"]`, { hasText: MODE_LABEL[mode] }).waitFor({ timeout: 15000 });
  }

  const notices = async (p = page) => {
    const res = await p.request.get(`${BASE}/api/admin/notices`, { headers: { "Cache-Control": "no-cache" } });
    return res.ok() ? (await res.json()).notices : [];
  };
  const bookingId = (url) => url.split("/admin/bookings/")[1].split(/[?#]/)[0];
  const of = (list, id, kind) => list.filter((n) => n.bookingId === id && n.kind === kind);
  const count = (s, re) => (s.match(re) ?? []).length;
  const FEED = /Перестой с [^:]+: машина на парковке после даты выезда\. Уведомлён администратор/g;

  // ── Доступ к /api/admin/notices: без входа 401, полевые роли и охрана 403, администратор 200 ──
  const anon = await fetch(`${BASE}/api/admin/notices`);
  equal("API колокольчика без входа — 401", anon.status, 401);
  for (const [login, expected] of [["guard", 403], ["driver", 403], ["parker", 403], ["admin", 200]]) {
    const c = await ctx.browser().newContext();
    const p = await c.newPage();
    await p.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
    await p.fill('input[name="login"]', login);
    await p.fill('input[name="password"]', PASS[login]);
    await Promise.all([p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }), p.click('button[type="submit"]')]);
    const res = await p.request.get(`${BASE}/api/admin/notices`);
    equal(`API колокольчика: ${login} — ${expected}`, res.status(), expected);
    if (login === "admin") {
      await p.goto(`${BASE}/admin/settings`, { waitUntil: "domcontentloaded" });
      check("администратор: карточки режимов сканов нет (настройки — только владелец)", !(await p.getByTestId("scan-overstay").isVisible().catch(() => false)));
    }
    await c.close();
  }

  const original = await currentMode();
  console.log(`  режим скана до теста: ${original}`);
  try {
    // ── «Пробно»: скан считает, но ничего не создаёт ──
    await setMode("dry");
    check("режим «Пробно» отмечен в карточке", (await scanRow().getByRole("button", { name: "Пробно", exact: true }).getAttribute("aria-pressed")) === "true");

    const plate = testPlate();
    const urlA = await createQuick("E2E Ф2б А", plate);
    const idA = bookingId(urlA);
    console.log(`  А: ${urlA}`);
    await pay(700);
    await move(page, "Заехал");
    check("А: в перестое", /ПЕРЕСТОЙ · 1 сут\./.test(await body()));

    const dry = await tick();
    check("пробно: в результате тика dry.overstay ≥ 1", (dry.dry?.overstay ?? 0) >= 1, JSON.stringify(dry.dry));
    check("пробно: в done скана нет", !("overstay" in (dry.done ?? {})));
    equal("пробно: уведомления о брони А нет", of(await notices(), idA, "OVERSTAY").length, 0);
    await page.goto(urlA, { waitUntil: "domcontentloaded" });
    equal("пробно: строки в ленте нет", count(await body(), FEED), 0);
    await openSettings();
    check("пробно: итог в карточке «было бы: N»", /пробно, в последнем тике было бы: \d+/.test(nb(await scanRow().innerText())), nb(await scanRow().innerText()));

    // Вкладка колокольчика с управляемыми часами: опрос раз в минуту проверяется перемоткой, а не минутой ожидания
    const bell = await ctx.newPage();
    acceptDialogs(bell);
    await bell.clock.install();
    await bell.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    const bellBtn = bell.locator("header").getByRole("button", { name: /Уведомлени/ });
    await live(bellBtn);
    await bell.clock.pauseAt(Date.now() + 2000);
    const label = async () => Number((await bellBtn.getAttribute("aria-label"))?.match(/\d+/)?.[0] ?? 0);
    const before = await label();

    // ── «Вкл»: одно уведомление и одна строка в ленте ──
    await setMode("on");
    const on = await tick();
    check("вкл: скан отработал (done.overstay есть)", "overstay" in (on.done ?? {}), JSON.stringify(on));
    const afterOn = await notices();
    const mine = of(afterOn, idA, "OVERSTAY");
    equal("вкл: у брони А одно уведомление о перестое", mine.length, 1);
    check("вкл: текст «Перестой: бронь №…, <госномер> — выезд был …, машина на парковке. Выясните причину и освободите место»",
      new RegExp(`^Перестой: бронь №\\d+, ${plate} — выезд был .+, машина на парковке\\. Выясните причину и освободите место$`).test(nb(mine[0]?.text)), mine[0]?.text);
    // Время — по Москве с сервера (тест бежит в Джакарте: при времени браузера было бы +4 ч)
    const msk = [-2, -1, 0, 1].map((m) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.now() + m * 60_000)));
    check("вкл: время уведомления — строкой по Москве", msk.some((t) => nb(mine[0]?.at).endsWith(t)), `${mine[0]?.at} / ${msk.join(",")}`);
    await page.goto(urlA, { waitUntil: "domcontentloaded" });
    const feedOn = await body();
    equal("вкл: в ленте брони одна строка «Перестой с …: … Уведомлён администратор»", count(feedOn, FEED), 1);
    check("вкл: строка ленты без автора подписана «автоматически»", /Уведомлён администратор\s+\d{1,2} \S+ \d{2}:\d{2} · автоматически/.test(feedOn));

    // ── Колокольчик: опрос через минуту без перезагрузки ──
    const polled = bell.waitForResponse((r) => r.url().includes("/api/admin/notices"), { timeout: 20000 });
    await bell.clock.runFor(61_000);
    check("колокольчик: опрос ушёл по минутному таймеру", !!(await polled.catch(() => null)));
    await bell.waitForTimeout(500);
    const after = await label();
    equal("колокольчик: через минуту бейдж равен числу непрочитанных (без перезагрузки)", after, Math.min(afterOn.length, 20));
    if (before < 20) check("колокольчик: бейдж вырос", after > before, `${before} → ${after}`);

    // ── Повторный тик: второго уведомления нет ──
    const again = await tick();
    // Общий счётчик — только локально: на stage настоящая бронь может уйти в перестой посреди прогона
    if (LOCAL) equal("повторный тик: новых уведомлений 0", again.done?.overstay ?? 0, 0);
    equal("повторный тик: у брони А по-прежнему одно уведомление", of(await notices(), idA, "OVERSTAY").length, 1);
    await page.goto(urlA, { waitUntil: "domcontentloaded" });
    equal("повторный тик: строка в ленте одна", count(await body(), FEED), 1);

    // ── Панель открыта до выезда: в ней уведомление о перестое ──
    await bellBtn.click();
    const panel = bell.getByRole("region", { name: "Уведомления" });
    await panel.getByText(mine[0].text).waitFor({ timeout: 15000 });
    check("панель: уведомление о перестое брони А видно", true);

    // ── Выезд с долгом: «не оплачено 350 ₽» сразу ──
    await page.goto(urlA, { waitUntil: "domcontentloaded" });
    await move(page, "Выехал");
    check("А: «Выехал», не хватает 350 ₽", /не хватает 350 ₽/.test(await body()));
    const unpaid = of(await notices(), idA, "UNPAID_CHECKOUT");
    equal("выезд: одно уведомление «не оплачено»", unpaid.length, 1);
    check("выезд: текст «Машина выехала, не оплачено 350 ₽ — бронь №…, <госномер>»", new RegExp(`^Машина выехала, не оплачено 350 ₽ — бронь №\\d+, ${plate}$`).test(nb(unpaid[0]?.text)), unpaid[0]?.text);

    // ── Следующий тик закрывает уведомление о перестое ──
    await tick();
    const closed = await notices();
    equal("само закрытие: уведомления о перестое брони А среди непрочитанных нет", of(closed, idA, "OVERSTAY").length, 0);
    equal("само закрытие: «не оплачено» не закрыто", of(closed, idA, "UNPAID_CHECKOUT").length, 1);

    // ── «Прочитано» гасит только показанные: «не оплачено» пришло после открытия панели ──
    if (LOCAL) {
      check("панель: «не оплачено» ещё не показано (пришло после открытия)", !(await panel.getByText(unpaid[0].text).isVisible().catch(() => false)));
      await panel.getByRole("button", { name: "Прочитано" }).click();
      await panel.getByText(unpaid[0].text).waitFor({ timeout: 15000 }).catch(() => {});
      equal("«Прочитано»: «не оплачено», пришедшее после открытия панели, осталось непрочитанным", of(await notices(), idA, "UNPAID_CHECKOUT").length, 1);
      check("«Прочитано»: панель перечитала список и показывает «не оплачено»", await panel.getByText(unpaid[0].text).isVisible().catch(() => false));
    } else console.log("  (stage: шаг «Прочитано» пропущен — погасил бы настоящие уведомления; E2E_READ=1 — включить)");
    await bell.close();

    // ── «Исправить статус» обратно и повторный выезд: второго «не оплачено» нет ──
    await page.goto(urlA, { waitUntil: "domcontentloaded" });
    await correct(page, "Заехал", "e2e: отмена выезда");
    await move(page, "Выехал");
    check("А: снова «Выехал», не хватает 350 ₽", /не хватает 350 ₽/.test(await body()));
    equal("повторный выезд: «не оплачено» не задвоилось", of(await notices(), idA, "UNPAID_CHECKOUT").length, 1);
    const last = await tick();
    if (LOCAL) equal("после выезда: новых уведомлений о перестое нет", last.done?.overstay ?? 0, 0);
    equal("после выезда: у брони А нет непрочитанного уведомления о перестое", of(await notices(), idA, "OVERSTAY").length, 0);

    // ── Журнал: смена режима записана ──
    await page.goto(`${BASE}/admin/audit`, { waitUntil: "domcontentloaded" });
    const auditLines = (await body()).split("\n");
    check("журнал: смена режима «пробно → вкл» записана", auditLines.some((l) => l.includes('"scan":"overstay"') && l.includes('"before":"dry"') && l.includes('"after":"on"')));
  } finally {
    await setMode(original).catch((e) => console.error(`\n  ⚠ режим скана не возвращён (${original}): ${e.message}\n`));
  }
  equal("режим скана возвращён", await currentMode(), original);

  finish("Перестой, уведомления (Ф2б)");
});
