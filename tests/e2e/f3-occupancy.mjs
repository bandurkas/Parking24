// Ф3 «Занятость по ТЗ и потолок 405 в CRM» (docs/phases/PHASE_03_OCCUPANCY.md).
// Панель по ТЗ 4.2 (пул 405 без фур, «свободно» от машин на парковке, фуры отдельно, категории без вместимостей),
// одно число на панели, странице ёмкости, «Сегодня», доске и дашборде; честные окна 24 ч; «Новая заявка» держит место
// по настройке; потолок в CRM (создание, «Подтвердить место», «Исправить статус», «Изменить бронь»), подтверждение
// владельцем сверх вместимости, «Заехал» при полном пуле не блокируется; вместимость ниже занятости — только с подтверждением.
// Брони-подпорки создаются прямо в базе (госномер Т000…, телефон +7999… — их убирает cleanup.mjs), настройки возвращаются.
// Только локально. Запуск: node tests/e2e/f3-occupancy.mjs --base http://localhost:3102 --login owner --password owner12345
// Второй вход — admin (--admin-password или E2E_ADMIN_PASSWORD, по умолчанию admin12345). Не запускать с 00:00 до 01:00 МСК.
import { BASE, arg, withBrowser, adminLogin, check, equal, finish, testPhone, testPlate, moscowPlus, fillReliably } from "./lib.mjs";
import { LOCAL, db, live } from "./autoconfirm-fixture.mjs";

