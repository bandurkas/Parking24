// Перестой, Ф2а (docs/phases/PHASE_02_OVERSTAY.md): машина «Заехал» после даты выезда занимает место,
// ДОЛГ виден на экранах, при выезде начисляется один раз, долг можно принять заранее, «Продлить» считает сумму сам.
// СП: в перестое выезд — только текущими сутками (льготный час до 01:00 МСК), «Изменить бронь» не меняет даты и сумму; начисление снимается с причиной;
// возврат владельца после выезда уменьшает сумму. Не запускать с 00:00 до 01:00 МСК — перестоя ещё нет.
// Брони: легковая, заезд позавчера, выезд вчера по Москве (2 сут. × 350 = 700 ₽) → сегодня 1 сутки перестоя = 350 ₽.
import { BASE, withBrowser, adminLogin, check, equal, finish, testPhone, testPlate, moscowPlus, fillReliably } from "./lib.mjs";

const from = moscowPlus(-2);
const to = moscowPlus(-1);
const today = moscowPlus(0);
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");

await withBrowser(async (page) => {
  console.log(`\nПерестой: ${BASE}, заезд ${from}, выезд ${to}, сегодня ${today}`);
  await adminLogin(page);
  // innerText, а не textContent: после полной загрузки страницы в body лежат скрипты Next с теми же данными — счёт строк удвоился бы
  const body = async () => nb(await page.locator("body").innerText());

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

  // Пока ручное время не убрано (Ф9), «Заехал»/«Выехал» открывают форму времени — подтверждаем её
  async function move(p, verb) {
    await p.getByRole("button", { name: verb, exact: true }).first().click();
    await p.waitForTimeout(400);
    if (await p.locator('input[type="datetime-local"]').isVisible().catch(() => false)) {
      await p.getByRole("button", { name: verb, exact: true }).last().click();
    }
    await p.waitForTimeout(1500);
  }

  async function heldNow() {
    await page.goto(`${BASE}/admin/occupancy`, { waitUntil: "domcontentloaded" });
    return Number((await body()).match(/занято бронями (\d+)/)?.[1] ?? NaN);
  }

  async function correct(status, reason) {
    await page.getByRole("button", { name: /Исправить статус/ }).click();
    await page.getByLabel("Новый статус").selectOption({ label: status });
    await page.getByLabel("Причина").fill(reason);
    await page.getByRole("button", { name: "Исправить", exact: true }).click();
    await page.waitForTimeout(1500);
  }

  const count = (s, re) => (s.match(re) ?? []).length;

  // ── Бронь А: перестой, начисление при выезде, исправление статуса назад, повторный выезд ──
  const plateA = testPlate();
  const urlA = await createQuick("E2E Перестой А", plateA);
  console.log(`  А: ${urlA}`);
  check("А: 2 сут. = 700 ₽", /700 ₽/.test(await body()));
  await pay(700);
  check("А: после оплаты «Подтверждена»", /Подтверждена/.test(await body()));

  const heldBefore = await heldNow();
  await page.goto(urlA, { waitUntil: "domcontentloaded" });
  await move(page, "Заехал");
  const inA = await body();
  check("А: плашка «ПЕРЕСТОЙ · 1 сут. · ДОЛГ 350 ₽»", /ПЕРЕСТОЙ · 1 сут\. · ДОЛГ 350 ₽/.test(inA), inA.match(/ПЕРЕСТОЙ[^.]*\./)?.[0] ?? "плашки нет");
  check("А: строка «ДОЛГ за перестой 350 ₽» в оплате", /ДОЛГ за перестой 350 ₽/.test(inA));
  const heldAfter = await heldNow();
  equal("А: «занято бронями» +1 после заезда в перестое", heldAfter - heldBefore, 1);

  await page.goto(`${BASE}/admin/today`, { waitUntil: "domcontentloaded" });
  const rowA = page.locator("li", { hasText: `E2E Перестой А` }).first();
  check("А: «Сегодня» — перестой 1 сут. · долг 350 ₽", /перестой 1 сут\. · долг 350 ₽/.test(nb(await rowA.textContent().catch(() => ""))));

  await page.goto(`${BASE}/admin/today?guard=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Выезд ·/ }).click();
  const guardRow = page.locator("li", { hasText: "E2E Перестой А" }).first();
  check("А: охрана видит перестой и долг", /перестой 1 сут\. · долг 350 ₽/.test(nb(await guardRow.textContent().catch(() => ""))));

  await page.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
  const cardA = page.locator("article", { hasText: "E2E Перестой А" }).first();
  check("А: доска — значок «перестой 1 д · 350 ₽»", /перестой 1 д · 350 ₽/i.test(nb(await cardA.textContent().catch(() => ""))));

  await page.goto(urlA, { waitUntil: "domcontentloaded" });
  const amountNow = async () => nb(await page.getByTestId("booking-amount").textContent()).trim();

  // СП (docs/phases/PHASE_SP_URGENT_FIXES.md §3.2): в перестое «Изменить бронь» не меняет даты — ни в форме, ни в обход неё
  await page.getByRole("button", { name: /Изменить бронь/ }).click();
  const dateToField = page.getByLabel("Дата выезда");
  check("А: в перестое поле даты выезда в «Изменить бронь» недоступно", await dateToField.isDisabled());
  await dateToField.evaluate((el) => el.removeAttribute("disabled"));
  await dateToField.fill(today);
  await page.getByRole("button", { name: /Сохранить/ }).click();
  await page.waitForTimeout(1500);
  check("А: дата выезда в обход формы — отказ сервера", /В перестое даты, сумму и тип машины здесь не меняют/.test(await body()));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Изменить бронь/ }).click();
  await page.getByLabel("Сумма брони").evaluate((el) => el.removeAttribute("disabled"));
  await page.getByLabel("Сумма брони").fill("350");
  await page.getByRole("button", { name: /Сохранить/ }).click();
  await page.waitForTimeout(1500);
  check("А: сумма в обход формы — отказ сервера", /В перестое даты, сумму и тип машины здесь не меняют/.test(await body()));

  // СП §3.1: в перестое выезд отмечается только сегодняшним числом (поле ограничено, сервер проверяет и без ограничения)
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Выехал", exact: true }).first().click();
  const outTime = page.locator('input[type="datetime-local"]');
  await outTime.waitFor({ timeout: 10000 });
  check("А: в форме выезда подсказка про перестой", /Перестой: выезд — текущими сутками/.test(await body()));
  await outTime.evaluate((el) => el.removeAttribute("min"));
  await outTime.fill(`${to}T12:00`);
  await page.getByRole("button", { name: "Выехал", exact: true }).last().click();
  await page.waitForTimeout(1500);
  const refusedA = await body();
  check("А: выезд вчерашним числом — отказ «текущими сутками»", /выезд отмечается текущими сутками/.test(refusedA));
  check("А: после отказа перестой на месте, сумма 700 ₽", /ПЕРЕСТОЙ ·/.test(refusedA) && (await amountNow()) === "700 ₽" && !/Начислен перестой/.test(refusedA));
  await page.reload({ waitUntil: "domcontentloaded" });

  await move(page, "Выехал");
  const outA = await body();
  check("А: «Выехал»", /Выехал/.test(outA));
  check("А: сумма 1 050 ₽ и 3 сут.", /1 050 ₽/.test(outA) && /3 сут\./.test(outA));
  check("А: «не хватает 350 ₽»", /не хватает 350 ₽/.test(outA));
  check("А: в ленте «Начислен перестой: 1 сут. × 350 ₽ = 350 ₽»", /Начислен перестой: 1 сут\. × 350 ₽ = 350 ₽/.test(outA));
  check("А: баннера «Стоянка по факту» нет", !/Стоянка по факту/.test(outA));
  check("А: плашки перестоя нет", !/ПЕРЕСТОЙ ·/.test(outA));

  await correct("Заехал", "e2e: отмена выезда");
  const backA = await body();
  check("А: после исправления в «Заехал» перестоя нет (дата выезда — сегодня)", !/ПЕРЕСТОЙ ·/.test(backA));
  await move(page, "Выехал");
  const againA = await body();
  check("А: повторный выезд сумму не меняет (1 050 ₽)", /1 050 ₽/.test(againA) && !/1 400 ₽/.test(againA));
  equal("А: начисление в ленте одно", count(againA, /Начислен перестой/g), 1);

  // Льготный час прошёл, но решение за администратором: начисление снимается с причиной (ответ пользователя 22.09)
  await page.getByRole("button", { name: /Снять начисление за перестой \(350 ₽\)/ }).click();
  await page.getByLabel("Причина снятия начисления").fill("e2e: выехал в 00:50, охрана отметила позже");
  await page.getByRole("button", { name: "Снять", exact: true }).click();
  await page.waitForTimeout(1500);
  const waivedA = await body();
  equal("А: после снятия начисления — 700 ₽", await amountNow(), "700 ₽");
  check("А: в ленте «Начисление за перестой снято: 350 ₽»", /Начисление за перестой снято: 350 ₽ · 1 050 ₽ → 700 ₽ · e2e/.test(waivedA));
  check("А: кнопки снятия больше нет", !/Снять начисление за перестой/.test(waivedA));

  // ── Бронь Б: долг принят заранее; два «Выехал» одновременно ──
  const urlB = await createQuick("E2E Перестой Б", testPlate());
  console.log(`  Б: ${urlB}`);
  await pay(700);
  await move(page, "Заехал");
  await page.getByRole("button", { name: "Принять оплату" }).click();
  equal("Б: «Принять оплату» подставляет долг 350", await page.getByLabel("Сумма").inputValue(), "350");
  check("Б: галочки «Это полная стоимость» в перестое нет", !(await page.getByText(/Это полная стоимость/).isVisible().catch(() => false)));
  await page.locator("form select").first().selectOption({ label: "Наличные" });
  await page.getByRole("button", { name: "Провести" }).click();
  await page.waitForTimeout(1500);
  check("Б: «долг 350 ₽ оплачен заранее»", /долг 350 ₽ оплачен заранее/.test(await body()));

  const page2 = await page.context().newPage();
  await page2.goto(urlB, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  for (const p of [page, page2]) {
    await p.getByRole("button", { name: "Выехал", exact: true }).first().click();
    await p.waitForTimeout(300);
  }
  const submitOut = (p) => (p.locator('input[type="datetime-local"]').isVisible().catch(() => false)).then((timed) => (timed ? p.getByRole("button", { name: "Выехал", exact: true }).last().click() : null));
  await Promise.all([submitOut(page), submitOut(page2)]);
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: "domcontentloaded" });
  const outB = await body();
  await page2.close();
  check("Б: после выезда «оплачено», 1 050 ₽", /1 050 ₽/.test(outB) && /оплачено/.test(outB) && !/не хватает/.test(outB));
  equal("Б: два одновременных «Выехал» — одно начисление", count(outB, /Начислен перестой/g), 1);
  equal("Б: и один переход «Заехал → Выехал»", count(outB, /Заехал → Выехал/g), 1);

  // СП §3.3: владелец после выезда возвращает сверх переплаты — сумма брони уменьшается, «не оплачено» не появляется
  await page.getByRole("button", { name: "Возврат" }).click();
  await page.getByLabel("Сумма").fill("350");
  await page.getByLabel("Причина возврата").fill("e2e: уступка владельца");
  await page.getByRole("button", { name: "Провести" }).click();
  await page.waitForTimeout(1500);
  const refB = await body();
  equal("Б: возврат владельца 350 — сумма брони 700 ₽", await amountNow(), "700 ₽");
  equal("Б: и «оплачено»", nb(await page.getByTestId("pay-status").textContent()).trim(), "оплачено");
  check("Б: в ленте «Возврат 350 ₽ · … · сумма брони 1 050 ₽ → 700 ₽»", /Возврат 350 ₽ · e2e: уступка владельца · сумма брони 1 050 ₽ → 700 ₽/.test(refB));
  check("Б: владелец уменьшил сумму — снимать начисление за перестой больше нечего", !/Снять начисление за перестой/.test(refB));

  // ── Бронь В: «Продлить» до завтра ──
  const urlC = await createQuick("E2E Перестой В", testPlate());
  console.log(`  В: ${urlC}`);
  await pay(700);
  await move(page, "Заехал");
  await page.getByLabel("Продлить до").fill(moscowPlus(1));
  await page.getByRole("button", { name: "Продлить" }).click();
  await page.waitForTimeout(1500);
  const extC = await body();
  check("В: после «Продлить» до завтра — 1 400 ₽, 4 сут.", /1 400 ₽/.test(extC) && /4 сут\./.test(extC));
  check("В: перестоя больше нет", !/ПЕРЕСТОЙ ·/.test(extC));
  check("В: в ленте «Продлено до … 2 сут. × 350 ₽ = 700 ₽»", /Продлено до [^:]+: 2 сут\. × 350 ₽ = 700 ₽/.test(extC));

  // Продлили — и тут же уменьшить сумму в «Изменить бронь» нельзя: это тот же снятый долг без причины
  await page.getByRole("button", { name: /Изменить бронь/ }).click();
  await page.getByLabel("Сумма брони").fill("1050");
  await page.getByRole("button", { name: /Сохранить/ }).click();
  await page.waitForTimeout(1500);
  check("В: машина на парковке — уменьшить сумму в «Изменить бронь» нельзя", /уменьшить сумму — «Изменить цену» с причиной/.test(await body()));
  await page.reload({ waitUntil: "domcontentloaded" });

  // Форма «Изменить бронь», открытая до выезда, не перезаписывает бронь после него
  await page.getByRole("button", { name: /Изменить бронь/ }).click();
  const other = await page.context().newPage();
  await other.goto(urlC, { waitUntil: "domcontentloaded" });
  await move(other, "Выехал");
  await other.close();
  await page.getByRole("button", { name: /Сохранить/ }).click();
  await page.waitForTimeout(1500);
  check("В: устаревшая форма не сохраняется — «обновите страницу»", /Бронь изменилась, пока была открыта форма/.test(await body()));

  // ── Бронь Г: забытый выезд — «Исправить статус» в «Выехал» долг не начисляет ──
  const urlD = await createQuick("E2E Перестой Г", testPlate());
  console.log(`  Г: ${urlD}`);
  await pay(700);
  await move(page, "Заехал");
  await correct("Выехал", "e2e: охрана не отметила выезд");
  const outD = await body();
  check("Г: сумма осталась 700 ₽", /700 ₽/.test(outD) && !/1 050 ₽/.test(outD));
  check("Г: в ленте «Перестой 1 сут. не начислен (350 ₽) · e2e: охрана не отметила выезд»", /Перестой 1 сут\. не начислен \(350 ₽\) · e2e: охрана не отметила выезд/.test(outD));

  finish("Перестой (Ф2а)");
});
