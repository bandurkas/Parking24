// Ф10 «Возвраты, пересчёт, „Исправить статус“: деньги» (docs/phases/PHASE_10_REFUNDS.md, раздел «Код»).
// Каждое денежное правило — по сумме брони, «оплачено», переплате, ленте и журналу; администратор и владелец отдельно;
// отказы сервера в обход формы — повтором запроса серверного действия (id берётся из настоящего нажатия) под другим входом.
// Владелец работает в браузере с поясом America/New_York: время платежа обязано остаться московским.
// Входит владельцем (--login owner --password owner12345), второй контекст — администратор: admin / E2E_ADMIN_PASSWORD
// (по умолчанию admin12345) или --admin-password. Не запускать с 00:00 до 01:00 МСК — перестоя ещё нет.
import { BASE, LOGIN, PASSWORD, HEADED, arg, loadPlaywright, check, equal, finish, testPhone, testPlate, moscowPlus, fillReliably } from "./lib.mjs";

const OWNER = LOGIN === "admin" ? { login: "owner", password: process.env.E2E_OWNER_PASSWORD ?? "owner12345" } : { login: LOGIN, password: PASSWORD };
const ADMIN = { login: "admin", password: arg("admin-password", process.env.E2E_ADMIN_PASSWORD ?? (LOGIN === "admin" ? PASSWORD : "admin12345")) };

const today = moscowPlus(0);
const dayShort = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`)).replace(".", "");
const TODAY_SHORT = dayShort(today);
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tag = String(Date.now()).slice(-4);
const mskMinutes = (d = new Date()) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).split(":").map(Number);
  return h * 60 + m;
};
const timeNear = (text) => {
  const m = text.match(/(\d{2}):(\d{2})/);
  return !!m && Math.abs(Number(m[1]) * 60 + Number(m[2]) - mskMinutes()) <= 3;
};

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !HEADED });
const actions = []; // запросы серверных действий обеих сессий: { id, body }

async function session(user, timezoneId) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(timezoneId ? { timezoneId } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [ошибка страницы ${user.login}] ${e.message}`));
  const dialogs = { log: [], answer: "dismiss", prompt: "" };
  page.on("dialog", async (d) => {
    dialogs.log.push(nb(d.message()));
    if (dialogs.answer === "accept") await d.accept(d.type() === "prompt" ? dialogs.prompt : undefined); else await d.dismiss();
  });
  page.on("request", (req) => {
    const id = req.headers()["next-action"];
    if (id && req.method() === "POST") actions.push({ id, body: req.postData() ?? "" });
  });
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', user.login);
  await page.fill('input[name="password"]', user.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }), page.click('button[type="submit"]')]);
  return { ctx, page, dialogs };
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

const body = async (page) => nb(await page.locator("body").innerText());
const chip = async (page) => nb(await page.locator("section.adm-card span.rounded-full.ring-inset").first().innerText().catch(() => "")).trim();
async function waitStatus(page, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await chip(page)) === label) return true;
    await page.waitForTimeout(250);
  }
  return false;
}
async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
async function stage(page, label) {
  const lines = nb(await page.locator("section.adm-card ol").first().innerText()).split("\n").map((s) => s.trim()).filter(Boolean);
  const i = lines.indexOf(label);
  return i >= 0 ? lines[i + 1] ?? "" : "";
}
const feedLines = async (page) => (await page.locator("aside", { has: page.locator("h2", { hasText: "История" }) }).locator("ol li .leading-snug").allInnerTexts()).map((s) => nb(s).trim());
const countLines = (lines, re) => lines.filter((l) => re.test(l)).length;
const amountNow = async (page) => nb(await page.getByTestId("booking-amount").textContent()).trim();
const payStatus = async (page) => nb(await page.getByTestId("pay-status").textContent()).trim();
const overpaid = async (page) => ((await page.getByTestId("overpaid").count()) ? nb(await page.getByTestId("overpaid").innerText()).trim() : "");
const banner = async (page) => ((await page.getByTestId("recalc-banner").count()) ? nb(await page.getByTestId("recalc-banner").innerText()) : "");
const rows = async (page) => (await page.getByTestId("payment-row").allInnerTexts()).map((s) => nb(s).replace(/\n+/g, " | ").trim());
const refundBtn = (page) => page.locator("button", { hasText: /^(Оформить возврат|Возврат)/ });