const ADMIN_PASSWORD = arg("admin-password", process.env.E2E_ADMIN_PASSWORD ?? "admin12345");
const KEYS = ["parking.capacityTotal", "parking.capacityTruck", "parking.autoConfirmLimit", "parking.newLeadHoldHours", "parking.enforceCapacity"];
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");
const toDate = (iso) => new Date(`${iso}T00:00:00.000Z`);
const addIso = (iso, n) => new Date(toDate(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const daysIncl = (a, b) => Math.round((toDate(b) - toDate(a)) / 86_400_000) + 1;
const today = moscowPlus(0);

// Дата и время по Москве через h часов от сейчас
function mskIn(h) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(Date.now() + h * 3_600_000)).map((x) => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

let boards = null;
async function mk({ kind = "PARKING", status, vt = "CAR", from, to, timeFrom = null, timeTo = null, phone = `+7${testPhone()}` }) {
  boards ??= Object.fromEntries((await db().board.findMany()).map((b) => [b.kind, b.id]));
  const now = new Date();
  return db().booking.create({
    data: {
      boardId: boards[kind], kind, status, vehicleType: kind === "PARKING" ? vt : null, roomType: kind === "ROOM" ? "twin" : null, plate: testPlate(), contactPhone: phone, contactName: "E2E Ф3",
      dateFrom: toDate(from), dateTo: toDate(to), timeFrom, timeTo, days: daysIncl(from, to), amount: 350 * daysIncl(from, to), source: "CALL",
      confirmedAt: status === "CONFIRMED" ? now : null, checkedInAt: status === "CHECKED_IN" ? now : null, rejectedAt: status === "REJECTED" ? now : null, rejectKind: status === "REJECTED" ? "OTHER" : null, cancelledAt: status === "CANCELLED" ? now : null,
    },
  });
}

async function setKey(key, value) {
  await db().setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function until(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
}

const num = (s) => Number(nb(s).replace(/\D/g, ""));

await withBrowser(async (page) => {
  console.log(`\nФ3 занятость и потолок: ${BASE}, сегодня ${today}`);
  if (!LOCAL) {
    console.log("  Пропуск: сценарий меняет базу — только локально");
    return finish("Ф3 занятость");
  }
  await adminLogin(page);
  await page.goto(`${BASE}/admin/settings/capacity`, { waitUntil: "domcontentloaded" });
  if (!page.url().includes("/settings/capacity")) {
    console.log("  Пропуск: нужен вход владельцем (--login owner --password …)");
    return finish("Ф3 занятость");
  }
  const dialogs = [];
  let agree = true;
  page.on("dialog", (d) => { dialogs.push(nb(d.message())); (agree ? d.accept() : d.dismiss()).catch(() => {}); });

  // Второй вход — администратор
  const adminCtx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  await admin.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await admin.fill('input[name="login"]', "admin");
  await admin.fill('input[name="password"]', ADMIN_PASSWORD);
  await Promise.all([admin.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }), admin.click('button[type="submit"]')]);
  admin.on("dialog", (d) => d.dismiss().catch(() => {}));

  const saved = await db().setting.findMany({ where: { key: { in: KEYS } } });
  const settings = async () => Object.fromEntries((await db().setting.findMany({ where: { key: { in: KEYS } } })).map((s) => [s.key, s.value]));
  const cap0 = await settings();
  const capTotal = Number(cap0["parking.capacityTotal"] ?? 405);
  const capTruck = Number(cap0["parking.capacityTruck"] ?? 10);

  async function panel(p = page) {
    await p.goto(`${BASE}/admin/occupancy?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    const tile = async (label) => {
      const card = p.locator(".adm-card", { hasText: label }).first();
      return { value: num(await card.locator("div.font-mono").first().innerText()), hint: nb(await card.locator("div").last().innerText()) };
    };
    const row = async (id) => {
      const t = nb(await p.getByTestId(id).innerText()).replace(/\s+/g, " ");
      const m = t.match(/на стоянке (\d+) · занято бронями (\d+) из (\d+) · под новые заявки (\d+)/);
      if (!m) throw new Error(`строка ${id} не разобрана: ${t}`);
      return { onSite: +m[1], held: +m[2], capacity: +m[3], open: +m[4] };
    };
    const [onSite, arrivals, departures, free, total] = await Promise.all(["Авто на парковке", "Заезды за 24 ч", "Выезды за 24 ч", "Свободно сейчас", "Всего мест"].map(tile));
    return { onSite, arrivals, departures, free, total, pool: await row("occupancy-pool"), truck: await row("occupancy-truck"), body: nb(await p.locator("body").innerText()) };
  }

  async function strip() {
    await page.goto(`${BASE}/admin/boards/parking?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    const t = nb(await page.locator('a[href="/admin/today"]').filter({ hasText: "заезд" }).first().innerText()).replace(/\s+/g, " ");
    const occ = nb(await page.locator('a[href="/admin/occupancy"]').filter({ hasText: "Пул" }).first().innerText()).replace(/\s+/g, " ");
    return { arrivals: +(t.match(/(\d+) заезд/)?.[1] ?? NaN), departures: +(t.match(/(\d+) выезд/)?.[1] ?? NaN), occ };
  }

  async function poolBusy(from, n) {
    await page.goto(`${BASE}/admin/occupancy?from=${from}&t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    const cells = page.locator("tr", { hasText: "Всего в пуле" }).locator("td[title]");
    const busy = [];
    for (let i = 0; i < n; i++) busy.push(Number((await cells.nth(i).getAttribute("title"))?.match(/Занято (\d+)/)?.[1] ?? NaN));
    return Math.max(...busy);
  }

  async function saveCapacity(fields) {
    await page.goto(`${BASE}/admin/settings/capacity?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    for (const [label, value] of fields) if (!(await fillReliably(page.getByLabel(label, { exact: true }), String(value)))) throw new Error(`не удалось заполнить «${label}»`);
    await (await live(page.getByRole("button", { name: /^Сохранить/ }))).click();
  }

  async function quick(p, { from, to, vt = "Легковая", confirm = true }) {
    await p.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    const drawer = p.getByRole("dialog", { name: "Новая заявка" });
    await (await live(p.locator("header").getByRole("button", { name: /Новая заявка/i }))).click();
    if (!(await drawer.isVisible().catch(() => false))) {
      await p.waitForTimeout(1500);
      await p.keyboard.press("n");
    }
    await drawer.waitFor({ timeout: 15000 });
    const phone = testPhone();
    await fillReliably(drawer.getByPlaceholder("+7 9xx xxx-xx-xx"), phone);
    await fillReliably(drawer.getByLabel("Заезд", { exact: true }), from);
    await fillReliably(drawer.getByLabel("Выезд", { exact: true }), to);
    await fillReliably(drawer.getByPlaceholder("Госномер: А123ВС77"), testPlate());
    await drawer.getByRole("button", { name: vt, exact: true }).click();
    if (confirm) await drawer.getByRole("button", { name: "Сразу подтвердить" }).click();
    await p.waitForTimeout(900);
    return { drawer, phone: `+7${phone}` };
  }

  try {
    // ── 1. Панель по ТЗ 4.2 и одно число на всех экранах ──
    await setKey("parking.enforceCapacity", false);
    await setKey("parking.newLeadHoldHours", 0);
    const p0 = await panel();
    equal("панель: «Всего мест» = вместимость пула (фуры не входят)", p0.total.value, capTotal);
    equal("панель: «Свободно сейчас» = «Всего мест» − «Авто на парковке»", p0.free.value, p0.total.value - p0.onSite.value);
    equal("панель: подсказка «занято бронями» = строка «Пул»", Number(p0.free.hint.match(/занято бронями (\d+)/)?.[1]), p0.pool.held);
    equal("панель: строка «Фуры» со знаменателем из настроек", p0.truck.capacity, capTruck);
    check("плашки «Ёмкость по типам ТС — плейсхолдер» нет", !/плейсхолдер/.test(p0.body));

    await mk({ status: "CHECKED_IN", from: today, to: addIso(today, 3) });
    await mk({ status: "CHECKED_IN", vt: "TRUCK", from: today, to: addIso(today, 3) });
    const p1 = await panel();
    equal("машина заехала: «Авто на парковке» +1 (фура не считается)", p1.onSite.value - p0.onSite.value, 1);
    equal("машина заехала: «Свободно сейчас» −1", p1.free.value - p0.free.value, -1);
    equal("машина заехала: «занято бронями» пула +1", p1.pool.held - p0.pool.held, 1);
    equal("фура заехала: строка «Фуры» — на стоянке +1", p1.truck.onSite - p0.truck.onSite, 1);

    await page.goto(`${BASE}/admin/settings/capacity?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    check("страница ёмкости: то же «занято» пула и фур", nb(await page.locator("body").innerText()).includes(`Сейчас занято: пул ${p1.pool.held} из ${p1.pool.capacity}, фуры ${p1.truck.held} из ${p1.truck.capacity}`));
    await page.goto(`${BASE}/admin/today?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    const head = nb(await page.locator("header .adm-card").first().innerText()).replace(/\s+/g, "").toLowerCase();
    check("«Сегодня»: в шапке пул и фуры со знаменателем", head.includes(`${p1.pool.held}/${p1.pool.capacity}пул`) && head.includes(`${p1.truck.held}/${p1.truck.capacity}фуры`), head);
    check("«Сегодня»: «на стоянке» = «Авто на парковке»", head.includes(`${p1.onSite.value}настоянке`), head);
    const s1 = await strip();
    check("доска: полоса «Пул N/405 · Фуры M/10»", s1.occ.includes(`Пул ${p1.pool.held}/${p1.pool.capacity}`) && s1.occ.includes(`Фуры ${p1.truck.held}/${p1.truck.capacity}`), s1.occ);
    check("доска: категории без знаменателя", !/Легк \d+\//.test(s1.occ) && /Легк \d+/.test(s1.occ), s1.occ);
    const dashTile = async () => {
      await page.goto(`${BASE}/admin/dashboard?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
      return num(await page.locator(".adm-card", { hasText: "Сейчас на стоянке" }).first().locator("div.font-mono").innerText());
    };
    const d1 = await dashTile();
    equal("дашборд: «Сейчас на стоянке» = «Авто на парковке»", d1, p1.onSite.value);
    await mk({ kind: "ROOM", status: "CHECKED_IN", from: today, to: addIso(today, 1) });
    equal("дашборд: комната «Заехал» на парковку не попадает", await dashTile(), d1);

    await page.goto(`${BASE}/admin/occupancy?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    equal("сетка: «Фуры» со знаменателем", nb(await page.locator("tr", { hasText: "Фуры" }).locator("td").first().innerText()).replace(/\s+/g, " "), `Фуры /${capTruck}`);
    equal("сетка: у категорий знаменателя нет", nb(await page.locator("tr", { hasText: "Легковая" }).locator("td").first().innerText()).trim(), "Легковая");
    const todayCell = Number((await page.locator("tr", { hasText: "Всего в пуле" }).locator("td[title]").first().getAttribute("title"))?.match(/Занято (\d+) из (\d+)/)?.[1]);
    equal("сетка: сегодняшняя клетка «Всего в пуле» = «занято бронями»", todayCell, p1.pool.held);

    // ── 2. Окна 24 ч: одно правило на панели и на доске ──
    const w0 = await panel();
    const soonIn = mskIn(2);
    const lateIn = mskIn(-2);
    const soonOut = mskIn(3);
    await mk({ status: "AWAITING_PAYMENT", from: soonIn.iso, to: addIso(soonIn.iso, 2), timeFrom: soonIn.hhmm });
    await mk({ status: "CONFIRMED", from: lateIn.iso, to: addIso(lateIn.iso, 2), timeFrom: lateIn.hhmm });
    await mk({ status: "CONFIRMED", from: addIso(today, 3), to: addIso(today, 5) });
    await mk({ status: "NEW", from: soonIn.iso, to: addIso(soonIn.iso, 1), timeFrom: soonIn.hhmm });
    await mk({ status: "CHECKED_IN", from: addIso(today, -2), to: soonOut.iso, timeTo: soonOut.hhmm });
    await mk({ status: "CHECKED_IN", from: addIso(today, -3), to: addIso(today, -1) });
    await mk({ status: "CHECKED_IN", from: today, to: addIso(today, 5) });
    const w1 = await panel();
    equal("«Заезды за 24 ч»: +2 (в окне и опоздавший; «Новая» и послезавтра — нет)", w1.arrivals.value - w0.arrivals.value, 2);
    check("«Заезды за 24 ч»: подсказка «опаздывают»", /опаздывают \d+/.test(w1.arrivals.hint), w1.arrivals.hint);
    equal("«Выезды за 24 ч»: +2 (в окне и перестой; через 5 дней — нет)", w1.departures.value - w0.departures.value, 2);
    equal("«Выезды за 24 ч»: из них в перестое +1", Number(w1.departures.hint.match(/в перестое (\d+)/)?.[1] ?? 0) - Number(w0.departures.hint.match(/в перестое (\d+)/)?.[1] ?? 0), 1);
    const s2 = await strip();
    equal("доска: заезды = панель", s2.arrivals, w1.arrivals.value);
    equal("доска: выезды = панель", s2.departures, w1.departures.value);

    // ── 3. «Новая заявка» держит место по настройке ──
    await saveCapacity([["Новая заявка держит место, часов", 24]]);
    await page.getByText("Сохранено").waitFor({ timeout: 10000 });
    equal("настройка удержания сохраняется формой", (await settings())["parking.newLeadHoldHours"], 24);
    const h0 = (await panel()).pool.held;
    const lead = await quick(page, { from: today, to: addIso(today, 1), confirm: false });
    await (await live(lead.drawer.getByRole("button", { name: /^Создать$/ }))).click();
    await page.getByRole("link", { name: "открыть" }).waitFor({ timeout: 15000 });
    equal("удержание 24 ч: «Новая заявка» на сегодня — «занято бронями» +1", (await panel()).pool.held - h0, 1);
    await saveCapacity([["Новая заявка держит место, часов", 0]]);
    await page.getByText("Сохранено").waitFor({ timeout: 10000 });
    const h1 = (await panel()).pool.held;
    await mk({ status: "NEW", from: today, to: addIso(today, 1) });
    equal("удержание 0: «Новая заявка» место не держит", (await panel()).pool.held, h1);

    // ── 4. Потолок в CRM ──
    await page.goto(`${BASE}/admin/settings/capacity?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    const sw = await live(page.getByRole("switch", { name: "Проверка мест в CRM" }));
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
    await (await live(page.getByRole("button", { name: /^Сохранить/ }))).click();
    await page.getByText("Сохранено").waitFor({ timeout: 10000 });
    equal("проверка мест включается переключателем на странице «Ёмкость»", (await settings())["parking.enforceCapacity"], true);

    const F1 = moscowPlus(200 + Math.floor(Math.random() * 60));
    const F2 = addIso(F1, 2);
    const n0 = await poolBusy(F1, 3);
    const cap = n0 + 1;
    await setKey("parking.capacityTotal", cap);
    await setKey("parking.autoConfirmLimit", cap);
    const filler = await mk({ status: "CONFIRMED", from: F1, to: F2 });
    console.log(`  потолок: ${F1} → ${F2}, занято ${n0} + 1 из ${cap}`);

    // администратор: отказ с цифрами, без подтверждения сверх вместимости
    const a1 = await quick(admin, { from: F1, to: F2 });
    const hint = nb(await a1.drawer.innerText());
    check("быстрая бронь: подсказка «свободно 0 из N» по пулу", hint.includes(`свободно 0 из ${cap}`), hint.match(/свободно[^\n]*/)?.[0]);
    await a1.drawer.getByRole("button", { name: "Грузовая", exact: true }).click();
    await admin.waitForTimeout(900);
    check("быстрая бронь: для фуры — «из 10», отдельный пул", new RegExp(`свободно \\d+ из ${capTruck}`).test(nb(await a1.drawer.innerText())));
    await a1.drawer.getByRole("button", { name: "Легковая", exact: true }).click();
    await admin.waitForTimeout(900);
    await (await live(a1.drawer.getByRole("button", { name: /^Подтвердить$/ }))).click();
    const refusal = a1.drawer.locator("p", { hasText: "мест нет" });
    await refusal.waitFor({ timeout: 10000 });
    const rtext = nb(await refusal.innerText());
    check("администратор: отказ с датой и числами", rtext.includes(`мест нет: занято ${cap} из ${cap}`) && /На \d+ [а-я]+/.test(rtext) && rtext.includes("отметить выезд"), rtext);
    equal("администратор: кнопки «сверх вместимости» нет", await a1.drawer.getByRole("button", { name: "Подтвердить сверх вместимости" }).count(), 0);
    equal("администратор: бронь не создана", await db().booking.count({ where: { contactPhone: a1.phone } }), 0);
    await a1.drawer.getByRole("button", { name: "Заявка", exact: true }).click();
    await (await live(a1.drawer.getByRole("button", { name: /^Создать$/ }))).click();
    await admin.getByRole("link", { name: "открыть" }).waitFor({ timeout: 15000 });
    equal("«Новая заявка» при полном пуле записывается (это ещё не обещание места)", await db().booking.count({ where: { contactPhone: a1.phone, status: "NEW" } }), 1);

    // владелец: подтверждение сверх вместимости → бронь, лента, журнал, уведомление
    const o1 = await quick(page, { from: F1, to: F2 });
    await (await live(o1.drawer.getByRole("button", { name: /^Подтвердить$/ }))).click();
    const over = o1.drawer.getByRole("button", { name: "Подтвердить сверх вместимости" });
    await over.waitFor({ timeout: 10000 });
    check("владелец: отказ и кнопка «Подтвердить сверх вместимости»", nb(await o1.drawer.innerText()).includes("мест нет"));
    await over.click();
    await page.getByRole("link", { name: "открыть" }).waitFor({ timeout: 15000 });
    const ob = await db().booking.findFirst({ where: { contactPhone: o1.phone }, include: { interactions: true, notices: true } });
    equal("владелец: бронь создана «Подтверждена»", ob?.status, "CONFIRMED");
    check("лента брони: «Сверх вместимости (подтвердил владелец)»", !!ob?.interactions.some((i) => i.type === "SYSTEM" && /^Сверх вместимости \(подтвердил владелец\): создана «Подтверждена» · на .+ занято \d+ из \d+/.test(i.text)));
    check("журнал: запись с overCapacity", (await db().auditLog.count({ where: { entityId: ob?.id, action: "UPDATE", diff: { path: ["overCapacity"], equals: true } } })) === 1);
    check("уведомление администратору CAPACITY_OVER", !!ob?.notices.some((n) => n.kind === "CAPACITY_OVER" && n.text.startsWith(`Бронь №${ob.number}: сверх вместимости`)));

    // «Подтвердить место» из «Отклонена»
    const rej = await mk({ status: "REJECTED", from: F1, to: F2 });
    await admin.goto(`${BASE}/admin/bookings/${rej.id}`, { waitUntil: "domcontentloaded" });
    await (await live(admin.getByRole("button", { name: "Подтвердить место", exact: true }))).click();
    await admin.locator("span.text-danger", { hasText: "мест нет" }).waitFor({ timeout: 10000 });
    equal("«Подтвердить место» из «Отклонена» при полном пуле — отказ администратору", (await db().booking.findUnique({ where: { id: rej.id } })).status, "REJECTED");
    const dlg = dialogs.length;
    await page.goto(`${BASE}/admin/bookings/${rej.id}`, { waitUntil: "domcontentloaded" });
    await (await live(page.getByRole("button", { name: "Подтвердить место", exact: true }))).click();
    const rejAfter = await until(async () => ((await db().booking.findUnique({ where: { id: rej.id } })).status === "AWAITING_PAYMENT" ? "AWAITING_PAYMENT" : null));
    check("владелец: confirm «сверх вместимости» с цифрами", dialogs.length === dlg + 1 && /мест нет: занято \d+ из \d+[\s\S]*Подтвердить сверх вместимости\?/.test(dialogs.at(-1) ?? ""), dialogs.at(-1));
    equal("владелец: из «Отклонена» — «Ожидает оплаты» сверх вместимости", rejAfter, "AWAITING_PAYMENT");

    // «Исправить статус» в «Подтверждена»: у администратора (из «Отклонена») — отказ; у владельца из «Отменена» (закрытую
    // исправляет только он) — confirm с цифрами, «Отмена» в нём оставляет бронь как была
    async function correctTo(p, id) {
      await p.goto(`${BASE}/admin/bookings/${id}`, { waitUntil: "domcontentloaded" });
      await (await live(p.getByRole("button", { name: "Исправить статус" }))).click();
      await p.getByLabel("Новый статус").selectOption({ label: "Подтверждена" });
      await fillReliably(p.getByLabel("Причина"), "e2e: отменили по ошибке");
      await (await live(p.getByRole("button", { name: "Исправить", exact: true }))).click();
      await p.locator("p.adm-err", { hasText: "мест нет" }).waitFor({ timeout: 10000 });
    }
    const rej2 = await mk({ status: "REJECTED", from: F1, to: F2 });
    await correctTo(admin, rej2.id);
    equal("«Исправить статус» «Отклонена» → «Подтверждена» при полном пуле — отказ администратору", (await db().booking.findUnique({ where: { id: rej2.id } })).status, "REJECTED");
    const can = await mk({ status: "CANCELLED", from: F1, to: F2 });
    agree = false;
    const dlg2 = dialogs.length;
    await correctTo(page, can.id);
    agree = true;
    check("владелец: «Исправить статус» — confirm сверх вместимости", dialogs.length === dlg2 + 1 && /Подтвердить сверх вместимости\?/.test(dialogs.at(-1) ?? ""));
    equal("«Исправить статус» «Отменена» → «Подтверждена»: владелец отказался — бронь как была", (await db().booking.findUnique({ where: { id: can.id } })).status, "CANCELLED");

    // «Изменить бронь»: на полные даты — отказ, на свободные — успех
    const G1 = addIso(F2, 10);
    const ed = await mk({ status: "CONFIRMED", from: G1, to: addIso(G1, 1) });
    await admin.goto(`${BASE}/admin/bookings/${ed.id}`, { waitUntil: "domcontentloaded" });
    await (await live(admin.getByRole("button", { name: "Изменить бронь" }))).click();
    const form = admin.locator("form", { has: admin.getByLabel("Сумма брони") });
    await fillReliably(form.getByLabel("Дата заезда"), F1);
    await fillReliably(form.getByLabel("Дата выезда"), F2);
    await (await live(form.getByRole("button", { name: "Сохранить" }))).click();
    await form.locator("p.adm-err", { hasText: "мест нет" }).waitFor({ timeout: 10000 });
    equal("«Изменить бронь» на полные даты — отказ, даты прежние", (await db().booking.findUnique({ where: { id: ed.id } })).dateFrom.toISOString().slice(0, 10), G1);
    await fillReliably(form.getByLabel("Дата заезда"), G1);
    await fillReliably(form.getByLabel("Дата выезда"), addIso(G1, 2));
    await (await live(form.getByRole("button", { name: "Сохранить" }))).click();
    const edTo = await until(async () => {
      const b = await db().booking.findUnique({ where: { id: ed.id } });
      return b.dateTo.toISOString().slice(0, 10) === addIso(G1, 2) ? addIso(G1, 2) : null;
    });
    equal("«Изменить бронь» на свободные даты — сохранено", edTo, addIso(G1, 2));

    // «Заехал» при полном пуле не блокируется: ранний заезд — строка в ленте
    await admin.goto(`${BASE}/admin/bookings/${filler.id}`, { waitUntil: "domcontentloaded" });
    await (await live(admin.getByRole("button", { name: "Заехал", exact: true }))).click();
    const inAfter = await until(async () => ((await db().booking.findUnique({ where: { id: filler.id } })).status === "CHECKED_IN" ? "CHECKED_IN" : null));
    equal("ранний «Заехал» при полном пуле проходит", inAfter, "CHECKED_IN");
    check("лента: «Заезд при полном пуле»", (await db().interaction.count({ where: { bookingId: filler.id, type: "SYSTEM", text: { startsWith: "Заезд при полном пуле · на " } } })) === 1);

    // ── 5. Вместимость ниже занятости — только с подтверждением владельца ──
    await saveCapacity([["Всего мест", 1], ["Порог автоподтверждения", 1]]);
    const warn = page.getByText(/Вместимость 1 меньше занятости: на \d+ [а-я]+ занято \d+\./);
    await warn.waitFor({ timeout: 10000 });
    equal("вместимость 1 без подтверждения не сохранена", Number((await settings())["parking.capacityTotal"]), cap);
    await (await live(page.getByRole("button", { name: "Да, сохранить с этим числом" }))).click();
    await page.getByText("Сохранено").waitFor({ timeout: 10000 });
    equal("владелец подтвердил — сохранено", Number((await settings())["parking.capacityTotal"]), 1);
    check("журнал: сохранение ниже занятости отмечено", (await db().auditLog.count({ where: { entity: "Setting", entityId: "parking", diff: { path: ["belowPeak"], not: null } } })) >= 1);
  } finally {
    await db().setting.deleteMany({ where: { key: { in: KEYS } } });
    for (const s of saved) await db().setting.create({ data: { key: s.key, value: s.value } });
    await adminCtx.close();
  }
  finish("Ф3 занятость");
});
