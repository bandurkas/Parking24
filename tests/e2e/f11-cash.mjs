// Ф11 «Касса и кассовые смены» (docs/phases/PHASE_11_CASH.md, раздел «Код»).
// Администратор открывает смену → оплаты наличными и картой, возврат наличными, сторно (владелец) → инкассация →
// выход не закрывает смену → закрытие с фактическим остатком и повторным подтверждением → снимок и расхождение.
// Вторая смена при открытой не открывается; закрытая смена не принимает инкассацию, новые платежи в неё не садятся;
// охрана и водитель кассу не видят. Входит владельцем (--login owner --password owner12345), второй контекст —
// администратор (E2E_ADMIN_PASSWORD или --admin-password, по умолчанию admin12345).
// Если в базе уже открыта смена — сценарий громко пропускается и ничего не трогает.
// Метка тестовой смены для очистки — инкассация «E2E-инкассатор» (cleanup.mjs / cleanup.sql).
import { BASE, LOGIN, PASSWORD, HEADED, arg, loadPlaywright, check, equal, finish, testPhone, testPlate, moscowPlus, fillReliably } from "./lib.mjs";

const OWNER = LOGIN === "admin" ? { login: "owner", password: process.env.E2E_OWNER_PASSWORD ?? "owner12345" } : { login: LOGIN, password: PASSWORD };
const ADMIN = { login: "admin", password: arg("admin-password", process.env.E2E_ADMIN_PASSWORD ?? (LOGIN === "admin" ? PASSWORD : "admin12345")) };
const GUARD = { login: "guard", password: process.env.E2E_GUARD_PASSWORD ?? "guard12345" };
const DRIVER = { login: "driver", password: process.env.E2E_DRIVER_PASSWORD ?? "driver12345" };
const MARK = "E2E-инкассатор";

const today = moscowPlus(0);
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");
const tag = String(Date.now()).slice(-4);

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !HEADED });

