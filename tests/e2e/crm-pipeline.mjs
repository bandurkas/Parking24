// Конвейер CRM: быстрая заявка → «Подтвердить место» → оплата → заезд → выезд → «по факту» → возврат переплаты и отказы; вторая бронь оплачена сразу из «Новой».
// Страхует расчёт суток, смену статусов, деньги и ленту событий. «Заехал»/«Выехал» — одно нажатие, время серверное (Ф9а).
import { BASE, withBrowser, adminLogin, check, equal, finish, testPhone, testPlate, isoPlus, fillReliably } from "./lib.mjs";

const phone = testPhone();
const plate = testPlate();
const from = isoPlus(0);
const to = isoPlus(2); // 3 суток × 350 ₽ = 1050 ₽

await withBrowser(async (page) => {
  console.log(`\nКонвейер CRM: ${BASE}, ${plate}, +7${phone}, ${from} → ${to}`);
  await adminLogin(page);

  // Быстрая заявка → карточка брони. Проверки расчёта — только у первой.
  async function createQuick(name, first, plateNo) {
    // Быстрая заявка. Кнопка именно в шапке: на доске есть колонка с тем же названием.
    // Если шторка не открылась (гидратация ещё идёт) — горячая клавиша N.
    await page.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    const drawer = page.getByRole("dialog", { name: "Новая заявка" });
    await page.locator("header").getByRole("button", { name: /Новая заявка/i }).click();
    if (!(await drawer.isVisible().catch(() => false))) {
      await page.waitForTimeout(1500);
      await page.keyboard.press("n");
    }
    await drawer.waitFor({ timeout: 15000 });

    await fillReliably(drawer.getByPlaceholder("+7 9xx xxx-xx-xx"), phone);
    await fillReliably(drawer.getByPlaceholder("Имя (необязательно)"), name);
    await fillReliably(drawer.getByLabel("Заезд", { exact: true }), from);
    await fillReliably(drawer.getByLabel("Выезд", { exact: true }), to);
    await fillReliably(drawer.getByPlaceholder("Госномер: А123ВС77"), plateNo);
    await page.waitForTimeout(800); // расчёт цены с сервера

    const quote = ((await drawer.textContent()) ?? "").replace(/ /g, " ");
    if (first) check("расчёт в заявке: 3 суток", /3\s*сут/i.test(quote), quote.match(/\d+\s*сут[^·,]*/i)?.[0]?.trim() ?? "суток нет");
    if (first) check("расчёт в заявке: 1 050 ₽", /1 ?050/.test(quote), quote.match(/[\d ]+₽/)?.[0] ?? "цены нет");

    await drawer.getByRole("button", { name: /^Создать$/ }).click();
    // После создания шторка закрывается, внизу тост «Заявка №N создана · открыть»
    const toastLink = page.getByRole("link", { name: "открыть" });
    await toastLink.waitFor({ timeout: 15000 });
    if (first) check("тост с номером новой заявки", /№\s*\d+/.test((await page.locator("body").textContent()) ?? ""));
    await toastLink.click();
    await page.waitForURL(/\/admin\/bookings\//, { timeout: 15000 });
    console.log(`  карточка: ${page.url()}`);
  }

  await createQuick("E2E Конвейер", true, plate);

  const body = async () => ((await page.locator("body").textContent()) ?? "").replace(/ /g, " ");
  check("в карточке сумма 1 050 ₽", /1 ?050/.test(await body()));

  // Основной путь: место подтверждено, клиент платит на въезде
  await page.getByRole("button", { name: "Подтвердить место", exact: true }).click();
  await page.waitForTimeout(1500);
  check("после «Подтвердить место» статус «Ожидает оплаты»", /Ожидает оплаты/.test(await body()));

  // Оплата наличными полностью → статус «Подтверждена»
  await page.getByRole("button", { name: "Принять оплату" }).click();
  await page.getByLabel("Сумма").fill("1050");
  await page.locator("select").first().selectOption({ label: "Наличные" });
  await page.getByRole("button", { name: "Провести" }).click();
  await page.waitForTimeout(1500);
  const afterPay = await body();
  check("после полной оплаты статус «Подтверждена»", /Подтверждена/.test(afterPay));
  // Подтверждение одно на бронь: при оплате на ресепшене второе «место забронировано» не ставится
  check("в очереди одно подтверждение, без повтора при оплате", /on_awaiting_payment/.test(afterPay) && !/on_confirmed/.test(afterPay));

  // Заезд и выезд — одно нажатие, время ставит сервер (Ф9а): поля времени нет, диалогов нет (не перестой)
  let dialogs = 0;
  page.on("dialog", (d) => { dialogs++; d.dismiss().catch(() => {}); });
  async function move(verb) {
    await page.getByRole("button", { name: verb, exact: true }).first().click();
    await page.waitForTimeout(1500);
    equal(`«${verb}»: поля времени нет`, await page.locator('input[type="datetime-local"]').count(), 0);
  }

  await move("Заехал");
  check("статус «Заехал»", /Заехал/.test(await body()));

  await move("Выехал");
  const afterOut = await body();
  check("статус «Выехал»", /Выехал/.test(afterOut));
  equal("«Заехал»/«Выехал» без диалогов", dialogs, 0);
  // Время события — в строке перехода ленты, а не где угодно на странице (там есть и «заезд 12:00» из полей брони)
  const feedOut = ((await page.locator("aside li", { hasText: "Заехал → Выехал" }).first().innerText().catch(() => "")) ?? "").replace(/[  ]/g, " ");
  check("время события есть в строке ленты «Заехал → Выехал»", /\d{1,2}:\d{2}/.test(feedOut), feedOut.replace(/\n/g, " ") || "строки нет");

  // Досрочный выезд (docs/phases/PHASE_SP_URGENT_FIXES.md §3.3): после выезда администратор возвращает только переплату —
  // сначала «Пересчитать по факту» (3 сут. по плану, по факту 1 → 350 ₽), затем возврат переплаты с причиной
  const amountNow = async () => (await page.getByTestId("booking-amount").textContent())?.replace(/[  ]/g, " ").trim();
  const payStatus = async () => (await page.getByTestId("pay-status").textContent())?.replace(/[  ]/g, " ").trim();
  check("после выезда в тот же день — баннер «Стоянка по факту»", /Стоянка по факту/.test(afterOut));
  await page.getByRole("button", { name: "Пересчитать по факту" }).click();
  await page.waitForTimeout(1500);
  equal("по факту: сумма 350 ₽", await amountNow(), "350 ₽");

  await page.getByRole("button", { name: "Возврат" }).click();
  equal("«Возврат» подставляет переплату 700", await page.getByLabel("Сумма").inputValue(), "700");
  check("без причины «Провести» недоступна", await page.getByRole("button", { name: "Провести" }).isDisabled());
  await page.getByLabel("Сумма").fill("350");
  await page.getByLabel("Причина возврата").fill("e2e: досрочный выезд");
  await page.getByRole("button", { name: "Провести" }).click();
  await page.waitForTimeout(1500);
  const afterRefund = await body();
  check("возврат записан в платежи", /−350|-350/.test(afterRefund), afterRefund.match(/[−-]\s?350\s?₽/)?.[0] ?? "строки возврата нет");
  equal("после возврата переплаты сумма та же — 350 ₽", await amountNow(), "350 ₽");
  equal("после возврата — «оплачено»", await payStatus(), "оплачено");

  // Отказы сервера: больше оплаченного (700) и больше переплаты (350) — форма остаётся открытой с ошибкой
  async function refundTry(sum) {
    if (!(await page.getByLabel("Причина возврата").isVisible().catch(() => false))) await page.getByRole("button", { name: "Возврат" }).click();
    await page.getByLabel("Сумма").fill(String(sum));
    await page.getByLabel("Причина возврата").fill("e2e: проверка предела");
    await page.getByRole("button", { name: "Провести" }).click();
    await page.waitForTimeout(1500);
    return body();
  }
  check("возврат 800 при оплате 700 — «Возврат больше оплаченного»", /Возврат больше оплаченного/.test(await refundTry(800)));
  check("возврат 400 при переплате 350 — «только переплату»", /администратор возвращает только переплату/.test(await refundTry(400)));
  equal("после отказов сумма 350 ₽", await amountNow(), "350 ₽");

  // Ложного долга у клиента нет: «К оплате» — «—»
  await page.goto(`${BASE}${await page.locator('a[href^="/admin/clients/"]').first().getAttribute("href")}`, { waitUntil: "domcontentloaded" });
  // плитка: значение, под ним подпись
  const due = (await page.getByText("К оплате", { exact: true }).locator("xpath=preceding-sibling::div[1]").textContent().catch(() => "плитки нет"))?.trim();
  equal("карточка клиента: «К оплате» — «—»", due, "—");

  // Второй путь: бронь оплачена сразу из «Новой» — подтверждение уходит одно, от on_confirmed
  await createQuick("E2E Сразу оплата", false, testPlate());
  await page.getByRole("button", { name: "Принять оплату" }).click();
  await page.getByLabel("Сумма").fill("1050");
  await page.locator("select").first().selectOption({ label: "Наличные" });
  await page.getByRole("button", { name: "Провести" }).click();
  await page.waitForTimeout(1500);
  const direct = await body();
  check("оплата из «Новой»: статус «Подтверждена»", /Подтверждена/.test(direct));
  check("оплата из «Новой»: одно подтверждение on_confirmed", (direct.match(/on_confirmed/g) ?? []).length === 1 && !/on_awaiting_payment/.test(direct));

  finish("Конвейер CRM");
});
