// Ф9а «Убрать ручное время» (docs/phases/PHASE_09A_MANUAL_TIME.md §10, §11, §12, §13): «Заехал»/«Выехал» — одно нажатие,
// время ставит сервер; на доске нет вопроса про время; забытая отметка — «Исправить статус» датой без времени,
// с причиной, лентой и журналом; признак «без времени» не залипает; в перестое перед «Выехал» в CRM — подтверждение с суммой,
// у охраны — нет; закрытую бронь возвращает только владелец (тост на доске, «Исправить статус»).
// Нижняя граница даты — дата создания брони по Москве, а брони теста создаются сегодня: успешные исправления идут
// сегодняшней датой, отказы — через снятие min/max у поля и, для отказа сервера, снятие disabled у кнопки.
// «Выезд раньше заезда» достижим: checkDates идёт раньше checkMinDate, поэтому вчерашний выезд при сегодняшнем заезде
// отказывает именно этим текстом — и с сохранённой отметкой заезда (§10.5), и с двумя введёнными датами.
// Недостижимо в e2e: исправление «позавчерашней» датой (раньше создания брони) — успешный путь с прошлой датой покрыт юнитом
// correction.test.ts («заезд и выезд в один прошедший день»); отказ сервера администратору из закрытого статуса мимо
// формы — нужен вызов серверного действия по его id, проверяется только интерфейс.
// Входит владельцем (--login owner --password owner12345), второй контекст — администратор: admin / E2E_ADMIN_PASSWORD
// (по умолчанию admin12345) или --admin-password. Не запускать с 00:00 до 01:00 МСК — перестоя ещё нет.
import { BASE, LOGIN, PASSWORD, HEADED, arg, loadPlaywright, check, equal, finish, testPhone, testPlate, moscowPlus, fillReliably } from "./lib.mjs";

const OWNER = LOGIN === "admin" ? { login: "owner", password: process.env.E2E_OWNER_PASSWORD ?? "owner12345" } : { login: LOGIN, password: PASSWORD };
const ADMIN = { login: "admin", password: arg("admin-password", process.env.E2E_ADMIN_PASSWORD ?? (LOGIN === "admin" ? PASSWORD : "admin12345")) };

const today = moscowPlus(0);
const yesterday = moscowPlus(-1);
const tomorrow = moscowPlus(1);
const dayLong = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${iso}T00:00:00Z`));
const dayShort = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`)).replace(".", "");
const TODAY_LONG = dayLong(today); // «24 сентября» — лента и шапка
const TODAY_SHORT = dayShort(today); // «24 сент» — полоса этапов
const nb = (s) => (s ?? "").replace(/[\u00a0\u202f]/g, " "); // неразрывные пробелы ru-RU → обычные
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tag = String(Date.now()).slice(-4); // имена броней уникальны в прогоне: строки «Сегодня» и доски ищутся по имени
const OVERSTAY_CONFIRM = "Бронь в перестое: при выезде в сумму брони войдёт ДОЛГ 1 сут. × 350 ₽ = 350 ₽. Отметить выезд?";
const mskMinutes = (d = new Date()) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).split(":").map(Number);
  return h * 60 + m;
};

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !HEADED });
let dateTimeLocalSeen = 0; // поле времени не должно появиться ни разу — ни у владельца, ни у администратора

