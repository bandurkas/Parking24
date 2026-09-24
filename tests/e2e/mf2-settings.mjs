// МФ-2 «Настройки CRM» (docs/phases/PHASE_MF2_CRM_SETTINGS.md §7–8): шесть плиток без 404; шаблон — правка, предпросмотр,
// опечатка в переменной, предупреждение о номере брони, seed не затирает правку, «Вернуть текст поставки»; выключатель правила
// переживает seed; предупреждение про правило отказа при включённом автоподтверждении; ссылки на отзывы и видео в предпросмотре;
// тарифы; пользователи DRIVER/PARKER/ADMIN — вход на свой экран, смена пароля гасит чужие сессии и оставляет текущую,
// выключенный не входит; администратор и охрана в настройки не попадают и по прямому адресу; пароль в журнале не пишется.
// Всё, что сценарий меняет, возвращается в finally (шаблон, правило, ссылки, тариф; тестовые пользователи e2e_* выключаются).
// Локально (--base на localhost) дополнительно: `npx prisma db seed` посреди сценария и временное правило отказа через Prisma.
// Входит владельцем (--login owner --password owner12345); admin/guard — E2E_ADMIN_PASSWORD/E2E_GUARD_PASSWORD.
import { execSync } from "node:child_process";
import { BASE, LOGIN, PASSWORD, HEADED, loadPlaywright, check, equal, finish } from "./lib.mjs";

const OWNER = LOGIN === "admin" ? { login: "owner", password: process.env.E2E_OWNER_PASSWORD ?? "owner12345" } : { login: LOGIN, password: PASSWORD };
const ADMIN = { login: "admin", password: process.env.E2E_ADMIN_PASSWORD ?? "admin12345" };
const GUARD = { login: "guard", password: process.env.E2E_GUARD_PASSWORD ?? "guard12345" };
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(`${BASE}/`);
const tag = Date.now().toString(36).slice(-5);
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");
const SETTINGS_PAGES = ["/admin/settings", "/admin/settings/templates", "/admin/settings/automations", "/admin/settings/users", "/admin/settings/tariffs", "/admin/settings/policy"];

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !HEADED });
const prisma = LOCAL ? new (await import("@prisma/client")).PrismaClient() : null;

