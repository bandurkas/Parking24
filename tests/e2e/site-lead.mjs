// Заявка с калькулятора на сайте → экран «Заявка принята» → карточка в CRM.
// Проверяет цену по правилу «даты включительно» (21.09) и перенос имени/телефона/мессенджера в CRM.
// ВАЖНО: форма молча отбрасывает отправку быстрее 1,5 с после загрузки (антибот в /api/public/lead),
// поэтому сценарий выдерживает паузу, как живой человек.
import { BASE, withBrowser, adminLogin, check, equal, finish, testPhone, isoPlus } from "./lib.mjs";

const phone = testPhone();
const from = isoPlus(3);
const to = isoPlus(5); // 3 суток по правилу «включительно»
const NAME = "E2E Тест";

await withBrowser(async (page) => {
  console.log(`\nЗаявка с сайта: ${BASE}, телефон +7${phone}, ${from} → ${to}`);

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const card = page.locator("#booking");
  await card.scrollIntoViewIfNeeded();

  // Шаг 1: даты. Цена появляется сразу после выбора обеих дат.
  // На stage страница отдаётся раньше, чем React подхватывает поля: заполняем с повтором,
  // пока в талоне не появится сумма, иначе шаг 2 остаётся закрытым и клики уходят в никуда.
  let priceText = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    await card.getByLabel("Дата заезда").fill(from);
    await card.getByLabel("Дата выезда").fill(to);
    await page.waitForTimeout(500 * attempt);
    priceText = ((await card.textContent()) ?? "").replace(/ /g, " ");
    if (/1 ?050/.test(priceText)) break;
  }

  check("цена 1 050 ₽ за 3 суток (даты включительно)", /1\s?050/.test(priceText), priceText.match(/[\d\s]+₽/)?.[0]?.trim() ?? "цены нет");

  // Шаг 2: контакты
  await card.getByPlaceholder("Иван").fill(NAME);
  await card.getByPlaceholder("900 000-00-00").fill(phone);
  await card.getByText("Telegram", { exact: false }).first().click();

  await page.waitForTimeout(1800); // антибот: отправка раньше 1,5 с игнорируется
  await card.getByRole("button", { name: /Забронировать место/i }).click();

  await card.getByText(/Заявка принята|Заявка уже у администратора/).waitFor({ timeout: 15000 });
  const okText = ((await card.textContent()) ?? "").replace(/ /g, " ");
  const number = okText.match(/№\s*(\d+)/)?.[1];
  check("экран «Заявка принята» с номером заявки", !!number, number ? `№${number}` : okText.slice(0, 120));
  check("в итоге заявки 3 суток и сумма", /3 суток/.test(okText) && /1 050/.test(okText), okText.match(/1[\s ]?050[^,]*/)?.[0] ?? "");
  check("подтверждение обещано в Telegram", /Telegram/.test(okText));
  check("чат клиенту не открывается сам", !okText.includes("Здравствуйте, хочу забронировать"));

  if (!number) return finish("Заявка с сайта");

  // CRM: заявка на месте, данные перенеслись
  await adminLogin(page);
  await page.goto(`${BASE}/admin/search?q=${phone}`, { waitUntil: "domcontentloaded" });
  const row = page.locator(`a[href^="/admin/bookings/"]`).filter({ hasText: `№${number}` }).first();
  check("заявка найдена в CRM по телефону", await row.isVisible().catch(() => false));

  await row.click();
  await page.waitForURL(/\/admin\/bookings\//, { timeout: 10000 });
  const bookingText = ((await page.locator("body").textContent()) ?? "").replace(/ /g, " ");
  check("имя с сайта в карточке", bookingText.includes(NAME));
  check("статус «Новая заявка»", /Новая заявка/.test(bookingText));
  check("источник «Сайт»", /Сайт/.test(bookingText));
  equal("сутки посчитаны включительно", /(\d+)\s*сут/.exec(bookingText)?.[1], "3");
  // Канал очереди проверяем строго внутри блока «Сообщения клиенту»: слово Telegram есть и в ссылках карточки
  const outbox = ((await page.getByText("Сообщения клиенту").locator("..").textContent().catch(() => "")) ?? "").replace(/ /g, " ");
  check("сообщение встало в очередь в выбранный мессенджер", /TELEGRAM/.test(outbox), outbox.match(/(WHATSAPP|TELEGRAM|MAX)/)?.[0] ?? "блок очереди не найден");
  check("очередь ждёт отправки (PENDING)", /запланировано/i.test(outbox), outbox.slice(0, 80));

  finish("Заявка с сайта");
});
