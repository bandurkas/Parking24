// Конвейер CRM: быстрая заявка → «Подтвердить место» → оплата → заезд → выезд → возврат; вторая бронь оплачена сразу из «Новой».
// Страхует расчёт суток, смену статусов, деньги и ленту событий.
import { BASE, withBrowser, adminLogin, check, finish, testPhone, testPlate, isoPlus, fillReliably } from "./lib.mjs";

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

  // Заезд. До этапа 3 ТЗ время вводится вручную — форму подтверждаем; после правки поля не будет.
  async function move(verb) {
    await page.getByRole("button", { name: verb, exact: true }).first().click();
    await page.waitForTimeout(400);
    const timeField = page.locator('input[type="datetime-local"]');
    if (await timeField.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: verb, exact: true }).last().click();
    }
    await page.waitForTimeout(1500);
  }

  await move("Заехал");
  check("статус «Заехал»", /Заехал/.test(await body()));

  await move("Выехал");
  const afterOut = await body();
  check("статус «Выехал»", /Выехал/.test(afterOut));
  check("время события есть в ленте", /\d{1,2}:\d{2}/.test(afterOut));

  // Возврат части оплаты
  await page.getByRole("button", { name: "Возврат" }).click();
  await page.getByLabel("Сумма").fill("350");
  await page.getByRole("button", { name: "Провести" }).click();
  await page.waitForTimeout(1500);
  const afterRefund = await body();
  check("возврат записан в платежи", /−350|-350/.test(afterRefund), afterRefund.match(/[−-]\s?350\s?₽/)?.[0] ?? "строки возврата нет");

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