async function createQuick(page, name, from, to, { vehicle, amount } = {}) {
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
  if (vehicle) await drawer.getByRole("button", { name: vehicle, exact: true }).click();
  await fillReliably(drawer.getByLabel("Заезд", { exact: true }), from);
  await fillReliably(drawer.getByLabel("Выезд", { exact: true }), to);
  await fillReliably(drawer.getByPlaceholder("Госномер: А123ВС77"), testPlate());
  await page.waitForTimeout(900);
  if (amount != null) await fillReliably(drawer.getByLabel("Сумма"), String(amount));
  const quote = nb(await drawer.innerText());
  await drawer.getByRole("button", { name: /^Создать$/ }).click();
  const toastLink = page.getByRole("link", { name: "открыть" });
  await toastLink.waitFor({ timeout: 15000 });
  await toastLink.click();
  await page.waitForURL(/\/admin\/bookings\//, { timeout: 15000 });
  await waitStatus(page, "Новая заявка");
  const url = page.url();
  console.log(`  ${name}: ${url}`);
  return { url, id: url.split("/").pop(), quote };
}

async function press(page, verb, expect) {
  await (await live(page.getByRole("button", { name: verb, exact: true }))).click();
  return expect ? waitStatus(page, expect) : page.waitForTimeout(1500);
}

async function payment(page, sum, method = "Наличные") {
  await (await live(page.getByRole("button", { name: "Принять оплату" }))).click();
  await page.getByLabel("Сумма").fill(String(sum));
  await page.locator("form select").first().selectOption({ label: method });
  await page.getByRole("button", { name: "Провести" }).click();
  await page.getByRole("button", { name: "Провести" }).waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// Открыть форму возврата кнопкой (с готовой суммой или без), вписать сумму, способ и причину, провести
async function refund(page, sum, reason, method) {
  if (!(await page.getByLabel("Причина возврата").isVisible().catch(() => false))) await (await live(refundBtn(page))).click();
  if (sum != null) await page.getByLabel("Сумма").fill(String(sum));
  if (method) await page.getByLabel("Способ").selectOption({ label: method });
  await page.getByLabel("Причина возврата").fill(reason);
  await page.getByRole("button", { name: "Провести" }).click();
  await page.waitForTimeout(1500);
}

async function correct(page, status, reason, dates = {}) {
  const form = page.locator("form", { has: page.getByLabel("Новый статус") });
  const open = await live(page.getByRole("button", { name: /Исправить статус/ }));
  for (let i = 0; i < 4 && !(await form.isVisible().catch(() => false)); i++) {
    await open.click().catch(() => {});
    await form.waitFor({ timeout: 3000 }).catch(() => {});
  }
  await form.getByLabel("Новый статус").selectOption({ label: status });
  await page.waitForTimeout(200);
  if (dates.in) await fillReliably(form.getByLabel("Дата заезда", { exact: true }), dates.in);
  if (dates.out) await fillReliably(form.getByLabel("Дата выезда", { exact: true }), dates.out);
  await fillReliably(form.getByLabel("Причина"), reason);
  await form.getByRole("button", { name: "Исправить", exact: true }).click();
  await form.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// Серверное действие по id из настоящего запроса — «в обход формы», с чужими правами или чужими аргументами
function lastAction(match) {
  for (let i = actions.length - 1; i >= 0; i--) {
    try {
      const args = JSON.parse(actions[i].body);
      if (match(args)) return actions[i].id;
    } catch { /* не JSON — не наш вызов */ }
  }
  return null;
}
async function callAction(page, id, args) {
  if (!id) return "id действия не найден";
  return nb(await page.evaluate(async ({ id, body }) => {
    const r = await fetch(location.href, { method: "POST", headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body });
    return r.text();
  }, { id, body: JSON.stringify(args) }));
}

async function auditHas(page, bookingId, ...parts) {
  await page.goto(`${BASE}/admin/audit`, { waitUntil: "domcontentloaded" });
  let row = page.locator("tr", { hasText: bookingId.slice(0, 8) });
  for (const p of parts) row = row.filter({ hasText: p });
  return (await row.count()) > 0;
}

let owner, admin;
try {
  console.log(`\nФ10 «Деньги»: ${BASE}, сегодня ${today} (МСК), владелец ${OWNER.login} (браузер в America/New_York), администратор ${ADMIN.login}`);
  owner = await session(OWNER, "America/New_York");
  admin = await session(ADMIN);
  const O = owner.page;
  const A = admin.page;

  // ── М1. Администратор: досрочный выезд → расчёт готовой суммой → «Оформить возврат» частями, честный способ ──
  const m1 = await (async () => {
    const n = await createQuick(A, `E2E Ф10-${tag} досрочно`, today, moscowPlus(2));
    await press(A, "Подтвердить место", "Ожидает оплаты");
    await payment(A, 1050);
    check("М1: оплата 1 050 — «Подтверждена»", await waitStatus(A, "Подтверждена"));
    check("М1: у администратора кнопки «Сторно» нет", (await A.getByRole("button", { name: "Сторно", exact: true }).count()) === 0);
    await press(A, "Заехал", "Заехал");
    await press(A, "Выехал", "Выехал");
    const b1 = await banner(A);
    check("М1: баннер «Стоянка по факту: … → 1 сут. (по плану 3)»", /Стоянка по факту: [^\n]+ → 1 сут\. \(по плану 3\)/.test(b1), b1.split("\n")[0] || "баннера нет");
    equal("М1: расчёт с сервера — «Переплата 700 ₽ · итого 350 ₽ вместо 1 050 ₽»", nb(await A.getByTestId("recalc-sum").innerText().catch(() => "")).trim(), "Переплата 700 ₽ · итого 350 ₽ вместо 1 050 ₽");
    equal("М1: до решения переплаты нет", await overpaid(A), "");
    await (await live(A.getByRole("button", { name: "Пересчитать по факту" }))).click();
    await waitFor(async () => (await amountNow(A)) === "350 ₽");
    equal("М1: «Пересчитать по факту» — сумма 350 ₽ (та, что в баннере)", await amountNow(A), "350 ₽");
    equal("М1: баннер закрылся", await banner(A), "");
    equal("М1: строка «переплата 700 ₽»", await overpaid(A), "переплата 700 ₽");
    equal("М1: «оплачено»", await payStatus(A), "оплачено");
    equal("М1: кнопка «Оформить возврат 700 ₽»", nb(await refundBtn(A).first().innerText().catch(() => "")).trim(), "Оформить возврат 700 ₽");
    equal("М1: в ленте «Пересчёт по факту: 3 → 1 сут., 1 050 → 350 ₽»", countLines(await feedLines(A), /^Пересчёт по факту: 3 → 1 сут\., 1 050 → 350 ₽$/), 1);

    await (await live(refundBtn(A))).click();
    equal("М1: форма возврата — сумма 700", await A.getByLabel("Сумма").inputValue(), "700");
    equal("М1: способ по умолчанию — наличные", await A.getByLabel("Способ").inputValue(), "CASH");
    check("М1: подсказка «Наличными — уменьшит наличные в кассе»", /Наличными — уменьшит наличные в кассе/.test(nb(await A.getByTestId("refund-method-hint").innerText())));
    check("М1: без причины «Провести» недоступна", await A.getByRole("button", { name: "Провести" }).isDisabled());
    await refund(A, 400, "e2e: досрочный выезд");
    equal("М1: частичный возврат 400 — «переплата 300 ₽»", await overpaid(A), "переплата 300 ₽");
    equal("М1: кнопка снова с остатком — «Оформить возврат 300 ₽»", nb(await refundBtn(A).first().innerText().catch(() => "")).trim(), "Оформить возврат 300 ₽");
    equal("М1: сумма брони та же — 350 ₽", await amountNow(A), "350 ₽");
    const r1 = (await rows(A))[0] ?? "";
    check("М1: строка возврата — дата и время МСК · Наличные · Администратор, причина, −400 ₽",
      new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2} · Наличные · Администратор`).test(r1) && timeNear(r1) && /e2e: досрочный выезд/.test(r1) && /−400 ₽/.test(r1), r1);
    equal("М1: в ленте «Возврат 400 ₽ · e2e: досрочный выезд»", countLines(await feedLines(A), /^Возврат 400 ₽ · e2e: досрочный выезд$/), 1);

    await refund(A, null, "e2e: остаток на карту", "Карта (терминал)");
    equal("М1: остаток вернули — переплаты нет", await overpaid(A), "");
    equal("М1: «оплачено»", await payStatus(A), "оплачено");
    equal("М1: после выезда без переплаты у администратора кнопки возврата нет", await refundBtn(A).count(), 0);
    check("М1: возврат картой записан картой", /Карта \(терминал\) · Администратор/.test((await rows(A))[0] ?? ""), (await rows(A))[0]);
    return n;
  })();

  // ── М2. Владелец: бронь 31 сутки по 250 ₽ — сумма в баннере и после нажатия одна (ступень по суткам к оплате) ──
  const m2 = await (async () => {
    const n = await createQuick(O, `E2E Ф10-${tag} длинная`, today, moscowPlus(30));
    check("М2: заявка 31 сут. — 7 750 ₽", /7 ?750/.test(n.quote), n.quote.match(/[\d ]+₽/)?.[0] ?? "");
    await payment(O, 7750);
    await waitStatus(O, "Подтверждена");
    const r0 = (await rows(O))[0] ?? "";
    check("М2: время платежа — московское в браузере America/New_York", new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2} · Наличные · `).test(r0) && timeNear(r0), r0);
    await press(O, "Заехал", "Заехал");
    await press(O, "Выехал", "Выехал");
    const sum = nb(await O.getByTestId("recalc-sum").innerText().catch(() => "")).trim();
    equal("М2: баннер — «Переплата 7 400 ₽ · итого 350 ₽ вместо 7 750 ₽»", sum, "Переплата 7 400 ₽ · итого 350 ₽ вместо 7 750 ₽");
    await (await live(O.getByRole("button", { name: "Пересчитать по факту" }))).click();
    await waitFor(async () => (await amountNow(O)) === "350 ₽");
    equal("М2: после нажатия — ровно сумма из баннера, 350 ₽", await amountNow(O), "350 ₽");
    equal("М2: переплата 7 400 ₽", await overpaid(O), "переплата 7 400 ₽");
    check("М2: журнал — пересчёт с режимом tariff", await auditHas(O, n.id, '"recalc":true', '"mode":"tariff"', '"priceTo":350'));
    return n;
  })();
  const decideId = lastAction((a) => Array.isArray(a) && a[0] === m2.id && a[1] === true);
  check("М2: запрос «Пересчитать по факту» несёт сумму из баннера (350)", !!decideId && actions.some((x) => x.id === decideId && x.body === JSON.stringify([m2.id, true, 350])), actions.filter((x) => x.id === decideId).map((x) => x.body).join(" | "));

  // ── М3. Владелец: ручная цена 900 ₽ за 3 суток — пропорционально, не по тарифу ──
  {
    await createQuick(O, `E2E Ф10-${tag} ручная`, today, moscowPlus(2), { amount: 900 });
    equal("М3: сумма брони 900 ₽", await amountNow(O), "900 ₽");
    await payment(O, 900);
    await waitStatus(O, "Подтверждена");
    await press(O, "Заехал", "Заехал");
    await press(O, "Выехал", "Выехал");
    const b3 = await banner(O);
    check("М3: подсказка «Сумма брони задана вручную — считаем пропорционально суткам»", /Сумма брони задана вручную — считаем пропорционально суткам/.test(b3), b3);
    equal("М3: расчёт — «Переплата 600 ₽ · итого 300 ₽ вместо 900 ₽»", nb(await O.getByTestId("recalc-sum").innerText().catch(() => "")).trim(), "Переплата 600 ₽ · итого 300 ₽ вместо 900 ₽");
    await (await live(O.getByRole("button", { name: "Пересчитать по факту" }))).click();
    await waitFor(async () => (await amountNow(O)) === "300 ₽");
    equal("М3: сумма 300 ₽", await amountNow(O), "300 ₽");
    equal("М3: в ленте пересчёт с пометкой «пропорционально»", countLines(await feedLines(O), /^Пересчёт по факту: 3 → 1 сут\., 900 → 300 ₽ · цена задана вручную, пропорционально$/), 1);
  }

  // ── М4. Фура «по запросу» (цена 0): оплата 1 ₽ в обход формы не делает «Подтверждена»; пересчёта нет ──
  {
    const n = await createQuick(A, `E2E Ф10-${tag} фура`, today, moscowPlus(2), { vehicle: "Грузовая" });
    equal("М4: сумма 0 ₽", await amountNow(A), "0 ₽");
    const payId = lastAction((a) => Array.isArray(a) && a[0]?.kind === "PAYMENT" && a[0]?.bookingId === m1.id);
    const res = await callAction(A, payId, [{ bookingId: n.id, kind: "PAYMENT", method: "CASH", amount: 1, note: "", reason: "", settle: false }]);
    check("М4: оплата 1 ₽ проведена сервером", /"ok":true/.test(res), res.slice(0, 160));
    await A.reload({ waitUntil: "domcontentloaded" });
    check("М4: статус остался «Новая заявка» — не «Подтверждена»", await waitStatus(A, "Новая заявка"), await chip(A));
    await press(A, "Подтвердить место", "Ожидает оплаты");
    await press(A, "Заехал", "Заехал");
    await press(A, "Выехал", "Выехал");
    const b4 = await banner(A);
    check("М4: баннер без «Пересчитать по факту», с подсказкой «Цена по запросу»", /Цена по запросу/.test(b4) && (await A.getByRole("button", { name: "Пересчитать по факту" }).count()) === 0, b4);
    const res2 = await callAction(A, decideId, [n.id, true, 0]);
    check("М4: «Пересчитать» в обход формы — отказ «Пересчитать нельзя. Цена по запросу…»", /Пересчитать нельзя\. Цена по запросу/.test(res2), res2.slice(0, 200));
    await A.reload({ waitUntil: "domcontentloaded" });
    equal("М4: сумма та же — 0 ₽", await amountNow(A), "0 ₽");
  }

  // ── М5. Поздний заезд: место держали с плановой даты — баннера и переплаты нет ──
  {
    await createQuick(A, `E2E Ф10-${tag} поздно`, moscowPlus(-2), today);
    await payment(A, 1050);
    await waitStatus(A, "Подтверждена");
    await press(A, "Заехал", "Заехал");
    await press(A, "Выехал", "Выехал");
    equal("М5: баннера «Стоянка по факту» нет", await banner(A), "");
    equal("М5: сумма 1 050 ₽", await amountNow(A), "1 050 ₽");
    equal("М5: переплаты нет", await overpaid(A), "");
    equal("М5: «оплачено»", await payStatus(A), "оплачено");
  }

  // ── М6. «Исправить статус» датой: сутки по датам — пересчёт делает только владелец ──
  const m6 = await (async () => {
    const n = await createQuick(A, `E2E Ф10-${tag} по датам`, today, moscowPlus(2));
    await payment(A, 1050);
    await waitStatus(A, "Подтверждена");
    await press(A, "Заехал", "Заехал");
    await correct(A, "Выехал", "e2e: выезд не отметили", { out: today });
    check("М6: администратор исправил в «Выехал» датой", await waitStatus(A, "Выехал"));
    const b6 = await banner(A);
    check("М6: баннер «Стоянка по факту: 1 сут. (по плану 3)» — без часов", /Стоянка по факту: 1 сут\. \(по плану 3\)/.test(b6), b6.split("\n")[0] || "баннера нет");
    check("М6: у администратора — «пересчитать может владелец», кнопки нет", /пересчитать может владелец/.test(b6) && (await A.getByRole("button", { name: "Пересчитать по факту" }).count()) === 0, b6);
    const res = await callAction(A, decideId, [n.id, true, 350]);
    check("М6: администратор в обход формы — отказ «…пересчитать может владелец»", /Сутки посчитаны по датам из «Исправить статус» — пересчитать может владелец/.test(res), res.slice(0, 200));
    await A.reload({ waitUntil: "domcontentloaded" });
    equal("М6: сумма та же — 1 050 ₽", await amountNow(A), "1 050 ₽");
    const stale = await callAction(O, decideId, [n.id, true, 700]);
    check("М6: сумма не та, что в баннере — отказ «Бронь изменилась…»", /Бронь изменилась, пока был открыт расчёт/.test(stale), stale.slice(0, 200));
    await O.goto(n.url, { waitUntil: "domcontentloaded" });
    await (await live(O.getByRole("button", { name: "Пересчитать по факту" }))).click();
    await waitFor(async () => (await amountNow(O)) === "350 ₽");
    equal("М6: владелец пересчитал — 350 ₽", await amountNow(O), "350 ₽");
    equal("М6: переплата 700 ₽", await overpaid(O), "переплата 700 ₽");
    await refund(O, null, "e2e: досрочный выезд по датам");
    equal("М6: владелец вернул переплату — «оплачено», 350 ₽", `${await payStatus(O)} ${await amountNow(O)}`, "оплачено 350 ₽");
    return n;
  })();

  // ── М7. Владелец открывает закрытую бронь: сумма остаётся, это видно в ленте; решение по пересчёту снято ──
  {
    await correct(O, "Заехал", "e2e: выезд отмечен по ошибке");
    check("М7: «Выехал» → «Заехал» (владелец)", await waitStatus(O, "Заехал"));
    equal("М7: в ленте «Бронь открыта заново: сумма 350 ₽ остаётся»", countLines(await feedLines(O), /^Бронь открыта заново: сумма 350 ₽ остаётся$/), 1);
    equal("М7: сумма та же", await amountNow(O), "350 ₽");
    await A.goto(m6.url, { waitUntil: "domcontentloaded" });
    await waitStatus(A, "Заехал");
    await A.getByRole("button", { name: /Исправить статус/ }).first().click();
    check("М7: администратор в открытой брони исправлять может", await A.getByLabel("Новый статус").isVisible().catch(() => false));
  }

  // ── М8. Сторно ошибочной оплаты — владелец; отдельная запись, «оплачено» уменьшается, сумма та же, статус назад ──
  {
    const n = await createQuick(O, `E2E Ф10-${tag} сторно`, today, moscowPlus(2));
    await payment(O, 1050);
    check("М8: оплачено — «Подтверждена»", await waitStatus(O, "Подтверждена"));
    await A.goto(n.url, { waitUntil: "domcontentloaded" });
    await waitStatus(A, "Подтверждена");
    equal("М8: у администратора кнопки «Сторно» нет", await A.getByRole("button", { name: "Сторно", exact: true }).count(), 0);
    await (await live(O.getByRole("button", { name: "Сторно", exact: true }))).click();
    const form = O.locator("form", { has: O.getByLabel("Причина сторно") });
    check("М8: предупреждение — сумма брони не изменится", /сумма брони не изменится/.test(nb(await form.innerText())));
    check("М8: без причины «Провести сторно» недоступна", await form.getByRole("button", { name: "Провести сторно" }).isDisabled());
    await fillReliably(form.getByLabel("Причина сторно"), "e2e: оплата не на ту бронь");
    await form.getByRole("button", { name: "Провести сторно" }).click();
    await waitFor(async () => (await O.getByTestId("payment-reversed").count()) > 0);
    const rv = nb(await O.getByTestId("payment-reversed").first().innerText().catch(() => ""));
    check("М8: строка оплаты — «сторно · причина · кто · когда»", new RegExp(`^сторно · e2e: оплата не на ту бронь · Сергей Кулагин · ${esc(TODAY_SHORT)}, \\d{2}:\\d{2}$`).test(rv), rv);
    equal("М8: строка сторно не выводится отдельно — одна строка платежа", (await rows(O)).length, 1);
    equal("М8: сумма брони та же — 1 050 ₽", await amountNow(O), "1 050 ₽");
    equal("М8: «не оплачено»", await payStatus(O), "не оплачено");
    check("М8: статус вернулся в «Ожидает оплаты»", await waitStatus(O, "Ожидает оплаты"), await chip(O));
    equal("М8: «Оплачена» в полосе этапов снова пустая", await stage(O, "Оплачена"), "—");
    const lines = await feedLines(O);
    equal("М8: в ленте «Сторно оплаты 1 050 ₽ от … · причина · оплачено 1 050 ₽ → 0 ₽»", countLines(lines, new RegExp(`^Сторно оплаты 1 050 ₽ от ${esc(TODAY_SHORT)}, \\d{2}:\\d{2} · e2e: оплата не на ту бронь · оплачено 1 050 ₽ → 0 ₽$`)), 1);
    equal("М8: в ленте «Подтверждена → Ожидает оплаты (оплата сторнирована)»", countLines(lines, /^Подтверждена → Ожидает оплаты \(оплата сторнирована\)$/), 1);
    equal("М8: повторного «Сторно» нет", await O.getByRole("button", { name: "Сторно", exact: true }).count(), 0);
    check("М8: «Принять оплату» снова доступна", (await O.getByRole("button", { name: "Принять оплату" }).count()) === 1);
    const revId = lastAction((a) => Array.isArray(a) && a.length === 2 && a[1] === "e2e: оплата не на ту бронь");
    const again = await callAction(O, revId, JSON.parse(actions.find((x) => x.id === revId)?.body ?? "[]"));
    check("М8: повторное сторно того же платежа — отказ «Платёж уже сторнирован»", /Платёж уже сторнирован/.test(again), again.slice(0, 200));
    const byAdmin = await callAction(A, revId, JSON.parse(actions.find((x) => x.id === revId)?.body ?? "[]"));
    check("М8: сторно администратором в обход формы — «Нет доступа»", /"error":"Нет доступа"/.test(byAdmin), byAdmin.slice(0, 200));
    await O.reload({ waitUntil: "domcontentloaded" });
    equal("М8: после отказов — одна строка сторно, «не оплачено»", `${await O.getByTestId("payment-reversed").count()} ${await payStatus(O)}`, "1 не оплачено");
    check("М8: журнал — отдельная запись CREATE Payment REFUND со ссылкой на исходную", await auditHas(O, n.id, "CREATE", '"kind":"REFUND"', '"reversalOf"'));
    check("М8: журнал — откат статуса с пометкой", await auditHas(O, n.id, "STATUS_CHANGE", '"to":"AWAITING_PAYMENT"', '"paidToZero":true'));
  }

  // ── М9. Перестой → «Исправить статус» в «Отменена»: перестой не начислен, это видно ──
  {
    await createQuick(O, `E2E Ф10-${tag} перестой отмена`, moscowPlus(-2), moscowPlus(-1));
    await payment(O, 700);
    await waitStatus(O, "Подтверждена");
    await press(O, "Заехал", "Заехал");
    check("М9: перестой 1 сут.", /ПЕРЕСТОЙ · 1 сут\./.test(await body(O)));
    await correct(O, "Отменена", "e2e: клиент отказался, машину забрали");
    check("М9: «Отменена»", await waitStatus(O, "Отменена"));
    equal("М9: в ленте «Перестой 1 сут. не начислен (350 ₽) · исправление в «Отменена» · причина»", countLines(await feedLines(O), /^Перестой 1 сут\. не начислен \(350 ₽\) · исправление в «Отменена» · e2e: клиент отказался, машину забрали$/), 1);
    equal("М9: сумма та же — 700 ₽", await amountNow(O), "700 ₽");
  }

  // ── М10. Начисление за перестой не снимается, пока не решён баннер «Стоянка по факту» ──
  {
    const n = await createQuick(O, `E2E Ф10-${tag} снятие`, moscowPlus(-2), moscowPlus(-1));
    await payment(O, 700);
    await waitStatus(O, "Подтверждена");
    await press(O, "Заехал", "Заехал");
    owner.dialogs.answer = "accept";
    await press(O, "Выехал", "Выехал");
    owner.dialogs.answer = "dismiss";
    equal("М10: перестой начислен — 1 050 ₽", await amountNow(O), "1 050 ₽");
    await correct(O, "Заехал", "e2e: машина ещё на месте");
    await waitStatus(O, "Заехал");
    equal("М10: в ленте «Бронь открыта заново: сумма 1 050 ₽ и начисление за перестой 350 ₽ остаются — …»", countLines(await feedLines(O), /^Бронь открыта заново: сумма 1 050 ₽ и начисление за перестой 350 ₽ остаются — при повторном выезде начислятся только новые сутки$/), 1);
    await O.getByRole("button", { name: /Изменить бронь/ }).click();
    await fillReliably(O.getByLabel("Дата выезда"), moscowPlus(2));
    await O.getByRole("button", { name: /Сохранить/ }).click();
    await O.waitForTimeout(1500);
    await O.reload({ waitUntil: "domcontentloaded" });
    await press(O, "Выехал", "Выехал");
    const b10 = await banner(O);
    check("М10: баннер открыт (продлили и уехали раньше), пересчёт — решает владелец через «Изменить цену»", /Стоянка по факту/.test(b10) && /Сумма задана вручную и был перестой/.test(b10), b10);
    await (await live(O.getByRole("button", { name: /Снять начисление за перестой \(350 ₽\)/ }))).click();
    await O.getByLabel("Причина снятия начисления").fill("e2e: снять при открытом баннере");
    await O.getByRole("button", { name: "Снять", exact: true }).click();
    await O.waitForTimeout(1500);
    check("М10: снятие при открытом баннере — отказ «Сначала решите „Стоянка по факту“»", /Сначала решите «Стоянка по факту»/.test(await body(O)));
    equal("М10: сумма та же — 1 050 ₽", await amountNow(O), "1 050 ₽");
    await O.reload({ waitUntil: "domcontentloaded" });
    await (await live(O.getByRole("button", { name: "Оставить по плану" }))).click();
    await waitFor(async () => (await banner(O)) === "");
    await (await live(O.getByRole("button", { name: /Снять начисление за перестой \(350 ₽\)/ }))).click();
    await O.getByLabel("Причина снятия начисления").fill("e2e: снять после решения");
    await O.getByRole("button", { name: "Снять", exact: true }).click();
    await waitFor(async () => (await amountNow(O)) === "700 ₽");
    equal("М10: после решения баннера снятие проходит — 700 ₽", await amountNow(O), "700 ₽");
    check("М10: журнал — снятие начисления", await auditHas(O, n.id, '"overstayWaived":350'));
  }

  // ── М11. Администратор: полный возврат до заезда — бронь снова «Ожидает оплаты» (DECISIONS §3, без выключателя) ──
  {
    const n = await createQuick(A, `E2E Ф10-${tag} полный возврат`, today, moscowPlus(2));
    await payment(A, 1050);
    await waitStatus(A, "Подтверждена");
    await refund(A, 350, "e2e: частичный возврат предоплаты");
    check("М11: частичный возврат — статус тот же «Подтверждена»", await waitStatus(A, "Подтверждена"));
    equal("М11: «не хватает 350 ₽»", await payStatus(A), "не хватает 350 ₽");
    await refund(A, 700, "e2e: клиент передумал");
    check("М11: полный возврат — «Ожидает оплаты»", await waitStatus(A, "Ожидает оплаты"), await chip(A));
    equal("М11: «не оплачено», сумма 1 050 ₽", `${await payStatus(A)} ${await amountNow(A)}`, "не оплачено 1 050 ₽");
    equal("М11: в ленте «Подтверждена → Ожидает оплаты (оплата возвращена полностью)»", countLines(await feedLines(A), /^Подтверждена → Ожидает оплаты \(оплата возвращена полностью\)$/), 1);
    equal("М11: «Оплачена» в полосе этапов снова пустая", await stage(A, "Оплачена"), "—");
    check("М11: журнал — возврат с причиной и способом", await auditHas(O, n.id, "CREATE", '"kind":"REFUND"', '"method":"CASH"', '"reason":"e2e: клиент передумал"'));
  }

  // ── М12. Отклонение снимается, отметка остаётся: в ленте видно, что именно снято ──
  {
    await createQuick(A, `E2E Ф10-${tag} отклонение`, today, moscowPlus(2));
    admin.dialogs.answer = "accept";
    admin.dialogs.prompt = "e2e: нет документов";
    await press(A, "Отклонить", "Отклонена");
    admin.dialogs.answer = "dismiss";
    const end = await stage(A, "Отклонена");
    check("М12: этап «Отклонена» — со временем отклонения", new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(end), end);
    await press(A, "Подтвердить место", "Ожидает оплаты");
    equal("М12: в ленте «Отклонение снято (другая причина) · отклонена <дата, время>»", countLines(await feedLines(A), new RegExp(`^Отклонение снято \\(другая причина\\) · отклонена ${esc(TODAY_SHORT)}, \\d{2}:\\d{2}$`)), 1);
  }

  // Карточка клиента: сторно и возвраты не дают ложного долга (М1 — «К оплате» «—»)
  {
    await A.goto(m1.url, { waitUntil: "domcontentloaded" });
    await A.goto(`${BASE}${await A.locator('a[href^="/admin/clients/"]').first().getAttribute("href")}`, { waitUntil: "domcontentloaded" });
    const due = (await A.getByText("К оплате", { exact: true }).locator("xpath=preceding-sibling::div[1]").textContent().catch(() => "плитки нет"))?.trim();
    equal("клиент М1: «К оплате» — «—»", due, "—");
  }
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  await owner?.page.screenshot({ path: `/tmp/e2e-f10-owner-${Date.now()}.png`, fullPage: true }).catch(() => {});
  await admin?.page.screenshot({ path: `/tmp/e2e-f10-admin-${Date.now()}.png`, fullPage: true }).catch(() => {});
  check("сценарий дошёл до конца", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
}
finish("Ф10 «Деньги»");