async function session(user) {
  // 1920: колонка «Выехал» доски видна без прокрутки
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
  await ctx.exposeFunction("__e2eDateTimeLocal", () => { dateTimeLocalSeen++; });
  await ctx.addInitScript(() => {
    let told = false;
    new MutationObserver(() => {
      if (!told && document.querySelector('input[type="datetime-local"]')) { told = true; window.__e2eDateTimeLocal?.(); }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["type"] });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [ошибка страницы ${user.login}] ${e.message}`));
  // Диалоги считаем: где их быть не должно, счётчик обязан остаться прежним; answer — ответ на confirm
  const dialogs = { log: [], answer: "dismiss" };
  page.on("dialog", async (d) => {
    dialogs.log.push(nb(d.message()));
    if (dialogs.answer === "accept") await d.accept(); else await d.dismiss();
  });
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', user.login);
  await page.fill('input[name="password"]', user.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }), page.click('button[type="submit"]')]);
  return { ctx, page, dialogs };
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
// Полоса этапов: строка под подписью этапа («24 сент, 06:40 · имя» или «24 сент · без времени · имя»)
async function stage(page, label) {
  const lines = nb(await page.locator("section.adm-card ol").first().innerText()).split("\n").map((s) => s.trim()).filter(Boolean);
  const i = lines.indexOf(label);
  return i >= 0 ? lines[i + 1] ?? "" : "";
}
const feedLines = async (page) => (await page.locator("aside", { has: page.locator("h2", { hasText: "История" }) }).locator("ol li .leading-snug").allInnerTexts()).map((s) => nb(s).trim());
const countLines = (lines, re) => lines.filter((l) => re.test(l)).length;
const amountNow = async (page) => nb(await page.getByTestId("booking-amount").textContent()).trim();
const payStatus = async (page) => nb(await page.getByTestId("pay-status").textContent()).trim();
const header = async (page) => nb(await page.locator("section.adm-card span.font-mono.text-\\[11px\\]").first().innerText()).trim();
const timeNear = (text) => {
  const m = text.match(/(\d{2}):(\d{2})/);
  if (!m) return false;
  return Math.abs(Number(m[1]) * 60 + Number(m[2]) - mskMinutes()) <= 3;
};

async function createQuick(page, name, from, to) {
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
  await fillReliably(drawer.getByLabel("Заезд", { exact: true }), from);
  await fillReliably(drawer.getByLabel("Выезд", { exact: true }), to);
  await fillReliably(drawer.getByPlaceholder("Госномер: А123ВС77"), testPlate());
  await page.waitForTimeout(800);
  await drawer.getByRole("button", { name: /^Создать$/ }).click();
  const toastLink = page.getByRole("link", { name: "открыть" });
  await toastLink.waitFor({ timeout: 15000 });
  await toastLink.click();
  await page.waitForURL(/\/admin\/bookings\//, { timeout: 15000 });
  await waitStatus(page, "Новая заявка");
  const number = Number(nb(await page.locator("section.adm-card .text-3xl").first().innerText()).replace(/\D/g, ""));
  const url = page.url();
  console.log(`  ${name}: №${number} ${url}`);
  return { url, number, id: url.split("/").pop() };
}

async function pay(page, amount) {
  await (await live(page.getByRole("button", { name: "Принять оплату" }))).click();
  await page.getByLabel("Сумма").fill(String(amount));
  await page.locator("form select").first().selectOption({ label: "Наличные" });
  await page.getByRole("button", { name: "Провести" }).click();
  await waitStatus(page, "Подтверждена");
}

// Одно нажатие на кнопку перехода в карточке; ответ на confirm задаётся заранее
async function press(page, verb, expect) {
  await (await live(page.getByRole("button", { name: verb, exact: true }))).click();
  return expect ? waitStatus(page, expect) : page.waitForTimeout(1500);
}

// «Исправить статус»: открыть форму и выбрать статус. Возвращает локатор формы
async function openCorrect(page, status) {
  const form = page.locator("form", { has: page.getByLabel("Новый статус") });
  const open = await live(page.getByRole("button", { name: /Исправить статус/ }));
  for (let i = 0; i < 4 && !(await form.isVisible().catch(() => false)); i++) {
    await open.click().catch(() => {});
    await form.waitFor({ timeout: 3000 }).catch(() => {});
  }
  await form.getByLabel("Новый статус").selectOption({ label: status });
  await page.waitForTimeout(200);
  return form;
}
const fieldIn = (form) => form.getByLabel("Дата заезда", { exact: true });
const fieldOut = (form) => form.getByLabel("Дата выезда", { exact: true });
const submitBtn = (form) => form.getByRole("button", { name: "Исправить", exact: true });
const clientErr = async (form) => nb(await form.locator("p.adm-err.w-full").innerText().catch(() => "")).trim();
const serverErr = async (form) => {
  const p = form.locator("p.adm-err.mt-1");
  await p.waitFor({ timeout: 10000 }).catch(() => {});
  return nb(await p.innerText().catch(() => "")).trim();
};
// Мимо блокировки формы: снимаем disabled и отправляем — решает сервер
async function forceSubmit(form) {
  const btn = submitBtn(form);
  await btn.evaluate((el) => el.removeAttribute("disabled"));
  await btn.click();
  await form.page().waitForTimeout(1500); // прежняя ошибка сервера сменится новой
}
async function correct(page, status, reason, dates = {}) {
  const form = await openCorrect(page, status);
  if (dates.in) await fillReliably(fieldIn(form), dates.in);
  if (dates.out) await fillReliably(fieldOut(form), dates.out);
  await fillReliably(form.getByLabel("Причина"), reason);
  await submitBtn(form).click();
  await form.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// Перетаскивание на доске: мышью с шагами (dnd-kit стартует после 6 px), бросок на шапку колонки
async function drag(page, number, column) {
  const card = await live(page.getByRole("button", { name: `Открыть бронь №${number}`, exact: true }));
  const target = page.locator("section", { has: page.locator("h2", { hasText: new RegExp(`^${esc(column)}$`) }) });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await card.scrollIntoViewIfNeeded();
    const a = await card.boundingBox();
    const b = await target.locator("header").boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 16);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + 22, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 30, { steps: 20 });
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.waitForTimeout(600);
    if ((await target.getByRole("button", { name: `Открыть бронь №${number}`, exact: true }).count()) > 0) return true;
    if (await page.locator('[role="status"]', { hasText: `№${number}:` }).isVisible().catch(() => false)) return true;
  }
  return false;
}
const toast = (page, number) => page.locator('[role="status"]', { hasText: `№${number}:` });

let owner, admin;
try {
  console.log(`\nФ9а «Убрать ручное время»: ${BASE}, сегодня ${today} (МСК), владелец ${OWNER.login}, администратор ${ADMIN.login}`);
  owner = await session(OWNER);
  admin = await session(ADMIN);
  const P = owner.page;
  const D = owner.dialogs;

  // ── Н1. Карточка: «Ожидает оплаты» → «Заехал» → «Выехал» одним нажатием, время серверное (§10.1, e2e №1) ──
  {
    await createQuick(P, `E2E Ф9а-${tag} кнопки`, today, moscowPlus(2));
    await press(P, "Подтвердить место", "Ожидает оплаты");
    const inBtn = P.getByRole("button", { name: "Заехал", exact: true });
    equal("Н1: подсказка на «Заехал» — «Время события поставит система»", await inBtn.getAttribute("title"), "Время события поставит система");
    const d0 = D.log.length;
    check("Н1: одно нажатие «Заехал» — статус «Заехал»", await press(P, "Заехал", "Заехал"));
    equal("Н1: при «Заехал» диалогов нет", D.log.length - d0, 0);
    equal("Н1: поля datetime-local на странице нет", await P.locator('input[type="datetime-local"]').count(), 0);
    const inAt = await stage(P, "Заехал");
    check("Н1: полоса этапов «Заехал» — сегодня и текущее время МСК", new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(inAt) && timeNear(inAt), inAt);
    check("Н1: в полосе нет «без времени»", !/без времени/.test(inAt), inAt);
    check("Н1: шапка «Заехал с <дата, время>»", new RegExp(`^Заехал с ${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(await header(P)), await header(P));
    equal("Н1: в ленте строка перехода без ручного времени", countLines(await feedLines(P), /^Ожидает оплаты → Заехал$/), 1);

    equal("Н1: подсказка на «Выехал» — «Время события поставит система»", await P.getByRole("button", { name: "Выехал", exact: true }).getAttribute("title"), "Время события поставит система");
    check("Н1: одно нажатие «Выехал» (не перестой) — статус «Выехал»", await press(P, "Выехал", "Выехал"));
    equal("Н1: при «Выехал» вне перестоя диалогов нет", D.log.length - d0, 0);
    const outAt = await stage(P, "Выехал");
    check("Н1: полоса этапов «Выехал» — сегодня и текущее время МСК", new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(outAt) && timeNear(outAt), outAt);
    const lines1 = await feedLines(P);
    equal("Н1: в ленте «Заехал → Выехал» без суффикса «по факту»", countLines(lines1, /^Заехал → Выехал$/), 1);
    const b1 = await body(P);
    check("Н1: обе отметки с временем — строка «по факту N» есть", /по факту \d/.test(b1));
    check("Н1: баннер «Стоянка по факту» с часами («… → 1 сут.»)", /Стоянка по факту: [^\n]+ → 1 сут\. \(по плану 3\)/.test(b1), b1.match(/Стоянка по факту[^\n]*/)?.[0] ?? "баннера нет");

    // Владелец возвращает закрытую бронь: «Выехал» → «Заехал» без дат (отметка заезда сохраняется), потом снова «Выехал» датой —
    // фактические сутки снятого выезда сброшены, баннер «Стоянка по факту» от него не всплывает
    let form = await openCorrect(P, "Заехал");
    equal("Н1: «Выехал → Заехал» — полей дат нет", (await fieldIn(form).count()) + (await fieldOut(form).count()), 0);
    await fillReliably(form.getByLabel("Причина"), "e2e: выезд отмечен по ошибке");
    await submitBtn(form).click();
    check("Н1: владелец вернул закрытую бронь в «Заехал»", await waitStatus(P, "Заехал"));
    check("Н1: отметка заезда сохранилась со временем", new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(await stage(P, "Заехал")), await stage(P, "Заехал"));
    await correct(P, "Выехал", "e2e: выехал сегодня, отметили позже", { out: today });
    check("Н1: снова «Выехал» — датой", (await waitStatus(P, "Выехал")) && (await stage(P, "Выехал")).startsWith(`${TODAY_SHORT} · без времени`), await stage(P, "Выехал"));
    check("Н1: баннер «Стоянка по факту» от снятого выезда не всплыл", !/Стоянка по факту/.test(await body(P)));
  }

  // ── Н2. Доска, владелец: без вопроса про время, «Отменить» после «Выехал» работает (§10.2, e2e №2) ──
  {
    const n2 = await createQuick(P, `E2E Ф9а-${tag} доска`, today, moscowPlus(2));
    await pay(P, 1050);
    await P.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    const d0 = D.log.length;
    check("Н2: доска — «Подтверждена» → «Заехал» перетаскиванием", await drag(P, n2.number, "Заехал"));
    await toast(P, n2.number).waitFor({ timeout: 15000 }).catch(() => {});
    check("Н2: тост «Подтверждена → Заехал» с «Отменить»", /Подтверждена → Заехал/.test(nb(await toast(P, n2.number).innerText().catch(() => ""))) && (await toast(P, n2.number).getByRole("button", { name: "Отменить" }).count()) === 1);
    await P.waitForTimeout(1000);
    check("Н2: доска — «Заехал» → «Выехал» перетаскиванием", await drag(P, n2.number, "Выехал"));
    const t2 = toast(P, n2.number).filter({ hasText: "Заехал → Выехал" });
    await t2.waitFor({ timeout: 15000 }).catch(() => {});
    equal("Н2: на доске ни одного диалога (ни prompt про время, ни confirm)", D.log.length - d0, 0);
    equal("Н2: у владельца в тосте «Выехал» есть «Отменить»", await t2.getByRole("button", { name: "Отменить" }).count(), 1);
    await t2.getByRole("button", { name: "Отменить" }).click();
    await P.waitForTimeout(2500);
    await P.goto(n2.url, { waitUntil: "domcontentloaded" });
    check("Н2: после «Отменить» бронь снова «Заехал»", await waitStatus(P, "Заехал"));
    equal("Н2: в ленте «Исправление: Выехал → Заехал · отмена перетаскивания на доске»", countLines(await feedLines(P), /^Исправление: Выехал → Заехал · отмена перетаскивания на доске$/), 1);
    const inAt = await stage(P, "Заехал");
    check("Н2: отметка заезда с доски — со временем", new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(inAt) && !/без времени/.test(inAt), inAt);
  }

  // ── Н3. Доска, администратор: закрытый статус без «Отменить», «Исправить статус» только у владельца (§12 в.5, §13 п.6, п.9) ──
  {
    const n3 = await createQuick(P, `E2E Ф9а-${tag} админ`, today, moscowPlus(2));
    await pay(P, 1050);
    const A = admin.page;
    await A.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    const d0 = admin.dialogs.log.length;
    check("Н3: администратор — «Подтверждена» → «Заехал» перетаскиванием", await drag(A, n3.number, "Заехал"));
    const tIn = toast(A, n3.number).filter({ hasText: "Подтверждена → Заехал" });
    await tIn.waitFor({ timeout: 15000 }).catch(() => {});
    equal("Н3: у администратора тост не в закрытый статус — с «Отменить»", await tIn.getByRole("button", { name: "Отменить" }).count(), 1);
    await A.waitForTimeout(1000);
    check("Н3: администратор — «Заехал» → «Выехал» перетаскиванием", await drag(A, n3.number, "Выехал"));
    const tOut = toast(A, n3.number).filter({ hasText: "Заехал → Выехал" });
    await tOut.waitFor({ timeout: 15000 }).catch(() => {});
    const tOutText = nb(await tOut.innerText().catch(() => ""));
    equal("Н3: у администратора в тосте «Выехал» кнопки «Отменить» нет", await tOut.getByRole("button", { name: "Отменить" }).count(), 0);
    check("Н3: подпись «вернуть может владелец — „Исправить статус“»", /вернуть может владелец — „Исправить статус“/.test(tOutText), tOutText);
    equal("Н3: у администратора на доске диалогов нет", admin.dialogs.log.length - d0, 0);
    await A.goto(n3.url, { waitUntil: "domcontentloaded" });
    await waitStatus(A, "Выехал");
    check("Н3: администратор в закрытой брони — серый текст вместо кнопки", /Исправить статус закрытой брони может только владелец/.test(await body(A)));
    equal("Н3: у администратора кнопки «Исправить статус» нет", await A.getByRole("button", { name: /Исправить статус/ }).count(), 0);
    await P.goto(n3.url, { waitUntil: "domcontentloaded" });
    await waitStatus(P, "Выехал");
    equal("Н3: у владельца на той же брони «Исправить статус» есть", await P.getByRole("button", { name: /Исправить статус/ }).count(), 1);
  }

  // ── Н4. «Исправить статус» датой: отказы по датам, успех «Заехал» и «Выехал», лента и журнал (§10.4–10.6, §10.8, e2e №3–5) ──
  {
    const n4 = await createQuick(P, `E2E Ф9а-${tag} исправление`, today, moscowPlus(2));
    await pay(P, 1050);
    const amount0 = await amountNow(P);
    const pay0 = await payStatus(P);
    let form = await openCorrect(P, "Заехал");
    check("Н4: «→ Заехал» — поле «Дата заезда» есть", await fieldIn(form).isVisible());
    equal("Н4: «→ Заехал» — поля «Дата выезда» нет", await fieldOut(form).count(), 0);
    equal("Н4: у поля даты min — дата создания брони (сегодня)", await fieldIn(form).getAttribute("min"), today);
    equal("Н4: у поля даты max — сегодня", await fieldIn(form).getAttribute("max"), today);
    check("Н4: подпись «Время не ставим: в карточке будет только дата.»", /Время не ставим: в карточке будет только дата\./.test(nb(await form.innerText())));
    await fillReliably(form.getByLabel("Причина"), "e2e: охрана не отметила заезд");
    check("Н4: без даты «Исправить» заблокирована", await submitBtn(form).isDisabled());
    equal("Н4: пустое поле даты — без красного текста", await clientErr(form), "");

    await fieldIn(form).evaluate((el) => el.removeAttribute("max"));
    await fillReliably(fieldIn(form), tomorrow);
    equal("Н4: завтрашняя дата — ошибка под полем", await clientErr(form), "Дата заезда не может быть в будущем");
    check("Н4: с будущей датой «Исправить» заблокирована", await submitBtn(form).isDisabled());
    await forceSubmit(form);
    equal("Н4: будущая дата в обход формы — отказ сервера", await serverErr(form), "Дата заезда не может быть в будущем");

    await fieldIn(form).evaluate((el) => el.removeAttribute("min"));
    await fillReliably(fieldIn(form), yesterday);
    const beforeCreated = `Дата заезда не может быть раньше создания брони (${TODAY_LONG})`;
    equal("Н4: дата раньше создания брони — ошибка под полем", await clientErr(form), beforeCreated);
    await forceSubmit(form);
    await P.waitForTimeout(1500);
    equal("Н4: дата раньше создания в обход формы — отказ сервера", await serverErr(form), beforeCreated);
    await P.reload({ waitUntil: "domcontentloaded" });
    check("Н4: после отказов статус прежний — «Подтверждена»", await waitStatus(P, "Подтверждена"));

    await correct(P, "Заехал", "e2e: охрана не отметила заезд", { in: today });
    check("Н4: исправление датой — статус «Заехал»", await waitStatus(P, "Заехал"));
    const inAt = await stage(P, "Заехал");
    check(`Н4: полоса этапов «${TODAY_SHORT} · без времени»`, inAt.startsWith(`${TODAY_SHORT} · без времени`), inAt);
    check("Н4: шапка «Заехал <дата> · без времени (отмечено …)»", new RegExp(`^Заехал ${esc(TODAY_LONG)} · без времени \\(отмечено ${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(await header(P)), await header(P));
    equal("Н4: в ленте одна запись исправления с датой заезда", countLines(await feedLines(P), new RegExp(`^Исправление: Подтверждена → Заехал · заезд ${esc(TODAY_LONG)}, без времени · e2e: охрана не отметила заезд$`)), 1);

    // Вторая дата — из сохранённой отметки заезда: вчерашний выезд при заезде сегодня — «выезд раньше заезда»
    form = await openCorrect(P, "Выехал");
    check("Н4: «Заехал → Выехал» — поле «Дата выезда» есть", await fieldOut(form).isVisible());
    equal("Н4: «Заехал → Выехал» — поля «Дата заезда» нет", await fieldIn(form).count(), 0);
    await fillReliably(form.getByLabel("Причина"), "e2e: охрана не отметила выезд");
    await fieldOut(form).evaluate((el) => el.removeAttribute("min"));
    await fillReliably(fieldOut(form), yesterday);
    equal("Н4: выезд раньше сохранённого заезда — ошибка под полем", await clientErr(form), "Выезд не может быть раньше заезда");
    await forceSubmit(form);
    equal("Н4: выезд раньше заезда в обход формы — отказ сервера", await serverErr(form), "Выезд не может быть раньше заезда");
    await P.reload({ waitUntil: "domcontentloaded" });
    check("Н4: после отказа статус прежний — «Заехал»", await waitStatus(P, "Заехал"));

    await correct(P, "Выехал", "e2e: охрана не отметила выезд", { out: today });
    check("Н4: исправление датой — статус «Выехал»", await waitStatus(P, "Выехал"));
    const outAt = await stage(P, "Выехал");
    check(`Н4: полоса этапов «Выехал» — «${TODAY_SHORT} · без времени»`, outAt.startsWith(`${TODAY_SHORT} · без времени`), outAt);
    check("Н4: шапка «Выехал <дата> · без времени (отмечено …)»", new RegExp(`^Выехал ${esc(TODAY_LONG)} · без времени \\(отмечено ${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(await header(P)), await header(P));
    const b4 = await body(P);
    check("Н4: строки «по факту N ч» нет", !/по факту \d/.test(b4));
    check("Н4: баннера «Стоянка по факту» нет (деньги от исправления — Ф10)", !/Стоянка по факту/.test(b4));
    equal("Н4: сумма брони не изменилась", await amountNow(P), amount0);
    equal("Н4: «оплачено» не изменилось", await payStatus(P), pay0);
    const lines4 = await feedLines(P);
    equal("Н4: в ленте одна запись исправления с датой выезда", countLines(lines4, new RegExp(`^Исправление: Заехал → Выехал · выезд ${esc(TODAY_LONG)}, без времени · e2e: охрана не отметила выезд$`)), 1);
    equal("Н4: вне перестоя строки «Перестой … не начислен» нет", countLines(lines4, /не начислен/), 0);

    await P.goto(`${BASE}/admin/audit`, { waitUntil: "domcontentloaded" });
    const row = P.locator("tr", { hasText: n4.id.slice(0, 8) }).filter({ hasText: "STATUS_CHANGE" }).filter({ hasText: '"to":"CHECKED_OUT"' }).first();
    const diff = nb(await row.textContent().catch(() => ""));
    check("Н4: журнал — STATUS_CHANGE с признаком исправления, причиной и датой выезда",
      /"correction":true/.test(diff) && /"reason":"e2e: охрана не отметила выезд"/.test(diff) && diff.includes(`"checkedOutDate":"${today}"`), diff.slice(0, 200) || "строки нет");
  }

  // ── Н5. Признак «без времени» не залипает: датой → назад → кнопкой (критика, «важно») ──
  {
    await createQuick(P, `E2E Ф9а-${tag} признак`, today, moscowPlus(2));
    await pay(P, 1050);
    await correct(P, "Заехал", "e2e: забыли заезд", { in: today });
    check("Н5: заезд датой — «без времени»", (await waitStatus(P, "Заехал")) && /без времени/.test(await stage(P, "Заехал")));
    const form = await openCorrect(P, "Подтверждена");
    equal("Н5: «Заехал → Подтверждена» — полей дат нет", (await fieldIn(form).count()) + (await fieldOut(form).count()), 0);
    await fillReliably(form.getByLabel("Причина"), "e2e: заезд отмечен по ошибке");
    await submitBtn(form).click();
    check("Н5: назад в «Подтверждена»", await waitStatus(P, "Подтверждена"));
    equal("Н5: отметка заезда снята", await stage(P, "Заехал"), "—");
    check("Н5: «Заехал» кнопкой", await press(P, "Заехал", "Заехал"));
    const inAt = await stage(P, "Заехал");
    check("Н5: в полосе этапов время, «без времени» нет — признак сброшен", new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(inAt) && !/без времени/.test(inAt), inAt);
    check("Н5: шапка «Заехал с <дата, время>»", new RegExp(`^Заехал с ${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(await header(P)), await header(P));
  }

  // ── Н6. Заезд датой, выезд кнопкой: баннер «Стоянка по факту» без часов, «по датам» (§12, §13 п.4–5) ──
  {
    await createQuick(P, `E2E Ф9а-${tag} баннер`, today, moscowPlus(2));
    await pay(P, 1050);
    await correct(P, "Заехал", "e2e: забыли заезд", { in: today });
    await waitStatus(P, "Заехал");
    const d0 = D.log.length;
    check("Н6: «Выехал» кнопкой", await press(P, "Выехал", "Выехал"));
    equal("Н6: вне перестоя диалогов нет", D.log.length - d0, 0);
    const b6 = await body(P);
    check("Н6: баннер «Стоянка по факту: 1 сут. (по плану 3)» — без часов", /Стоянка по факту: 1 сут\. \(по плану 3\)/.test(b6), b6.match(/Стоянка по факту[^\n]*/)?.[0] ?? "баннера нет");
    check("Н6: строка «по датам: 1 сут.»", /по датам: 1 сут\./.test(b6));
    check("Н6: строки «по факту N ч» нет", !/по факту \d/.test(b6));
    check("Н6: заезд — «без времени», выезд — со временем", /без времени/.test(await stage(P, "Заехал")) && new RegExp(`^${esc(TODAY_SHORT)}, \\d{2}:\\d{2}`).test(await stage(P, "Выехал")), `${await stage(P, "Заехал")} | ${await stage(P, "Выехал")}`);
  }

  // ── Н7. «Ожидает оплаты» → «Выехал» спрашивает обе даты (§10.9, e2e №7) ──
  {
    await createQuick(P, `E2E Ф9а-${tag} обе даты`, today, moscowPlus(2));
    await press(P, "Подтвердить место", "Ожидает оплаты");
    const form = await openCorrect(P, "Выехал");
    check("Н7: «Ожидает оплаты → Выехал» — обе даты", (await fieldIn(form).isVisible()) && (await fieldOut(form).isVisible()));
    await fillReliably(form.getByLabel("Причина"), "e2e: забыли и заезд, и выезд");
    await fillReliably(fieldIn(form), today);
    check("Н7: только с датой заезда «Исправить» заблокирована", await submitBtn(form).isDisabled());
    equal("Н7: пустая дата выезда — без красного текста", await clientErr(form), "");
    await forceSubmit(form);
    const noOut = await serverErr(form);
    check("Н7: без даты выезда в обход формы — отказ сервера", /Укажите дату выезда/.test(noOut), noOut || "ошибки нет");
    await fieldOut(form).evaluate((el) => el.removeAttribute("min"));
    await fillReliably(fieldOut(form), yesterday);
    equal("Н7: выезд раньше заезда (две введённые даты) — ошибка под полями", await clientErr(form), "Выезд не может быть раньше заезда");
    await forceSubmit(form);
    await P.waitForTimeout(1500);
    equal("Н7: выезд раньше заезда в обход формы — отказ сервера", await serverErr(form), "Выезд не может быть раньше заезда");
    check("Н7: после отказов статус прежний", (await chip(P)) === "Ожидает оплаты");
    await fillReliably(fieldOut(form), today);
    check("Н7: обе даты — «Исправить» доступна", !(await submitBtn(form).isDisabled()));
    await submitBtn(form).click();
    check("Н7: статус «Выехал»", await waitStatus(P, "Выехал"));
    check("Н7: обе отметки «без времени»", (await stage(P, "Заехал")).startsWith(`${TODAY_SHORT} · без времени`) && (await stage(P, "Выехал")).startsWith(`${TODAY_SHORT} · без времени`), `${await stage(P, "Заехал")} | ${await stage(P, "Выехал")}`);
    equal("Н7: вне перестоя строки «Перестой … не начислен» нет", countLines(await feedLines(P), /не начислен/), 0);
    equal("Н7: в ленте одна запись с обеими датами", countLines(await feedLines(P), new RegExp(`^Исправление: Ожидает оплаты → Выехал · заезд ${esc(TODAY_LONG)}, выезд ${esc(TODAY_LONG)}, без времени · e2e: забыли и заезд, и выезд$`)), 1);
  }

  // ── Перестой: легковая бронь позавчера–вчера по Москве, 700 ₽, «Заехал» → сегодня 1 сут. перестоя ──
  async function overstayBooking(name) {
    const n = await createQuick(P, name, moscowPlus(-2), moscowPlus(-1));
    await pay(P, 700);
    await press(P, "Заехал", "Заехал");
    return n;
  }

  // ── Н8. Перестой: confirm с суммой в карточке и на «Сегодня», отказ ничего не меняет; исправление не начисляет (§12 в.1, e2e №6) ──
  {
    const name = `E2E Ф9а-${tag} перестой`;
    const n8 = await overstayBooking(name);
    const b8 = await body(P);
    check("Н8: плашка перестоя на месте", /ПЕРЕСТОЙ · 1 сут\./.test(b8));
    check("Н8: подсказки «текущими сутками» больше нет", !/текущими сутками/.test(b8));
    D.answer = "dismiss";
    let d0 = D.log.length;
    await press(P, "Выехал");
    equal("Н8: «Выехал» в перестое — один confirm", D.log.length - d0, 1);
    equal("Н8: текст confirm с сутками и суммой", D.log.at(-1), OVERSTAY_CONFIRM);
    await P.reload({ waitUntil: "domcontentloaded" });
    check("Н8: отказ в confirm — статус «Заехал», 700 ₽, начисления нет", (await waitStatus(P, "Заехал")) && (await amountNow(P)) === "700 ₽" && !/Начислен перестой/.test(await body(P)));

    await P.goto(`${BASE}/admin/today`, { waitUntil: "domcontentloaded" });
    const row = P.locator("li", { hasText: name }).first();
    d0 = D.log.length;
    await (await live(row.getByRole("button", { name: "Выехал", exact: true }))).click();
    await P.waitForTimeout(1500);
    equal("Н8: «Сегодня» — тот же confirm", D.log.slice(d0).join(" | "), OVERSTAY_CONFIRM);
    await P.goto(n8.url, { waitUntil: "domcontentloaded" });
    check("Н8: отказ на «Сегодня» — статус «Заехал»", await waitStatus(P, "Заехал"));

    d0 = D.log.length;
    await correct(P, "Выехал", "e2e: выезд забыли отметить", { out: today });
    check("Н8: исправление в «Выехал»", await waitStatus(P, "Выехал"));
    equal("Н8: исправление диалогов не вызывает", D.log.length - d0, 0);
    equal("Н8: сумма не выросла — 700 ₽", await amountNow(P), "700 ₽");
    const lines8 = await feedLines(P);
    equal("Н8: в ленте «Перестой 1 сут. не начислен (350 ₽) · по дате выезда <дата> · причина» — одна", countLines(lines8, new RegExp(`^Перестой 1 сут\\. не начислен \\(350 ₽\\) · по дате выезда ${esc(TODAY_LONG)} · e2e: выезд забыли отметить$`)), 1);
    equal("Н8: и одна запись исправления с датой выезда", countLines(lines8, new RegExp(`^Исправление: Заехал → Выехал · выезд ${esc(TODAY_LONG)}, без времени · e2e: выезд забыли отметить$`)), 1);
    equal("Н8: начисления нет", countLines(lines8, /^Начислен перестой/), 0);
  }

  // ── Н9. Перестой на доске: тот же confirm, согласие — начисление одним действием (§13 п.9) ──
  {
    const n9 = await overstayBooking(`E2E Ф9а-${tag} перестой доска`);
    await P.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    D.answer = "accept";
    const d0 = D.log.length;
    check("Н9: доска — «Заехал» → «Выехал» в перестое", await drag(P, n9.number, "Выехал"));
    await toast(P, n9.number).waitFor({ timeout: 15000 }).catch(() => {});
    equal("Н9: на доске тот же confirm", D.log.slice(d0).join(" | "), OVERSTAY_CONFIRM);
    D.answer = "dismiss";
    await P.goto(n9.url, { waitUntil: "domcontentloaded" });
    check("Н9: статус «Выехал»", await waitStatus(P, "Выехал"));
    equal("Н9: сумма 1 050 ₽", await amountNow(P), "1 050 ₽");
    equal("Н9: в ленте одно «Начислен перестой: 1 сут. × 350 ₽ = 350 ₽»", countLines(await feedLines(P), /^Начислен перестой: 1 сут\. × 350 ₽ = 350 ₽/), 1);
  }

  // ── Н10. Экран охраны: одно нажатие «Выехал» в перестое, без новых окон (§10.3) ──
  {
    const name = `E2E Ф9а-${tag} КПП`;
    const n10 = await overstayBooking(name);
    await P.goto(`${BASE}/admin/today?guard=1`, { waitUntil: "domcontentloaded" });
    await (await live(P.getByRole("button", { name: /Выезд ·/ }))).click();
    const row = P.locator("li", { hasText: name }).first();
    const d0 = D.log.length;
    await (await live(row.getByRole("button", { name: "Выехал", exact: true }))).click();
    await P.waitForTimeout(2500);
    equal("Н10: экран охраны — «Выехал» без диалогов", D.log.length - d0, 0);
    await P.goto(n10.url, { waitUntil: "domcontentloaded" });
    check("Н10: статус «Выехал»", await waitStatus(P, "Выехал"));
    equal("Н10: перестой начислен одним нажатием — 1 050 ₽", await amountNow(P), "1 050 ₽");
  }

  // ── Н11. Перестой, заезд не отмечен: «Подтверждена» → «Выехал» двумя датами тоже не начисляет и пишет это в ленту ──
  {
    await createQuick(P, `E2E Ф9а-${tag} перестой без заезда`, moscowPlus(-2), moscowPlus(-1));
    await pay(P, 700);
    const d0 = D.log.length;
    await correct(P, "Выехал", "e2e: забыли заезд и выезд", { in: today, out: today });
    check("Н11: «Подтверждена» → «Выехал» двумя датами", await waitStatus(P, "Выехал"));
    equal("Н11: исправление диалогов не вызывает", D.log.length - d0, 0);
    equal("Н11: сумма не выросла — 700 ₽", await amountNow(P), "700 ₽");
    const lines11 = await feedLines(P);
    equal("Н11: в ленте «Перестой 1 сут. не начислен (350 ₽) · по дате выезда <дата> · причина» — одна", countLines(lines11, new RegExp(`^Перестой 1 сут\\. не начислен \\(350 ₽\\) · по дате выезда ${esc(TODAY_LONG)} · e2e: забыли заезд и выезд$`)), 1);
    equal("Н11: начисления нет", countLines(lines11, /^Начислен перестой/), 0);
  }

  equal("поле времени (datetime-local) не появлялось ни разу за прогон", dateTimeLocalSeen, 0);
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  await owner?.page.screenshot({ path: `/tmp/e2e-f9a-fail-${Date.now()}.png`, fullPage: true }).catch(() => {});
  check("сценарий дошёл до конца", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
}
finish("Ф9а «Убрать ручное время»");
