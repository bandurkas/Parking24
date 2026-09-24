// Ф13: табель рабочих смен. Самоотметка пяти ролей (приход, уход, отмена, двойное открытие, забытый уход),
// сетка владельца и администратора (ручная отметка, «+» в непустой клетке, «уже отмечен», снятие в журнал), сводка, отчёт, справочник.
// Локально: node tests/e2e/staff.mjs --base http://localhost:3107. Шаги с Prisma — только против локальной базы.
// На stage логины, связанные с боевыми карточками, не трогаем: их самоотметка пропускается (Ф13 реш. 4.7.2).
import { BASE, loadPlaywright, check, equal, finish } from "./lib.mjs";

const PW = {
  owner: process.env.E2E_OWNER_PASSWORD ?? "owner12345",
  admin: process.env.E2E_ADMIN_PASSWORD ?? "admin12345",
  guard: process.env.E2E_GUARD_PASSWORD ?? "guard12345",
  driver: process.env.E2E_DRIVER_PASSWORD ?? "driver12345",
  parker: process.env.E2E_PARKER_PASSWORD ?? "parker12345",
};
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + "/");
const R = Date.now().toString(36).slice(-4).toUpperCase();
const N = { smeny: `E2E Смены ${R}`, sutki: `E2E Сутки ${R}`, podmena: `E2E Подмена ${R}`, driver: `E2E Водитель ${R}`, parker: `E2E Парковщик ${R}`, admin: `E2E Админ ${R}`, guard: `E2E Охрана ${R}`, clean: `E2E Уборка ${R}` };

// ── время: те же правила, что src/lib/workshift.ts (Москва = UTC+3 круглый год) ──
const MSK = 3 * 3_600_000;
const mskIso = (t) => new Date(t + MSK).toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
const mskMin = (t) => { const d = new Date(t + MSK); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const tabelToday = () => mskIso(Date.now() - 2 * 3_600_000);
const WIN = { DAY: [480, 1200], NIGHT: [1200, 1920], FULL: [480, 1920] };
const minutesFrom = (date, t) => daysBetween(date, mskIso(t)) * 1440 + mskMin(t);
function suggested(slots, t = Date.now()) {
  const today = mskIso(t);
  let best = null;
  for (const date of [addDays(today, -1), today])
    for (const slot of ["DAY", "NIGHT", "FULL"]) {
      if (!slots.includes(slot)) continue;
      const [s, e] = WIN[slot];
      const m = minutesFrom(date, t);
      if (m >= s - 120 && m < e && (!best || s - m > best.at)) best = { date, slot, at: s - m };
    }
  return best;
}
const LABEL = { DAY: "День", NIGHT: "Ночь", FULL: "Сутки" };
const short = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(iso + "T00:00:00Z")).replace(".", "");
const month = (iso) => iso.slice(0, 7);
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
let prisma = null;
if (LOCAL) {
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();
}

