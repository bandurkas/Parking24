// Синхронизация цен CRM → сайт: владелец меняет цену легковой в «Настройки → Тарифы» → главная (карточка тарифа, список типов
// в калькуляторе, описание страницы) и калькулятор показывают новую цену → заявка с сайта создаёт бронь с той же суммой.
// Ступень «от N суток» в калькуляторе — по цене из CRM. Цена возвращается как была в finally (и при сбое сценария).
// Входит владельцем (--login owner --password owner12345). Форма сайта молча отбрасывает отправку быстрее 1,5 с (антибот).
import { BASE, withBrowser, adminLogin, check, equal, finish, testPhone, isoPlus, fillUntil } from "./lib.mjs";

const flat = (s) => (s ?? "").replace(/\s/g, ""); // \s в JS ловит и неразрывные пробелы в суммах
const tariffRow = (page, code) => page.locator(`[data-tariff="${code}"]`);
const priceInput = (page, code) => tariffRow(page, code).locator('input[inputmode="numeric"]');

// Кнопка до гидратации молчит: ждём, пока React повесит обработчики на элемент
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

async function setCarPrice(page, value) {
  await page.goto(`${BASE}/admin/settings/tariffs`, { waitUntil: "domcontentloaded" });
  const input = await live(priceInput(page, "car"));
  if ((await input.inputValue()) === value) return;
  await input.fill(value);
  await (await live(tariffRow(page, "car").getByRole("button", { name: "Сохранить" }))).click();
  await tariffRow(page, "car").getByRole("status").filter({ hasText: "Сохранено" }).waitFor({ timeout: 15000 });
}

await withBrowser(async (page) => {
  console.log(`\nСинхронизация цен CRM → сайт: ${BASE}`);
  await adminLogin(page);
  await page.goto(`${BASE}/admin/settings/tariffs`, { waitUntil: "domcontentloaded" });
  const orig = await (await live(priceInput(page, "car"))).inputValue();
  const long = Number(await priceInput(page, "car_long").inputValue());
  const next = Number(orig) + 7;
  check("исходные цены легковой прочитаны", Number(orig) > 0 && long > 0, `${orig} / от 30 суток ${long}`);

  try {
    await setCarPrice(page, String(next));
    console.log(`  цена легковой в CRM: ${orig} → ${next}`);

    await page.goto(`${BASE}/`, { waitUntil: "load" });
    const card = page.locator("#booking");
    const carCard = page.locator("#tariffs article").filter({ hasText: "Легковая" }).first();
    check("таблица тарифов: легковая — новая цена", flat(await carCard.innerText()).includes(`${next}₽`), flat(await carCard.innerText()).slice(0, 30));
    check("калькулятор: в списке типов новая цена", (await card.locator('option[value="car"]').innerText()).includes(`${next} ₽/сутки`));
    const desc = (await page.locator('meta[name="description"]').first().getAttribute("content")) ?? "";
    check("описание страницы: новая цена", desc.includes(`легковые — ${next} ₽/сутки`), desc.slice(0, 90));

    // Ступень «от 30 суток»: 35 суток по цене car_long из CRM
    const text = async () => flat(await card.textContent());
    const longOk = await fillUntil(page, [[card.getByLabel("Дата заезда"), isoPlus(40)], [card.getByLabel("Дата выезда"), isoPlus(74)]], async () => (await text()).includes(`${35 * long}₽`));
    check(`калькулятор: 35 суток — ${35 * long} ₽ (ступень от 30 суток из CRM)`, longOk, (await text()).match(/Стоимостьстоянки[\d]+₽/)?.[0] ?? "");

    // Заявка на 3 суток по новой цене
    const phone = testPhone();
    const amount = 3 * next;
    const shortOk = await fillUntil(page, [[card.getByLabel("Дата заезда"), isoPlus(3)], [card.getByLabel("Дата выезда"), isoPlus(5)]], async () => (await text()).includes(`${amount}₽`));
    check(`калькулятор: 3 суток — ${amount} ₽`, shortOk);
    await card.getByPlaceholder("Иван").fill("E2E Цены");
    await card.getByPlaceholder("900 000-00-00").fill(phone);
    await card.getByText("Telegram", { exact: false }).first().click();
    await page.waitForTimeout(1800);
    await card.getByRole("button", { name: /Забронировать место/i }).click();
    await card.getByText(/Заявка принята|Заявка уже у администратора|Место забронировано|Мест на эти даты нет/).first().waitFor({ timeout: 15000 });
    const ok = flat(await card.textContent());
    const number = ok.match(/№(\d+)/)?.[1];
    check("заявка принята, есть номер", !!number, ok.slice(0, 80));
    check("итог заявки на сайте: та же сумма", ok.includes(`${amount}₽за3суток`));

    if (number) {
      await page.goto(`${BASE}/admin/search?q=${phone}`, { waitUntil: "domcontentloaded" });
      const link = page.locator('a[href^="/admin/bookings/"]').filter({ hasText: `№${number}` }).first();
      await page.goto(`${BASE}${await link.getAttribute("href")}`, { waitUntil: "domcontentloaded" });
      equal("бронь в CRM: сумма как на сайте", flat(await page.getByTestId("booking-amount").innerText()), `${amount}₽`);
    }
  } finally {
    await setCarPrice(page, orig);
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    const carCard = page.locator("#tariffs article").filter({ hasText: "Легковая" }).first();
    check(`цена возвращена (${orig} ₽) — и на сайте`, flat(await carCard.innerText()).includes(`${orig}₽`));
  }

  finish("Синхронизация цен CRM → сайт");
});