async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [ошибка страницы ${user.login}] ${e.message}`));
  await login(page, user);
  return { ctx, page };
}
async function login(page, user) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', user.login);
  await page.fill('input[name="password"]', user.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }), page.click('button[type="submit"]')]);
}

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
async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Строки отчёта смены: { «Получено наличными»: «700 ₽», … }
async function report(page) {
  const rows = await page.getByTestId("report-row").allInnerTexts();
  const out = {};
  for (const r of rows) {
    const [label, value] = nb(r).split("\n").map((s) => s.trim());
    out[label] = value;
  }
  return out;
}
const cashPage = (page) => page.goto(`${BASE}/admin/cash`, { waitUntil: "domcontentloaded" });
async function reportAfter(page, label, value) {
  let r = {};
  await waitFor(async () => {
    await cashPage(page);
    r = await report(page);
    return r[label] === value;
  }, 20000);
  return r;
}

async function createQuick(page, name) {
  await page.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
  const drawer = page.getByRole("dialog", { name: "Новая заявка" });
  await (await live(page.locator("header").getByRole("button", { name: /Новая заявка/i }))).click();
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.waitForTimeout(1500);
    await page.keyboard.press("n");
  }
  await drawer.waitFor({ timeout: 15000 });
  await fillReliably(drawer.getByPlaceholder("+7 9xx xxx-xx-xx"), testPhone());
  await fillReliably(drawer.getByPlaceholder("Имя (необязательно)"), name);
  await fillReliably(drawer.getByLabel("Заезд", { exact: true }), today);
  await fillReliably(drawer.getByLabel("Выезд", { exact: true }), moscowPlus(2));
  await fillReliably(drawer.getByPlaceholder("Госномер: А123ВС77"), testPlate());
  await page.waitForTimeout(900);
  await drawer.getByRole("button", { name: /^Создать$/ }).click();
  const toastLink = page.getByRole("link", { name: "открыть" });
  await toastLink.waitFor({ timeout: 15000 });
  await toastLink.click();
  await page.waitForURL(/\/admin\/bookings\//, { timeout: 15000 });
  const url = page.url();
  console.log(`  ${name}: ${url}`);
  return url;
}
async function payment(page, sum, method) {
  await (await live(page.getByRole("button", { name: "Принять оплату" }))).click();
  await page.getByLabel("Сумма").fill(String(sum));
  await page.getByLabel("Способ").selectOption({ label: method });
  await page.getByRole("button", { name: "Провести" }).click();
  await page.getByRole("button", { name: "Провести" }).waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}
async function refund(page, sum, reason) {
  await (await live(page.locator("button", { hasText: /^(Оформить возврат|Возврат)/ }))).click();
  await page.getByLabel("Сумма").fill(String(sum));
  await page.getByLabel("Способ").selectOption({ label: "Наличные" });
  await page.getByLabel("Причина возврата").fill(reason);
  await page.getByRole("button", { name: "Провести" }).click();
  await page.getByRole("button", { name: "Провести" }).waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function collect(page, sum) {
  await fillReliably(page.getByLabel("Сумма инкассации"), String(sum));
  await fillReliably(page.getByLabel("Кто забрал"), MARK);
  await page.getByRole("button", { name: "Провести инкассацию" }).click();
}

// Закрыть открытую смену; actual не задан — фактический = расчётный (уборка при сбое)
async function closeShift(page, actual) {
  await cashPage(page);
  const input = page.getByLabel("Фактический остаток");
  if (!(await input.count())) return false;
  const expected = Number(nb(await page.locator("#close .font-mono").first().innerText()).replace(/[^\d−-]/g, "").replace("−", "-"));
  await fillReliably(input, String(actual ?? expected));
  await (await live(page.getByRole("button", { name: "Закрыть смену", exact: true }))).click();
  await page.getByRole("button", { name: "Да, закрыть смену" }).click();
  return page.waitForURL(/\/admin\/cash\/[^/]+$/, { timeout: 15000 }).then(() => true, () => false);
}

let owner, admin, opened = false;
try {
  console.log(`\nФ11 «Касса»: ${BASE}, сегодня ${today} (МСК), владелец ${OWNER.login}, администратор ${ADMIN.login}`);
  owner = await session(OWNER);
  admin = await session(ADMIN);
  const O = owner.page;
  const A = admin.page;

  await cashPage(A);
  if (!(await A.getByTestId("no-shift").count())) {
    const r = await report(A);
    console.log(`\n  ПРОПУСК: в базе уже открыта кассовая смена (${r["Администратор"] ?? "?"}). Сценарий чужую смену не трогает.`);
    finish("Ф11 «Касса» (пропущено: открыта смена)");
  }

  // ── Меню: «Касса» — ссылка, не «скоро» ──
  const navLink = A.locator("aside").getByRole("link", { name: "Касса" });
  equal("меню: у администратора «Касса» — ссылка", await navLink.count(), 1);
  equal("меню: у владельца «Касса» — ссылка", await O.locator("aside").getByRole("link", { name: "Касса" }).count(), 1);

  // ── Открытие смены администратором ──
  await cashPage(O); // страница владельца останется со старой формой открытия
  const suggested = await A.getByLabel("Начальный остаток").inputValue();
  check("открытие: начальный остаток подставлен числом", /^\d+$/.test(suggested), suggested);
  check("открытие: видно имя администратора", /Администратор: Администратор/.test(nb(await A.getByTestId("no-shift").innerText())));
  await fillReliably(A.getByLabel("Начальный остаток"), "5000");
  await (await live(A.getByRole("button", { name: "Открыть смену" }))).click();
  await A.getByTestId("shift-report").waitFor({ timeout: 15000 });
  opened = true;
  const head = nb(await A.getByTestId("shift-report").innerText());
  const number = head.match(/Смена №(\d+)/)?.[1];
  check("открыта: «Смена №N · дата», не закрыта", !!number && / · не закрыта/.test(head), head.split("\n").slice(0, 2).join(" | "));
  let r = await report(A);
  equal("открыта: администратор", r["Администратор"], "Администратор");
  equal("открыта: остаток на начало 5 000 ₽", r["Остаток на начало смены"], "5 000 ₽");
  equal("открыта: расчётный остаток сейчас 5 000 ₽", r["Расчётный остаток сейчас"], "5 000 ₽");

  // Метка тестовой смены для очистки — сразу после открытия
  await collect(A, 1000);
  r = await reportAfter(A, "Инкассация", "1 000 ₽");
  equal("инкассация 1 000 ₽: строка «Инкассация»", r["Инкассация"], "1 000 ₽");
  equal("инкассация: расчётный остаток уменьшился до 4 000 ₽", r["Расчётный остаток сейчас"], "4 000 ₽");
  const col = nb(await A.getByTestId("collections").innerText().catch(() => ""));
  check("инкассация: время, сумма, кто забрал и кто передал", new RegExp(`\\d{2}:\\d{2} · 1 000 ₽ · забрал: ${MARK} · передал: Администратор`).test(col), col);

  // ── Вторая смена при открытой не открывается ──
  await fillReliably(O.getByLabel("Начальный остаток"), "100");
  await (await live(O.getByRole("button", { name: "Открыть смену" }))).click();
  const refused = await waitFor(async () => /уже открыта/.test(nb(await O.locator(".adm-err").first().innerText())));
  check("вторая смена: отказ «Смена №N уже открыта (Администратор, …)»", refused && new RegExp(`Смена №${number} уже открыта \\(Администратор`).test(nb(await O.locator(".adm-err").first().innerText())));
  await cashPage(O);
  check("вторая смена: у владельца та же смена №N", new RegExp(`Смена №${number} `).test(nb(await O.getByTestId("shift-report").innerText())));

  // ── Оплаты наличными и картой, возврат наличными, сторно ──
  const booking = await createQuick(O, `E2E Ф11-${tag}`);
  await payment(O, 700, "Наличные");
  r = await reportAfter(A, "Получено наличными", "700 ₽");
  equal("оплата наличными 700: «Получено наличными»", r["Получено наличными"], "700 ₽");
  equal("оплата наличными: расчётный остаток 4 700 ₽", r["Расчётный остаток сейчас"], "4 700 ₽");
  await O.goto(booking, { waitUntil: "domcontentloaded" });
  await payment(O, 350, "Карта (терминал)");
  r = await reportAfter(A, "Получено картами", "350 ₽");
  equal("оплата картой 350: «Получено картами»", r["Получено картами"], "350 ₽");
  equal("оплата картой: наличный остаток прежний 4 700 ₽", r["Расчётный остаток сейчас"], "4 700 ₽");
  await O.goto(booking, { waitUntil: "domcontentloaded" });
  await refund(O, 200, "e2e: возврат части наличными");
  r = await reportAfter(A, "Возвраты наличными", "200 ₽");
  equal("возврат наличными 200: «Возвраты наличными»", r["Возвраты наличными"], "200 ₽");
  equal("возврат наличными: расчётный остаток 4 500 ₽", r["Расчётный остаток сейчас"], "4 500 ₽");
  await O.goto(booking, { waitUntil: "domcontentloaded" });
  const cardRow = O.getByTestId("payment-row").filter({ hasText: "Карта" });
  await (await live(cardRow.getByRole("button", { name: "Сторно", exact: true }))).click();
  await fillReliably(O.getByLabel("Причина сторно"), "e2e: оплата картой не прошла");
  await O.getByRole("button", { name: "Провести сторно" }).click();
  r = await reportAfter(A, "Получено картами", "0 ₽");
  equal("сторно оплаты картой: «Получено картами» 0 ₽", r["Получено картами"], "0 ₽");
  equal("сторно не «возврат наличными»: 200 ₽", r["Возвраты наличными"], "200 ₽");
  equal("сторно картой: расчётный остаток прежний 4 500 ₽", r["Расчётный остаток сейчас"], "4 500 ₽");
  const ops = (await A.getByTestId("shift-operations").locator("li").allInnerTexts()).map((o) => nb(o).replace(/\n+/g, " "));
  equal("операции смены: 4 строки", ops.length, 4);
  check("операции: № брони, «Оплата · Наличные · Сергей Кулагин», +700", ops.some((o) => /№\d+ · Оплата · Наличные · Сергей Кулагин \+700 ₽/.test(o)), ops.join(" | "));
  check("операции: строка «Сторно · Карта (терминал)»", ops.some((o) => /Сторно · Карта \(терминал\)/.test(o)));

  // ── Экран КПП у владельца: «Выйти» при открытой смене — то же напоминание ──
  await O.goto(`${BASE}/admin/today?guard=1`, { waitUntil: "domcontentloaded" });
  await (await live(O.getByRole("button", { name: "Выйти" }))).click();
  const guardRemind = O.getByRole("dialog", { name: "Смена открыта" });
  await guardRemind.waitFor({ timeout: 10000 }).catch(() => {});
  check("экран КПП: «Выйти» — напоминание «Кассовая смена №N открыта»", new RegExp(`Кассовая смена №${number} открыта`).test(nb(await guardRemind.innerText().catch(() => ""))));
  await guardRemind.getByRole("button", { name: "Отмена" }).last().click();

  // ── Выход из аккаунта смену не закрывает ──
  await (await live(A.locator("aside").getByRole("button", { name: "Выйти" }))).click();
  const remind = A.getByRole("dialog", { name: "Смена открыта" });
  await remind.waitFor({ timeout: 10000 }).catch(() => {});
  const remindText = nb(await remind.innerText().catch(() => "")).replace(/\n+/g, " | ");
  check("выход: напоминание «Кассовая смена №N открыта»", new RegExp(`Кассовая смена №${number} открыта`).test(remindText), remindText);
  equal("выход: в напоминании ссылка «Закрыть смену»", await remind.getByRole("link", { name: "Закрыть смену" }).getAttribute("href").catch(() => null), "/admin/cash#close");
  await remind.getByRole("button", { name: "Всё равно выйти" }).click();
  await A.waitForURL(/\/admin\/login/, { timeout: 15000 });
  check("выход: «Всё равно выйти» ведёт на логин", A.url().includes("/admin/login"));
  await login(A, ADMIN);
  await cashPage(A);
  const after = nb(await A.getByTestId("shift-report").innerText().catch(() => ""));
  check("после выхода и входа смена №N открыта", new RegExp(`Смена №${number} `).test(after) && / · не закрыта/.test(after));

  // ── Закрытие: без подтверждения не закрывается; изменились суммы — отказ ──
  await fillReliably(A.getByLabel("Фактический остаток"), "4400");
  equal("закрытие: расхождение на экране −100 ₽", nb(await A.getByTestId("close-diff").innerText()).replace(/\s+/g, " ").trim(), "Расхождение −100 ₽");
  await (await live(A.getByRole("button", { name: "Закрыть смену", exact: true }))).click();
  const ask = nb(await A.getByRole("alertdialog", { name: "Подтверждение закрытия смены" }).innerText().catch(() => "")).replace(/\n+/g, " | ");
  check("закрытие: повторное подтверждение с суммами", /Расчётный 4 500 ₽, фактический 4 400 ₽, расхождение −100 ₽\. Закрыть смену\?/.test(ask), ask);
  await A.getByRole("button", { name: "Назад" }).click();
  await cashPage(A);
  check("закрытие: без подтверждения смена открыта", / · не закрыта/.test(nb(await A.getByTestId("shift-report").innerText())));

  await fillReliably(A.getByLabel("Фактический остаток"), "4400");
  await (await live(A.getByRole("button", { name: "Закрыть смену", exact: true }))).click();
  await O.goto(booking, { waitUntil: "domcontentloaded" });
  await payment(O, 100, "Наличные"); // пока у администратора открыто подтверждение
  await A.getByRole("button", { name: "Да, закрыть смену" }).click();
  const stale = await waitFor(async () => /Суммы изменились/.test(nb(await A.locator("#close .adm-err").innerText())));
  check("закрытие: суммы изменились после показа — отказ", stale);
  await cashPage(A);
  r = await report(A);
  equal("закрытие: расчётный остаток с новой оплатой 4 600 ₽", r["Расчётный остаток сейчас"], "4 600 ₽");

  await cashPage(O); // у владельца останется форма инкассации уже закрытой смены
  await O.getByLabel("Сумма инкассации").waitFor({ timeout: 15000 });
  const closed = await closeShift(A, 4500);
  check("закрытие с подтверждением: открыт отчёт смены", closed);
  opened = !closed;
  r = await report(A);
  equal("снимок: остаток на начало", r["Остаток на начало смены"], "5 000 ₽");
  equal("снимок: наличные (700 + 100)", r["Получено наличными"], "800 ₽");
  equal("снимок: карты (350 − сторно)", r["Получено картами"], "0 ₽");
  equal("снимок: возвраты наличными", r["Возвраты наличными"], "200 ₽");
  equal("снимок: инкассация", r["Инкассация"], "1 000 ₽");
  equal("снимок: расчётный остаток на конец", r["Расчётный остаток на конец смены"], "4 600 ₽");
  equal("снимок: фактический остаток", r["Фактический остаток"], "4 500 ₽");
  equal("снимок: расхождение", r["Расхождение"], "−100 ₽");
  check("снимок: смена закрыта", / · закрыта /.test(nb(await A.getByTestId("shift-report").innerText())));
  const text = nb(await A.getByTestId("report-text").textContent());
  check("текст отчёта: строки ТЗ 7.2, без «Rp»", /Администратор: Администратор/.test(text) && /Фактический остаток: 4 500 ₽/.test(text) && /Расхождение: −100 ₽/.test(text) && /забрал: E2E-инкассатор/.test(text) && !/Rp/.test(text), text.split("\n").join(" | "));
  await A.getByRole("button", { name: "Скопировать отчёт" }).click();
  check("«Скопировать отчёт»: скопировано", await waitFor(async () => /Скопировано/.test(nb(await A.getByTestId("shift-report").innerText())), 5000));
  const shiftUrl = A.url();

  // ── Расхождение — в колокольчике ──
  const notices = await O.request.get(`${BASE}/api/admin/notices`).then((x) => x.json()).catch(() => ({ notices: [] }));
  const mismatch = (notices.notices ?? []).find((n) => n.kind === "CASH_MISMATCH" && n.text.includes(`Смена №${number} `));
  check("колокольчик: «Смена №N (Администратор) закрыта с расхождением −100 ₽…»", !!mismatch && /закрыта с расхождением −100 ₽: расчётный остаток 4 600 ₽, фактический 4 500 ₽/.test(nb(mismatch.text)), nb(mismatch?.text ?? ""));

  // ── После закрытия: смены нет, подсказка — фактический остаток; закрытая смена неизменна ──
  await cashPage(A);
  check("после закрытия: «Смена не открыта»", (await A.getByTestId("no-shift").count()) === 1);
  equal("после закрытия: подсказка начального остатка — 4500", await A.getByLabel("Начальный остаток").inputValue(), "4500");
  const hist = nb(await A.getByTestId("history-row").first().innerText()).replace(/\s+/g, " ");
  check("история: смена №N, Администратор, −100 ₽", new RegExp(`№${number}`).test(hist) && /Администратор/.test(hist) && /−100 ₽/.test(hist), hist);

  await collect(O, 10);
  check("закрытая смена: инкассация со старой страницы — отказ «Смена уже закрыта»", await waitFor(async () => /Смена уже закрыта/.test(nb(await O.locator(".adm-err").first().innerText()))));
  await O.goto(booking, { waitUntil: "domcontentloaded" });
  await payment(O, 50, "Наличные");
  await A.goto(shiftUrl, { waitUntil: "domcontentloaded" });
  r = await report(A);
  equal("платёж после закрытия не попал в снимок: наличные 800 ₽", r["Получено наличными"], "800 ₽");
  equal("платёж после закрытия не в операциях смены", await A.getByTestId("shift-operations").locator("li").count(), 5);

  // ── Охрана и водитель кассу не видят ──
  for (const [who, user, home] of [["охрана", GUARD, "/admin/today"], ["водитель", DRIVER, "/admin/transfers"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const p = await ctx.newPage();
    await login(p, user);
    await p.goto(`${BASE}/admin/cash`, { waitUntil: "domcontentloaded" });
    check(`${who}: /admin/cash → свой экран (${home})`, p.url().includes(home) && !p.url().includes("/admin/cash"), p.url());
    await p.goto(shiftUrl, { waitUntil: "domcontentloaded" });
    check(`${who}: отчёт смены по прямой ссылке — отказ`, !p.url().includes("/admin/cash"), p.url());
    const t = nb(await p.locator("body").innerText());
    check(`${who}: на экране нет «Касса»`, !/Касса/.test(t));
    await ctx.close();
  }
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  process.exitCode = 1;
} finally {
  // Сбой посреди сценария: тестовая смена не остаётся открытой. Закрывает владелец — он в сценарии не выходит
  if (opened && owner) await closeShift(owner.page).catch(() => {});
  await browser.close();
}
if (process.exitCode) process.exit(1);
finish("Ф11 «Касса»");