async function open(login, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [ошибка страницы ${login}] ${e.message}`));
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', PW[login]);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }), page.click('button[type="submit"]')]);
  return { ctx, page };
}
// Кнопка до гидратации молчит: ждём обработчики React на самом элементе
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

// ── экран поля: таблетка и лист ──
const pill = (page) => page.locator('button[aria-label="Моя смена"], button[aria-label^="На смене с"]').first();
async function sheet(page) {
  const dlg = page.getByRole("dialog", { name: "Моя смена" });
  if (await dlg.isVisible().catch(() => false)) return dlg;
  await (await live(pill(page))).click();
  await dlg.waitFor({ timeout: 10000 });
  return dlg;
}
async function closeSheet(page) {
  const dlg = page.getByRole("dialog", { name: "Моя смена" });
  if (await dlg.isVisible().catch(() => false)) await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}
async function pillText(page, re, timeout = 15000) {
  const end = Date.now() + timeout;
  let t = "";
  while (Date.now() < end) {
    t = nb(await pill(page).innerText().catch(() => "")).trim();
    if (re.test(t)) return t;
    await page.waitForTimeout(200);
  }
  return t;
}
async function headerOk(page, who) {
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const h = document.querySelector("header");
      return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, h: h ? h.getBoundingClientRect().height : 0 };
    });
    check(`${who} ${width} px: без горизонтальной прокрутки, шапка в одну строку`, r.scroll <= r.client && r.h > 0 && r.h <= 72, JSON.stringify(r));
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

// ── сетка ──
async function gotoGrid(page, iso) {
  await page.goto(`${BASE}/admin/staff?m=${month(iso)}`, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor({ timeout: 20000 });
}
async function posId(page, name) {
  return page.locator(`th[data-pos-name="${name}"]`).first().getAttribute("data-pos");
}
const cellSel = (pid, slot, date) => `[data-cell="${pid}|${slot}|${date}"]`;
const chipsIn = (page, pid, slot, date, name) => page.locator(`${cellSel(pid, slot, date)} [data-name="${name}"]`);
async function openPicker(page, pid, slot, date) {
  await (await live(page.locator(`[data-add="${pid}|${slot}|${date}"]`))).click();
  const dlg = page.getByRole("dialog", { name: "Кто работал" });
  await dlg.waitFor({ timeout: 10000 });
  return dlg;
}
async function waitCount(loc, n, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await loc.count()) === n) return n;
    await loc.page().waitForTimeout(200);
  }
  return loc.count();
}

// ── справочник ──
async function people(page) {
  await page.goto(`${BASE}/admin/staff/people`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Справочник табеля" }).waitFor({ timeout: 20000 });
}
async function addPosition(page, name, slots) {
  await (await live(page.getByRole("button", { name: "Добавить должность" }))).click();
  const form = page.locator('[aria-label="Должность"]');
  await form.getByLabel("Название должности").fill(name);
  const box = (legend, s) => form.locator("fieldset", { hasText: legend }).getByLabel(LABEL[s], { exact: true });
  for (const s of ["DAY", "NIGHT", "FULL"]) await box("Смены", s).setChecked(slots.includes(s));
  await form.getByRole("button", { name: "Сохранить" }).click();
  await page.locator(`[data-position="${name}"]`).waitFor({ timeout: 15000 });
}
async function addEmployee(page, name, position, login) {
  await (await live(page.getByRole("button", { name: "Добавить сотрудника" }))).click();
  const form = page.locator('[aria-label="Сотрудник"]');
  await form.getByLabel("Имя", { exact: true }).fill(name);
  await form.getByLabel("Должность").selectOption({ label: position });
  if (login) {
    const value = await form.getByLabel("Логин").locator("option").evaluateAll((os, l) => os.find((o) => o.textContent.startsWith(`${l} — `))?.value ?? "", login);
    if (value) await form.getByLabel("Логин").selectOption(value);
  }
  await form.getByRole("button", { name: "Сохранить" }).click();
  await page.locator(`[data-employee="${name}"]`).waitFor({ timeout: 15000 });
}
async function editEmployee(page, name, fn) {
  await (await live(page.locator(`[data-employee="${name}"]`).getByRole("button", { name: "Изменить" }))).click();
  const form = page.locator('[aria-label="Сотрудник"]');
  await form.waitFor();
  await fn(form);
}
// Логины, связанные с карточками: боевые не трогаем, от старых E2E — отвязываем
async function linkedLogins(page) {
  return page.locator("[data-employee]").evaluateAll((els) =>
    els.map((e) => ({ name: e.getAttribute("data-employee"), login: /логин (\S+) ·/.exec(e.textContent ?? "")?.[1] ?? null })).filter((x) => x.login),
  );
}
async function unlinkE2E(page) {
  for (let i = 0; i < 20; i++) {
    const row = (await linkedLogins(page)).find((x) => x.name.startsWith("E2E"));
    if (!row) return;
    await editEmployee(page, row.name, async (form) => {
      await form.getByLabel("Логин").selectOption("");
      await form.getByRole("button", { name: "Сохранить" }).click();
    });
    await page.locator('[aria-label="Сотрудник"]').waitFor({ state: "hidden", timeout: 15000 });
  }
}

const T = tabelToday();
const Y = addDays(T, -1);
const Y2 = addDays(T, -2);
const busy = new Set();
const selfOk = (login) => !busy.has(login);
let fail = null;

try {
  console.log(`\nТабель рабочих смен (Ф13): ${BASE}, прогон ${R}, «сегодня» табеля ${T}${LOCAL ? "" : " (stage: шаги с базой пропущены)"}`);

  // ── 1. Владелец: уборка связей прошлых прогонов, боевые карточки не трогаем ──
  const owner = await open("owner");
  await people(owner.page);
  await unlinkE2E(owner.page);
  for (const x of await linkedLogins(owner.page)) {
    if (["admin", "guard", "driver", "parker"].includes(x.login) && !x.name.startsWith("E2E")) {
      busy.add(x.login);
      console.log(`  ⚠ логин ${x.login} связан с боевой карточкой «${x.name}» — самоотметка им пропущена`);
    }
  }
  check("1. справочник: логины карточек E2E отвязаны", !(await linkedLogins(owner.page)).some((x) => x.name.startsWith("E2E")));

  // ── 2. До привязки ──
  const admin = await open("admin");
  await admin.page.goto(`${BASE}/admin/staff`, { waitUntil: "domcontentloaded" });
  if (selfOk("admin")) check("2. администратор без карточки: «Вас ещё нет в табеле»", (await body(admin.page)).includes("Вас ещё нет в табеле"));
  await admin.page.goto(`${BASE}/admin/staff/people`, { waitUntil: "domcontentloaded" });
  check("2. администратор: справочник → редирект", !admin.page.url().includes("/staff/people"), admin.page.url());

  const parker = await open("parker", { width: 390, height: 844 });
  if (selfOk("parker")) {
    const s = await sheet(parker.page);
    check("2. парковщик без карточки: «Вас ещё нет в табеле»", nb(await s.innerText()).includes("Вас ещё нет в табеле"));
    await closeSheet(parker.page);
  }
  const driver = await open("driver", { width: 390, height: 844 });
  await driver.page.goto(`${BASE}/admin/staff`, { waitUntil: "domcontentloaded" });
  check("2. водитель: /admin/staff → /admin/transfers", driver.page.url().includes("/admin/transfers"), driver.page.url());

  // ── 3. Владелец заводит должности и карточки ──
  await people(owner.page);
  await addPosition(owner.page, N.smeny, ["DAY", "NIGHT"]);
  await addPosition(owner.page, N.sutki, ["FULL"]);
  await addPosition(owner.page, N.podmena, ["DAY", "NIGHT", "FULL"]);
  await addEmployee(owner.page, N.driver, N.smeny, selfOk("driver") && "driver");
  await addEmployee(owner.page, N.parker, N.smeny, selfOk("parker") && "parker");
  await addEmployee(owner.page, N.admin, N.smeny, selfOk("admin") && "admin");
  await addEmployee(owner.page, N.guard, N.sutki, selfOk("guard") && "guard");
  await addEmployee(owner.page, N.clean, N.sutki, null); // без логина — отмечает администратор
  const linked = await linkedLogins(owner.page);
  check("3. карточки заведены, логины связаны", ["driver", "parker", "admin", "guard"].filter(selfOk).every((l) => linked.some((x) => x.login === l && x.name.startsWith("E2E"))), JSON.stringify(linked));

  await gotoGrid(admin.page, T);
  const P = { smeny: await posId(admin.page, N.smeny), sutki: await posId(admin.page, N.sutki), podmena: await posId(admin.page, N.podmena) };
  check("3. колонки должностей в сетке", !!(P.smeny && P.sutki && P.podmena), JSON.stringify(P));
  const emp = LOCAL ? Object.fromEntries((await prisma.employee.findMany({ where: { name: { endsWith: R, startsWith: "E2E" } } })).map((e) => [e.name, e.id])) : {};

  const sd = suggested(["DAY", "NIGHT"]); // водитель, парковщик, администратор
  const gd = suggested(["FULL"]); // охрана
  let driverShift = null;

  if (selfOk("driver")) {
    // ── 4. Приход на ручную отметку администратора, отмена — снова «вручную» ──
    await gotoGrid(admin.page, sd.date);
    let dlg = await openPicker(admin.page, P.smeny, sd.slot, sd.date);
    await dlg.getByRole("button", { name: new RegExp(`^${N.driver}`) }).click();
    equal("4. ручная отметка водителя в клетке", await waitCount(chipsIn(admin.page, P.smeny, sd.slot, sd.date, N.driver), 1), 1);

    await driver.page.goto(`${BASE}/admin/transfers`, { waitUntil: "domcontentloaded" });
    let s = await sheet(driver.page);
    await (await live(s.getByRole("button", { name: "Отметить приход" }))).click();
    check("4. водитель: приход на ручную отметку — таблетка «● ЧЧ:ММ»", /^● \d\d:\d\d$/.test(await pillText(driver.page, /^●/)));
    await gotoGrid(admin.page, sd.date);
    const c1 = chipsIn(admin.page, P.smeny, sd.slot, sd.date, N.driver);
    equal("4. в клетке один чип водителя", await c1.count(), 1);
    equal("4. чип со временем прихода (на смене), не «вручную»", await c1.first().getAttribute("data-state"), "open");
    s = await sheet(driver.page);
    await (await live(s.getByRole("button", { name: "Отменить приход" }))).click();
    check("4. «Отменить приход» → «Смена»", (await pillText(driver.page, /^Смена$/)) === "Смена");
    await closeSheet(driver.page);
    await gotoGrid(admin.page, sd.date);
    equal("4. после отмены чип снова «вручную»", await chipsIn(admin.page, P.smeny, sd.slot, sd.date, N.driver).first().getAttribute("data-state"), "manual");
    await (await live(chipsIn(admin.page, P.smeny, sd.slot, sd.date, N.driver))).click();
    await admin.page.getByRole("dialog", { name: "Отметка" }).getByRole("button", { name: "Снять отметку" }).click();
    equal("4. ручная отметка снята без причины", await waitCount(chipsIn(admin.page, P.smeny, sd.slot, sd.date, N.driver), 0), 0);

    // ── 5. Приход водителя: предложенный слот, F5, без денег и чужих имён, шапка ──
    await driver.page.goto(`${BASE}/admin/transfers`, { waitUntil: "domcontentloaded" });
    check("5. водитель: таблетка «Смена»", (await pillText(driver.page, /^Смена$/)) === "Смена");
    s = await sheet(driver.page);
    const chosen = nb(await s.locator('button[aria-pressed="true"]').first().innerText());
    check("5. первым выбран предложенный вариант", chosen.startsWith(`${LABEL[sd.slot]} · ${short(sd.date)}`), `${chosen} / ${LABEL[sd.slot]} · ${short(sd.date)}`);
    await (await live(s.getByRole("button", { name: "Отметить приход" }))).click();
    const t1 = await pillText(driver.page, /^●/);
    check("5. приход → «● ЧЧ:ММ»", /^● \d\d:\d\d$/.test(t1), t1);
    await driver.page.reload({ waitUntil: "domcontentloaded" });
    equal("5. после F5 так же", await pillText(driver.page, /^●/), t1);
    const b = await body(driver.page);
    check("5. нет ₽ и чужих имён", !/₽/.test(b) && ![N.parker, N.admin, N.guard].some((n) => b.includes(n)));
    equal("5. нет tel:-ссылок", await driver.page.locator('a[href^="tel:"]').count(), 0);
    await headerOk(driver.page, "5. водитель");

    // ── 6. Отмена прихода ──
    s = await sheet(driver.page);
    await (await live(s.getByRole("button", { name: "Отменить приход" }))).click();
    check("6. «Отменить» → снова «Смена»", (await pillText(driver.page, /^Смена$/)) === "Смена");
    await closeSheet(driver.page);

    // ── 7. Двойное открытие с двух телефонов ──
    const driver2 = await open("driver", { width: 390, height: 844 });
    const s2 = await sheet(driver2.page);
    s = await sheet(driver.page);
    await (await live(s.getByRole("button", { name: "Отметить приход" }))).click();
    const t2 = await pillText(driver.page, /^●/);
    check("7. первый телефон: приход", /^● \d\d:\d\d$/.test(t2), t2);
    await (await live(s2.getByRole("button", { name: "Отметить приход" }))).click();
    await s2.getByRole("status").waitFor({ timeout: 10000 }).catch(() => {});
    check("7. второй телефон: «Смена уже открыта…»", nb(await s2.innerText()).includes("Смена уже открыта"));
    await driver2.page.reload({ waitUntil: "domcontentloaded" });
    equal("7. второй телефон после F5 — то же время", await pillText(driver2.page, /^●/), t2);
    await driver2.ctx.close();

    // ── 8. Свои смены за месяц, «‹» и «›» ──
    s = await sheet(driver.page);
    equal("8. «Смен: 1»", await s.locator("[data-my-count]").getAttribute("data-my-count"), "1");
    check("8. строка смены со временем прихода", /\d\d:\d\d — на смене/.test(nb(await s.innerText())));
    const title = nb(await s.locator("span.font-semibold").filter({ hasText: /\d{4}$/ }).first().innerText());
    await s.getByRole("button", { name: "Прошлый месяц" }).click();
    await driver.page.waitForFunction((t) => !document.querySelector('[role="dialog"]')?.textContent?.includes(t), title, { timeout: 10000 }).catch(() => {});
    check("8. «‹» — прошлый месяц", !nb(await s.innerText()).includes(title));
    await s.getByRole("button", { name: "Следующий месяц" }).click();
    await driver.page.waitForFunction((t) => document.querySelector('[role="dialog"]')?.textContent?.includes(t), title, { timeout: 10000 }).catch(() => {});
    check("8. «›» — обратно", nb(await s.innerText()).includes(title));

    // ── 9. Уход, отмена ухода, P2002 в отмене ──
    const leave = async () => {
      const sh = await sheet(driver.page);
      await (await live(sh.getByRole("button", { name: "Отметить уход" }))).click();
      await sh.getByRole("button", { name: "Да, отметить уход" }).click();
      return (await pillText(driver.page, /^Смена$/)) === "Смена";
    };
    check("9. «Отметить уход» с подтверждением → «Смена»", await leave());
    s = await sheet(driver.page);
    check("9. в списке «приход–уход»", /\d\d:\d\d–\d\d:\d\d/.test(nb(await s.innerText())));
    await (await live(s.getByRole("button", { name: "Отменить уход" }))).click();
    check("9. «Отменить уход» → снова на смене", /^●/.test(await pillText(driver.page, /^●/)));
    check("9. снова «Отметить уход»", await leave());
    if (LOCAL) {
      const x = await prisma.workShift.create({
        data: { employeeId: emp[N.driver], positionId: P.podmena, date: new Date(addDays(T, -5) + "T00:00:00Z"), slot: "DAY", hours: 12, startedAt: new Date(Date.now() - 2 * 3_600_000), openFor: emp[N.driver] },
      });
      s = await sheet(driver.page);
      await (await live(s.getByRole("button", { name: "Отменить уход" }))).click();
      await s.getByRole("status").waitFor({ timeout: 10000 }).catch(() => {});
      check("9. отмена ухода при другой открытой смене — понятный текст (P2002)", nb(await s.innerText()).includes("Уже открыта другая смена"));
      await prisma.workShift.delete({ where: { id: x.id } });
      await closeSheet(driver.page);
    }
    driverShift = sd;
  }

  // ── 10. Парковщик: забытый уход 20 ч назад не мешает новому приходу ──
  if (selfOk("parker")) {
    let stale = null;
    if (LOCAL) {
      const t = Date.now() - 20 * 3_600_000;
      const h = mskMin(t) / 60;
      const slot = h >= 8 && h < 20 ? "DAY" : "NIGHT";
      const date = h < 8 ? addDays(mskIso(t), -1) : mskIso(t);
      stale = await prisma.workShift.create({ data: { employeeId: emp[N.parker], positionId: P.podmena, date: new Date(date + "T00:00:00Z"), slot, hours: 12, startedAt: new Date(t), openFor: emp[N.parker] } });
    }
    await parker.page.goto(`${BASE}/admin/parking-lot`, { waitUntil: "domcontentloaded" });
    const s = await sheet(parker.page);
    await (await live(s.getByRole("button", { name: "Отметить приход" }))).click();
    check("10. парковщик: приход → зелёная таблетка", /^● \d\d:\d\d$/.test(await pillText(parker.page, /^●/)));
    if (stale) {
      const old = await prisma.workShift.findUnique({ where: { id: stale.id } });
      check("10. у забытой смены снят openFor, уход не выдуман", old && old.openFor === null && old.endedAt === null, JSON.stringify(old && { openFor: old.openFor, endedAt: old.endedAt }));
    }
    const b = await body(parker.page);
    check("10. парковщик: нет ₽ и чужих имён", !/₽/.test(b) && ![N.driver, N.admin, N.guard].some((n) => b.includes(n)));
    equal("10. парковщик: нет tel:-ссылок", await parker.page.locator('a[href^="tel:"]').count(), 0);
    equal("10. парковщик: нет «Заехал»/«Выехал»", await parker.page.getByRole("button", { name: /^(Заехал|Выехал)$/ }).count(), 0);
    await headerOk(parker.page, "10. парковщик");
  }
  await parker.ctx.close();

  // ── 11. Охрана: сутки на КПП, клавиатура видна ──
  let guardDate = null;
  if (selfOk("guard")) {
    const guard = await open("guard", { width: 390, height: 844 });
    const s = await sheet(guard.page);
    const chosen = nb(await s.locator('button[aria-pressed="true"]').first().innerText());
    check("11. охрана: предложены сутки", chosen.startsWith(`Сутки · ${short(gd.date)}`), chosen);
    await (await live(s.getByRole("button", { name: "Отметить приход" }))).click();
    check("11. охрана: приход → зелёная таблетка", /^● \d\d:\d\d$/.test(await pillText(guard.page, /^●/)));
    await closeSheet(guard.page);
    await headerOk(guard.page, "11. КПП");
    const last = await guard.page.getByRole("button", { name: "Стереть" }).boundingBox();
    check("11. клавиатура КПП целиком на 390×844", !!last && last.y + last.height <= 844, JSON.stringify(last));
    check("11. вкладки «Заезд»/«Выезд» на месте", (await guard.page.getByRole("button", { name: /Заезд ·/ }).count()) === 1);
    guardDate = gd.date;
    await guard.ctx.close();
  }

  // ── 12. Владелец на КПП через ?guard=1 — таблетки нет ──
  await owner.page.goto(`${BASE}/admin/today?guard=1`, { waitUntil: "domcontentloaded" });
  await owner.page.locator("header").first().waitFor();
  equal("12. владелец на КПП: кнопки смены нет", await pill(owner.page).count(), 0);

  // ── 13. Администратор: приход карточкой, себя в выборе не видит ──
  await gotoGrid(admin.page, T);
  if (selfOk("admin")) {
    const card = admin.page.locator('section[aria-label="Моя рабочая смена"]');
    await (await live(card.getByRole("button", { name: "Отметить приход" }))).click();
    await card.getByRole("button", { name: "Отметить уход" }).waitFor({ timeout: 15000 });
    await gotoGrid(admin.page, sd.date);
    equal("13. чип администратора в сетке", await admin.page.locator(`[data-name="${N.admin}"]`).count(), 1);
  }
  {
    const dlg = await openPicker(admin.page, P.podmena, "DAY", T);
    equal("13. администратор не видит себя в выборе", await dlg.getByRole("button", { name: new RegExp(`^${N.admin}`) }).count(), selfOk("admin") ? 0 : 1);
    await admin.page.keyboard.press("Escape");
    await dlg.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
  if (driverShift) {
    await gotoGrid(admin.page, driverShift.date);
    equal("13. у водителя в табеле ровно один чип", await admin.page.locator(`[data-name="${N.driver}"]`).count(), 1);
  }

  // ── 14. «+» в непустой клетке — второй человек (без логина) ──
  const cd = guardDate ?? T;
  await gotoGrid(admin.page, cd);
  {
    const dlg = await openPicker(admin.page, P.sutki, "FULL", cd);
    await dlg.getByRole("button", { name: new RegExp(`^${N.clean}`) }).click();
    equal("14. «E2E Уборка» встала в клетку без перезагрузки", await waitCount(chipsIn(admin.page, P.sutki, "FULL", cd, N.clean), 1), 1);
    if (guardDate) equal("14. в клетке два чипа (охрана и уборка)", await admin.page.locator(`${cellSel(P.sutki, "FULL", cd)} [data-chip]`).count(), 2);
    await admin.page.waitForTimeout(500);
    await admin.page.reload({ waitUntil: "domcontentloaded" });
    equal("14. после F5 на месте", await waitCount(chipsIn(admin.page, P.sutki, "FULL", cd, N.clean), 1), 1);
    const b = await body(admin.page);
    check("14. в табеле нет ₽ и «ставка»", !/₽|ставк/i.test(b));
  }

  // ── 15. Вчера и позавчера — ставится двумя кликами; завтра — не кликается ──
  await gotoGrid(admin.page, Y);
  {
    const dlg = await openPicker(admin.page, P.podmena, "NIGHT", Y);
    await dlg.getByRole("button", { name: new RegExp(`^${N.clean}`) }).click();
    equal("15. вчера: отметка поставлена", await waitCount(chipsIn(admin.page, P.podmena, "NIGHT", Y, N.clean), 1), 1);
  }
  await gotoGrid(admin.page, Y2);
  {
    const dlg = await openPicker(admin.page, P.sutki, "FULL", Y2);
    await dlg.getByRole("button", { name: new RegExp(`^${N.clean}`) }).click();
    equal("15. позавчера: чип «вручную»", await waitCount(admin.page.locator(`${cellSel(P.sutki, "FULL", Y2)} [data-name="${N.clean}"][data-state="manual"]`), 1), 1);
  }
  const TM = addDays(T, 1);
  if (month(TM) === month(Y2)) equal("15. завтрашняя клетка не кликается", await admin.page.locator(`[data-add="${P.sutki}|FULL|${TM}"]`).count(), 0);

  // ── 16. Уже отмечен в другой колонке; другой слот — принят ──
  if (driverShift) {
    const { date, slot } = driverShift;
    await gotoGrid(admin.page, date);
    let dlg = await openPicker(admin.page, P.podmena, slot, date);
    await dlg.getByRole("button", { name: new RegExp(`^${N.driver}`) }).click();
    const alert = admin.page.locator("[data-grid-error]");
    await alert.waitFor({ timeout: 10000 }).catch(() => {});
    check("16. отказ «уже отмечен: E2E Смены»", nb(await alert.innerText().catch(() => "")).includes(`${N.driver} уже отмечен: ${N.smeny}`));
    equal("16. чип в чужой колонке не появился", await waitCount(chipsIn(admin.page, P.podmena, slot, date, N.driver), 0), 0);
    const other = slot === "DAY" ? "NIGHT" : "DAY";
    dlg = await openPicker(admin.page, P.podmena, other, date);
    await dlg.getByRole("button", { name: new RegExp(`^${N.driver}`) }).click();
    equal("16. другой слот той же даты — принят", await waitCount(chipsIn(admin.page, P.podmena, other, date, N.driver), 1), 1);

    // ── 17. Снять самоотметку водителя; в журнале — снимок со временем прихода ──
    await gotoGrid(admin.page, date);
    await (await live(chipsIn(admin.page, P.smeny, slot, date, N.driver))).click();
    await admin.page.getByRole("dialog", { name: "Отметка" }).getByRole("button", { name: "Снять отметку" }).click();
    equal("17. самоотметка снята", await waitCount(chipsIn(admin.page, P.smeny, slot, date, N.driver), 0), 0);
    // снятие оптимистичное: ждём, пока сервер запишет, — по журналу (время прихода «ГГГГ-ММ-ДД ЧЧ:ММ» пишет только снятие в сетке)
    const snap = /"startedAt":"\d{4}-\d\d-\d\d \d\d:\d\d"/;
    const rows = owner.page.locator("tr", { hasText: N.driver }).filter({ hasText: "DELETE" }).filter({ hasText: "WorkShift" });
    let txt = "";
    for (let i = 0; i < 10 && !snap.test(txt); i++) {
      await owner.page.goto(`${BASE}/admin/audit`, { waitUntil: "domcontentloaded" });
      txt = nb((await rows.allInnerTexts().catch(() => [])).join("\n"));
      if (!snap.test(txt)) await owner.page.waitForTimeout(500);
    }
    check("17. журнал: DELETE WorkShift со временем прихода", snap.test(txt), txt.slice(0, 200));
  }

  // ── 18. Сводка: столько же смен и часов, сколько чипов ──
  await gotoGrid(admin.page, T);
  {
    const chips = await admin.page.locator(`tr[data-date^="${month(T)}"] [data-name="${N.clean}"]`).evaluateAll((els) =>
      els.map((e) => ({ slot: e.closest("td")?.getAttribute("data-cell")?.split("|")[1] })),
    );
    // строк сводки по «Уборке» столько, сколько должностей, где она отмечена
    const rows = admin.page.locator(`section[aria-label="Сводка за месяц"] tr[data-row="${N.clean}"]`);
    const sum = async (sel) => (await rows.locator(sel).allInnerTexts()).reduce((a, x) => a + Number(x), 0);
    const [total, hours] = [await sum("[data-total]"), await sum("[data-hours]")];
    equal("18. сводка «Уборка»: смен = чипов", total, chips.length);
    equal("18. сводка «Уборка»: часы 24 за сутки, 12 за ночь", hours, chips.reduce((a, c) => a + (c.slot === "FULL" ? 24 : 12), 0));
  }

  // ── 19. Отчёт за период по умолчанию = сводка месяца ──
  {
    const grand = Number((await admin.page.locator("[data-grand-total]").innerText().catch(() => "0")) || 0);
    await owner.page.goto(`${BASE}/admin/staff/report`, { waitUntil: "domcontentloaded" });
    await owner.page.locator("[data-summary]").waitFor({ timeout: 20000 });
    const rep = Number((await owner.page.locator("[data-grand-total]").innerText().catch(() => "0")) || 0);
    equal("19. отчёт за период по умолчанию = сводка месяца", rep, grand);
    check("19. в отчёте нет ₽ и «ставка»", !/₽|ставк/i.test(await body(owner.page)));
  }

  // ── 20. Сотрудника со сменами не удалить — только выключить ──
  await people(owner.page);
  await editEmployee(owner.page, N.clean, async (form) => {
    await form.getByRole("button", { name: "Удалить" }).click();
    await form.locator(".adm-err").waitFor({ timeout: 10000 });
    check("20. удалить со сменами — отказ", nb(await form.locator(".adm-err").innerText()).includes("только выключить"));
    await form.getByLabel("Активен").uncheck();
    await form.getByRole("button", { name: "Сохранить" }).click();
  });
  await owner.page.locator('[aria-label="Сотрудник"]').waitFor({ state: "hidden", timeout: 15000 });
  await gotoGrid(admin.page, cd);
  equal("20. выключенный: чип в сетке на месте", await chipsIn(admin.page, P.sutki, "FULL", cd, N.clean).count(), 1);
  {
    const dlg = await openPicker(admin.page, P.podmena, "FULL", T);
    equal("20. выключенного нет в выборе", await dlg.getByRole("button", { name: new RegExp(`^${N.clean}`) }).count(), 0);
    await admin.page.keyboard.press("Escape");
  }

  // ── 21. Меню: «Табель» — ссылка ──
  await owner.page.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
  check("21. «Табель» в меню — ссылка", (await owner.page.locator('aside a[href="/admin/staff"], nav a[href="/admin/staff"]').count()) > 0);
  {
    const m = await open("owner", { width: 390, height: 844 });
    await m.page.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    const more = await live(m.page.getByRole("button", { name: "Ещё" }));
    const sh = m.page.getByRole("dialog", { name: "Меню" });
    for (let i = 0; i < 5 && !(await sh.isVisible().catch(() => false)); i++) {
      await more.click();
      await sh.waitFor({ timeout: 2500 }).catch(() => {});
    }
    check("21. «Табель» в листе «Ещё» — ссылка", (await sh.locator('a[href="/admin/staff"]').count()) === 1);
    await m.ctx.close();
  }
} catch (e) {
  fail = e;
  console.error(`\nСбой сценария: ${e.message}`);
} finally {
  // ── 22. Финал: отвязать логины у карточек E2E (остальное — cleanup) ──
  try {
    const o = await open("owner");
    await people(o.page);
    await unlinkE2E(o.page);
    check("22. логины карточек E2E отвязаны", !(await linkedLogins(o.page)).some((x) => x.name.startsWith("E2E")));
  } catch (e) {
    console.error(`Уборка связей не удалась: ${e.message}`);
  }
  await browser.close();
  await prisma?.$disconnect();
}
if (fail) process.exit(1);
finish("Табель рабочих смен (Ф13)");