async function open(user, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
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

// Вход, который должен не пройти: страница остаётся на /login с текстом ошибки
async function loginFails(page, user) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', user.login);
  await page.fill('input[name="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.getByRole("alert").filter({ hasText: "Неверный логин или пароль" }).waitFor({ timeout: 15000 }).catch(() => {});
  return page.url().includes("/admin/login") && (await page.getByText("Неверный логин или пароль").count()) > 0;
}

// Кнопка до гидратации молчит: ждём, пока React повесит обработчики на сам элемент
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

async function fill(locator, value) {
  const el = await live(locator);
  for (let i = 0; i < 5; i++) {
    await el.fill(value);
    if ((await el.inputValue()) === value) return;
    await el.page().waitForTimeout(200 * (i + 1));
  }
}

async function goto(page, path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  return res?.status() ?? 0;
}

function seed() {
  execSync("npx prisma db seed", { stdio: "pipe", cwd: process.cwd() });
}

const card = (page, code) => page.locator(`section[data-template="${code}"]`);
const textOf = (page, code) => card(page, code).getByLabel("Текст шаблона").inputValue();

async function restoreTemplate(page, code) {
  const c = card(page, code);
  if ((await c.getByTestId("edited-badge").count()) === 0) return;
  await (await live(c.locator("summary", { hasText: "Текст поставки" }))).click();
  await (await live(c.getByRole("button", { name: "Вернуть текст поставки" }))).click();
  await c.getByRole("button", { name: "Да, вернуть" }).click();
  await c.getByTestId("default-badge").waitFor({ timeout: 15000 });
}

const cleanup = [];
let owner;

try {
  console.log(`\nНастройки CRM (МФ-2): ${BASE}${LOCAL ? "" : " — без seed и временного правила (только локально)"}`);
  owner = await open(OWNER);
  const { page } = owner;

  // ── 1. Шесть плиток, ни одной 404 ──
  {
    equal("настройки: страница открывается", await goto(page, "/admin/settings"), 200);
    const hrefs = await page.locator('a.adm-card[href^="/admin/settings/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    equal("настройки: шесть плиток", hrefs.length, 6);
    check("настройки: строки про «этап M4» нет", !(await page.locator("body").innerText()).includes("M4"));
    for (const h of hrefs) {
      const st = await goto(page, h);
      const txt = await page.locator("body").innerText();
      check(`плитка ${h}: открывается`, st === 200 && !/could not be found|404/.test(txt), st === 200 ? "" : `статус ${st}`);
    }
  }

  // ── 2. Шаблоны: правка, предпросмотр, опечатка, предупреждение, seed, «Вернуть текст поставки» ──
  const CODE = "awaiting_payment";
  cleanup.push(async () => {
    await goto(page, "/admin/settings/templates");
    await restoreTemplate(page, CODE);
  });
  {
    await goto(page, "/admin/settings/templates");
    await restoreTemplate(page, CODE); // хвост упавшего прогона
    const c = card(page, CODE);
    const original = await textOf(page, CODE);
    check("шаблон: у неправленого бейдж «Текст поставки»", (await c.getByTestId("default-badge").count()) === 1);
    const edited = `${original}\nE2E-правка ${tag}`;
    await fill(c.getByLabel("Текст шаблона"), edited);
    await (await live(c.getByRole("button", { name: "Предпросмотр" }))).click();
    await c.getByTestId("preview").waitFor({ timeout: 15000 });
    const prev = nb(await c.getByTestId("preview").innerText());
    check("предпросмотр: без {{ }}", !prev.includes("{{"), prev.includes("{{") ? prev.slice(0, 80) : "");
    check("предпросмотр: номер демонстрационной брони и правка", prev.includes("Бронь № 128") && prev.includes(`E2E-правка ${tag}`));
    await c.getByRole("button", { name: "Сохранить", exact: true }).click();
    await c.getByTestId("edited-badge").waitFor({ timeout: 15000 });
    check("шаблон: после сохранения бейдж «Правлено»", /Правлено/.test(await c.getByTestId("edited-badge").innerText()));
    await goto(page, "/admin/settings/templates");
    check("шаблон: правка на месте после перезагрузки", (await textOf(page, CODE)).includes(`E2E-правка ${tag}`));

    // Опечатка в переменной — отказ с названием переменной
    await fill(c.getByLabel("Текст шаблона"), `${edited}\nМаршрут: {{links.rout}}`);
    await (await live(c.getByRole("button", { name: "Сохранить", exact: true }))).click();
    await c.getByRole("status").filter({ hasText: "links.rout" }).waitFor({ timeout: 15000 }).catch(() => {});
    check("опечатка {{links.rout}}: сохранение отклонено, переменная названа", (await c.getByRole("status").filter({ hasText: "{{links.rout}}" }).count()) === 1);
    await goto(page, "/admin/settings/templates");
    check("опечатка: в базу не попала", !(await textOf(page, CODE)).includes("{{links.rout}}"));

    // Пропал номер брони — предупреждение, сохранение после подтверждения
    const noNumber = edited.replace("Бронь № {{booking.number}}", "Бронь");
    await fill(c.getByLabel("Текст шаблона"), noNumber);
    await (await live(c.getByRole("button", { name: "Сохранить", exact: true }))).click();
    const alert = c.getByRole("alert");
    await alert.waitFor({ timeout: 15000 });
    check("без номера брони: предупреждение", /номер брони/.test(await alert.innerText()));
    await alert.getByRole("button", { name: "Сохранить всё равно" }).click();
    await alert.waitFor({ state: "detached", timeout: 15000 });
    await goto(page, "/admin/settings/templates");
    check("без номера брони: сохранено после подтверждения", !(await textOf(page, CODE)).includes("{{booking.number}}"));

    if (LOCAL) {
      // Неправленый шаблон с устаревшим текстом (как после смены поставки) — seed вернёт текст поставки
      const rem = await prisma.messageTemplate.findUnique({ where: { code: "reminder_24h" } });
      await prisma.messageTemplate.update({ where: { code: "reminder_24h" }, data: { body: "Устаревший текст поставки" } });
      seed();
      await goto(page, "/admin/settings/templates");
      const after = await textOf(page, CODE);
      check("seed: правленый текст не затёрт", after.includes(`E2E-правка ${tag}`) && !after.includes("{{booking.number}}"));
      check("seed: бейдж «Правлено» на месте", (await card(page, CODE).getByTestId("edited-badge").count()) === 1);
      equal("seed: неправленый шаблон получил текст поставки", await textOf(page, "reminder_24h"), rem.defaultBody);
    }

    await restoreTemplate(page, CODE);
    equal("«Вернуть текст поставки»: исходный текст", await textOf(page, CODE), original);
    check("«Вернуть текст поставки»: бейдж снят", (await c.getByTestId("edited-badge").count()) === 0);
  }

  // ── 3. Ссылки: отзывы и видео сохраняются и видны в предпросмотре ──
  {
    await goto(page, "/admin/settings/policy");
    const form = page.getByRole("form", { name: "Ссылки для сообщений" });
    const review = form.getByLabel("Ссылка на отзывы");
    const video = form.getByLabel("Видео «как проехать»");
    await live(review);
    const before = { review: await review.inputValue(), video: await video.inputValue() };
    cleanup.push(async () => {
      await goto(page, "/admin/settings/policy");
      const f = page.getByRole("form", { name: "Ссылки для сообщений" });
      await fill(f.getByLabel("Ссылка на отзывы"), before.review);
      await fill(f.getByLabel("Видео «как проехать»"), before.video);
      await f.getByRole("button", { name: "Сохранить ссылки" }).click();
      await f.getByRole("status").filter({ hasText: "Сохранено" }).waitFor({ timeout: 15000 });
    });
    const R = `https://example.com/e2e-review-${tag}`;
    const V = `https://example.com/e2e-video-${tag}`;
    await fill(review, R);
    await fill(video, V);
    await form.getByRole("button", { name: "Сохранить ссылки" }).click();
    await form.getByRole("status").filter({ hasText: "Сохранено" }).waitFor({ timeout: 15000 });
    await goto(page, "/admin/settings/policy");
    equal("ссылка на отзывы сохранилась", await page.getByLabel("Ссылка на отзывы").inputValue(), R);
    equal("ссылка на видео сохранилась", await page.getByLabel("Видео «как проехать»").inputValue(), V);
    await fill(page.getByLabel("Ссылка на отзывы"), "javascript:alert(1)");
    await page.getByRole("button", { name: "Сохранить ссылки" }).click();
    await page.getByRole("status").filter({ hasText: "https://" }).waitFor({ timeout: 15000 }).catch(() => {});
    check("ссылка javascript: отклонена", (await page.getByRole("status").filter({ hasText: "https://" }).count()) === 1);

    await goto(page, "/admin/settings/templates");
    const c = card(page, "thanks_discount");
    await fill(c.getByLabel("Текст шаблона"), "Отзыв: {{links.review}}\nВидео: {{links.video}}");
    await (await live(c.getByRole("button", { name: "Предпросмотр" }))).click();
    await c.getByTestId("preview").waitFor({ timeout: 15000 });
    const prev = await c.getByTestId("preview").innerText();
    check("предпросмотр: сохранённая ссылка на отзывы", prev.includes(R));
    check("предпросмотр: сохранённая ссылка на видео", prev.includes(V));
    await c.getByRole("button", { name: "Отменить правку" }).click();
  }

  // ── 4. Автоматизации: выключатель переживает перезагрузку и seed ──
  {
    const RULE = "before_checkin_24h";
    await goto(page, "/admin/settings/automations");
    const sw = () => page.locator(`[data-rule="${RULE}"]`).getByRole("switch");
    const orig = (await (await live(sw())).getAttribute("aria-checked")) === "true";
    cleanup.push(async () => {
      await goto(page, "/admin/settings/automations");
      if (((await (await live(sw())).getAttribute("aria-checked")) === "true") !== orig) {
        await sw().click();
        await page.waitForFunction(([sel, v]) => document.querySelector(sel)?.getAttribute("aria-checked") === v, [`[data-rule="${RULE}"] [role="switch"]`, String(orig)], { timeout: 15000 });
      }
      if (prisma) await prisma.automationRule.update({ where: { code: RULE }, data: { editedAt: null, editedById: null } });
    });
    await sw().click();
    await page.waitForFunction(([sel, v]) => document.querySelector(sel)?.getAttribute("aria-checked") === v, [`[data-rule="${RULE}"] [role="switch"]`, String(!orig)], { timeout: 15000 });
    check("правило: пометка «вручную»", /вручную/.test(await page.locator(`[data-rule="${RULE}"]`).getByTestId("rule-edited").innerText()));
    await goto(page, "/admin/settings/automations");
    equal("правило: переключение пережило перезагрузку", await sw().getAttribute("aria-checked"), String(!orig));
    if (LOCAL) {
      seed();
      await goto(page, "/admin/settings/automations");
      equal("правило: seed не вернул выключатель", await sw().getAttribute("aria-checked"), String(!orig));
    }
    await (await live(sw())).click();
    await page.waitForFunction(([sel, v]) => document.querySelector(sel)?.getAttribute("aria-checked") === v, [`[data-rule="${RULE}"] [role="switch"]`, String(orig)], { timeout: 15000 });
    check("правило: обратное переключение", true);
  }

  // ── 5. Правило отказа при включённом автоподтверждении (локально: временное правило через Prisma) ──
  if (LOCAL) {
    const code = `e2e_reject_${tag}`;
    const tpl = await prisma.messageTemplate.findUnique({ where: { code: "new_lead_reply" } });
    const ac = await prisma.setting.findUnique({ where: { key: "parking.autoConfirm" } });
    cleanup.push(async () => {
      await prisma.automationRule.deleteMany({ where: { code } });
      if (ac) await prisma.setting.update({ where: { key: ac.key }, data: { value: ac.value } });
      else await prisma.setting.deleteMany({ where: { key: "parking.autoConfirm" } });
    });
    await prisma.automationRule.create({ data: { code, name: `E2E отказ ${tag}`, trigger: "STATUS_CHANGED", triggerParams: { status: "REJECTED" }, templateId: tpl.id, isActive: true } });
    await prisma.setting.upsert({ where: { key: "parking.autoConfirm" }, update: { value: true }, create: { key: "parking.autoConfirm", value: true } });
    await goto(page, "/admin/settings/automations");
    const row = page.locator(`[data-rule="${code}"]`);
    await (await live(row.getByRole("switch"))).click();
    const alert = row.getByRole("alert");
    await alert.waitFor({ timeout: 15000 });
    check("отказ при АП: предупреждение", /Автоподтверждение включено/.test(await alert.innerText()));
    equal("отказ при АП: без подтверждения не выключено", await row.getByRole("switch").getAttribute("aria-checked"), "true");
    await alert.getByRole("button", { name: "Выключить всё равно" }).click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute("aria-checked") === "false", `[data-rule="${code}"] [role="switch"]`, { timeout: 15000 });
    check("отказ при АП: выключено после подтверждения", true);
    check("отказ при АП: плашка «правила на „Отклонена“ нет»", (await page.getByText("действующего правила на «Отклонена» нет").count()) === 1);
    await prisma.setting.upsert({ where: { key: "parking.autoConfirm" }, update: { value: false }, create: { key: "parking.autoConfirm", value: false } });
    await goto(page, "/admin/settings/automations");
    await (await live(row.getByRole("switch"))).click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute("aria-checked") === "true", `[data-rule="${code}"] [role="switch"]`, { timeout: 15000 });
    await row.getByRole("switch").click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute("aria-checked") === "false", `[data-rule="${code}"] [role="switch"]`, { timeout: 15000 });
    equal("отказ без АП: выключается без предупреждения", await row.getByRole("alert").count(), 0);
  }

  // ── 6. Тарифы: цена сохраняется, последний стартовый тариф легковых не выключается ──
  {
    await goto(page, "/admin/settings/tariffs");
    const row = () => page.locator('[data-tariff="car"]');
    const price = () => row().getByLabel("Цена car");
    const orig = await (await live(price())).inputValue();
    cleanup.push(async () => {
      await goto(page, "/admin/settings/tariffs");
      if ((await (await live(price())).inputValue()) !== orig || !(await row().getByLabel("Действует car").isChecked())) {
        await fill(price(), orig);
        if (!(await row().getByLabel("Действует car").isChecked())) await row().getByLabel("Действует car").check();
        await row().getByRole("button", { name: "Сохранить" }).click();
        await row().getByRole("status").filter({ hasText: "Сохранено" }).waitFor({ timeout: 15000 });
      }
    });
    const next = String(Number(orig) + 1);
    await fill(price(), next);
    await row().getByRole("button", { name: "Сохранить" }).click();
    await row().getByRole("status").filter({ hasText: "Сохранено" }).waitFor({ timeout: 15000 });
    await goto(page, "/admin/settings/tariffs");
    equal("тариф: цена сохранилась", await (await live(price())).inputValue(), next);
    check("тариф: рядом цена сайта", /на сайте: 350/.test(nb(await row().getByTestId("site-price").innerText())));
    await row().getByLabel("Действует car").uncheck();
    await row().getByRole("button", { name: "Сохранить" }).click();
    await row().getByRole("status").filter({ hasText: "единственный" }).waitFor({ timeout: 15000 }).catch(() => {});
    check("тариф: единственный стартовый легковой не выключается", (await row().getByRole("status").filter({ hasText: "единственный" }).count()) === 1);
    await goto(page, "/admin/settings/tariffs");
    check("тариф: остался действующим", await (await live(row().getByLabel("Действует car"))).isChecked());
    await fill(price(), orig);
    await row().getByRole("button", { name: "Сохранить" }).click();
    await row().getByRole("status").filter({ hasText: "Сохранено" }).waitFor({ timeout: 15000 });
  }

  // ── 7. Пользователи: водитель, парковщик, администратор; пароли и сессии ──
  const pw = (n) => `E2e-${tag}-pass-${n}`;
  const U = {
    driver: { login: `e2e_d${tag}`, name: `E2E Водитель ${tag}`, role: "DRIVER", password: pw(1) },
    parker: { login: `e2e_p${tag}`, name: `E2E Парковщик ${tag}`, role: "PARKER", password: pw(2) },
    admin: { login: `e2e_a${tag}`, name: `E2E Администратор ${tag}`, role: "ADMIN", password: pw(3) },
  };
  const usedPasswords = [pw(1), pw(2), pw(3), pw(4), pw(5)];
  cleanup.push(async () => {
    await goto(page, "/admin/settings/users");
    for (const u of Object.values(U)) {
      const r = page.locator(`[data-user="${u.login}"]`);
      if ((await r.count()) && (await r.getByRole("button", { name: "Выключить" }).count())) {
        await (await live(r.getByRole("button", { name: "Выключить" }))).click();
        await r.getByRole("button", { name: "Включить" }).waitFor({ timeout: 15000 });
      }
    }
  });
  {
    await goto(page, "/admin/settings/users");
    for (const u of Object.values(U)) {
      await (await live(page.getByRole("button", { name: "Добавить" }))).click();
      const f = page.getByRole("form", { name: "Новый пользователь" });
      await fill(f.locator('input[name="new-login"]'), u.login);
      await fill(f.locator('input[name="new-name"]'), u.name);
      await f.getByLabel("Роль", { exact: true }).selectOption(u.role);
      await fill(f.locator('input[name="new-password"]'), u.password);
      await f.getByRole("button", { name: "Завести" }).click();
      await page.locator(`[data-user="${u.login}"]`).waitFor({ timeout: 15000 });
    }
    check("пользователи: трое заведены", (await page.locator('[data-user^="e2e_"]').filter({ hasText: tag }).count()) === 3);
    check("владелец: у себя нет «Выключить»", (await page.locator(`[data-user="${OWNER.login}"]`).getByRole("button", { name: "Выключить" }).count()) === 0);

    const d = await open(U.driver, 390);
    check("водитель: вход на /admin/transfers", d.page.url().includes("/admin/transfers"));
    const p = await open(U.parker, 390);
    check("парковщик: вход на /admin/parking-lot", p.page.url().includes("/admin/parking-lot"));
    await p.ctx.close();

    // Владелец задаёт пароль администратору — его вход в другом браузере гаснет
    const a1 = await open(U.admin);
    check("администратор e2e: вошёл в CRM", !a1.page.url().includes("/login"));
    const row = page.locator(`[data-user="${U.admin.login}"]`);
    await (await live(row.getByRole("button", { name: "Задать пароль" }))).click();
    await fill(row.getByLabel("Новый пароль"), pw(4));
    await row.getByRole("button", { name: "Сохранить пароль" }).click();
    await row.getByRole("status").filter({ hasText: "Пароль задан" }).waitFor({ timeout: 15000 });
    await goto(a1.page, "/admin/boards/parking");
    check("смена пароля владельцем: старая сессия закрыта", a1.page.url().includes("/admin/login"));
    await a1.ctx.close();
    const probe = await browser.newContext().then((c) => c.newPage());
    check("старый пароль больше не подходит", await loginFails(probe, U.admin));
    await probe.context().close();
    U.admin.password = pw(4);

    // Свой пароль: текущее окно остаётся, второе устройство выходит
    const a2 = await open(U.admin);
    const a3 = await open(U.admin);
    await goto(a2.page, "/admin/account");
    const f = a2.page.getByRole("form", { name: "Мой пароль" });
    await fill(f.locator('input[name="current-password"]'), pw(4));
    await fill(f.locator('input[name="new-password"]'), pw(5));
    await fill(f.locator('input[name="repeat-password"]'), pw(5));
    await f.getByRole("button", { name: "Сменить пароль" }).click();
    await f.getByRole("status").filter({ hasText: "Пароль изменён" }).waitFor({ timeout: 15000 });
    await goto(a2.page, "/admin/boards/parking");
    check("свой пароль: это окно осталось в CRM", !a2.page.url().includes("/login"));
    await goto(a3.page, "/admin/boards/parking");
    check("свой пароль: другое устройство вышло", a3.page.url().includes("/admin/login"));
    U.admin.password = pw(5);
    await login(a3.page, U.admin);
    check("свой пароль: новый подходит", !a3.page.url().includes("/login"));
    check("меню администратора: есть «Мой пароль»", (await a3.page.getByRole("link", { name: "Мой пароль" }).count()) > 0);
    await a2.ctx.close();
    await a3.ctx.close();

    // Выключенный не входит, его открытая сессия гаснет сразу
    await goto(page, "/admin/settings/users");
    for (const u of Object.values(U)) {
      const r = page.locator(`[data-user="${u.login}"]`);
      await (await live(r.getByRole("button", { name: "Выключить" }))).click();
      await r.getByRole("button", { name: "Включить" }).waitFor({ timeout: 15000 });
    }
    await goto(d.page, "/admin/transfers");
    check("выключенный водитель: сессия закрыта", d.page.url().includes("/admin/login"));
    check("выключенный водитель: вход не проходит", await loginFails(d.page, U.driver));
    await d.ctx.close();
  }

  // ── 8. Администратор и охрана: страниц владельца не видят, и по прямому адресу тоже ──
  for (const who of [ADMIN, GUARD]) {
    const s = await open(who);
    for (const path of SETTINGS_PAGES) {
      await goto(s.page, path);
      check(`${who.login}: ${path} — отказ`, !new URL(s.page.url()).pathname.startsWith("/admin/settings"), s.page.url());
    }
    if (who === ADMIN) {
      equal("администратор: «Мой пароль» открывается", await goto(s.page, "/admin/account"), 200);
      check("администратор: в меню нет «Настройки»", (await s.page.getByRole("link", { name: "Настройки" }).count()) === 0);
    } else {
      await goto(s.page, "/admin/account");
      check("охрана: «Мой пароль» CRM не открывается", !s.page.url().includes("/admin/account"));
    }
    await s.ctx.close();
  }

  // ── 9. Журнал: записи есть, паролей нет ──
  {
    await goto(page, "/admin/audit");
    const txt = await page.locator("body").innerText();
    for (const e of ["MessageTemplate", "AutomationRule", "User", "Tariff", "Setting"]) check(`журнал: есть записи ${e}`, txt.includes(e));
    check("журнал: паролей нет ни в каком виде", usedPasswords.every((p) => !txt.includes(p)));
    check("журнал: отметка смены пароля", txt.includes("passwordChanged"));
  }
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  process.exitCode = 1;
} finally {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch (e) {
      console.error(`  [уборка] ${e.message}`);
      process.exitCode = 1;
    }
  }
  await browser.close();
  await prisma?.$disconnect();
}
if (process.exitCode) process.exit(1);
finish("Настройки CRM (МФ-2)");
