// Автоподтверждение и автоотклонение заявок с сайта (ТЗ 21.09, п. 1.1–1.2).
// Сценарий сам включает автоподтверждение в настройках, проверяет оба исхода и возвращает настройки как были.
// Порог на время теста опускается до 1 места, чтобы не создавать сотни броней.
import { BASE, withBrowser, adminLogin, check, finish, testPhone, isoPlus, fillReliably, fillUntil } from "./lib.mjs";

// Даты случайные и дальние: не пересекаются ни с реальными бронями, ни с прошлыми прогонами
// (порог на время теста — 1 место, поэтому чужая бронь на тех же датах сломала бы сценарий).
const offset = 60 + Math.floor(Math.random() * 150);
const from = isoPlus(offset);
const to = isoPlus(offset + 1);

async function lead(page, phone) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const card = page.locator("#booking");
  await card.scrollIntoViewIfNeeded();
  const ready = await fillUntil(
    page,
    [[card.getByLabel("Дата заезда"), from], [card.getByLabel("Дата выезда"), to]],
    async () => (await card.getByPlaceholder("Иван").getAttribute("tabindex")) === "0",
  );
  if (!ready) throw new Error("калькулятор не принял даты: шаг «Куда прислать подтверждение» не раскрылся");
  await card.getByPlaceholder("Иван").fill("E2E Автоподтверждение");
  await card.getByPlaceholder("900 000-00-00").fill(phone);
  await card.getByText("Telegram", { exact: false }).first().click();
  await page.waitForTimeout(1800); // антибот
  await card.getByRole("button", { name: /Забронировать место/i }).click();
  // Сайт ограничивает частоту: 8 заявок за 10 минут с одного адреса. При нескольких прогонах подряд
  // счётчик исчерпывается, и форма показывает «Отправить ещё раз» — это не поломка.
  const done = card.getByText(/Место забронировано|Заявка принята|Мест на эти даты нет|Заявка уже у администратора/).first();
  const retry = card.getByRole("button", { name: /Отправить ещё раз/i });
  await Promise.race([done.waitFor({ timeout: 15000 }).catch(() => {}), retry.waitFor({ timeout: 15000 }).catch(() => {})]);
  if (await retry.isVisible().catch(() => false)) {
    throw new Error("сайт отклонил заявку по ограничению частоты (8 за 10 мин) — подождите или перезапустите сервер");
  }
  await done.waitFor({ timeout: 5000 });
  return ((await card.textContent()) ?? "").replace(/ /g, " ");
}

// Кеш роутера отдаёт старое значение при повторном переходе — грузим страницу с уникальным адресом
function capacityUrl() {
  return `${BASE}/admin/settings/capacity?t=${Date.now()}`;
}

async function setCapacity(page, { limit, auto }) {
  await page.goto(capacityUrl(), { waitUntil: "domcontentloaded" });
  const ok = await fillReliably(page.getByLabel("Порог автоподтверждения"), String(limit));
  if (!ok) throw new Error("не удалось задать порог автоподтверждения");
  const box = page.locator('input[type="checkbox"]');
  if ((await box.isChecked()) !== auto) await box.click();
  await page.getByRole("button", { name: /Сохранить/ }).click();
  await page.getByText("Сохранено").waitFor({ timeout: 10000 });
}

await withBrowser(async (page) => {
  console.log(`\nАвтоподтверждение: ${BASE}, даты ${from} → ${to}`);
  await adminLogin(page);

  // Настройки владельца видны только владельцу — сценарий требует роль OWNER
  await page.goto(capacityUrl(), { waitUntil: "domcontentloaded" });
  if (!page.url().includes("/settings/capacity")) {
    console.log("  Пропуск: нужен вход владельцем (--login owner --password …)");
    return finish("Автоподтверждение");
  }
  const limitField = page.getByLabel("Порог автоподтверждения");
  const savedLimit = await limitField.inputValue();
  const savedAuto = await page.locator('input[type="checkbox"]').isChecked();

  try {
    // 1. Автоподтверждение включено, порог 1 — первая заявка на свободные даты проходит
    await setCapacity(page, { limit: 1, auto: true });
    const first = await lead(page, testPhone());
    check("заявка подтверждена автоматически", /Место забронировано/.test(first), first.slice(0, 90));
    check("клиенту обещана оплата при заезде", /Оплата при заезде/.test(first));

    // 2. Место занято — вторая заявка на те же даты отклоняется
    const second = await lead(page, testPhone());
    check("вторая заявка отклонена: мест нет", /Мест на эти даты нет/.test(second), second.slice(0, 90));
    check("клиенту предложены другие даты", /другие даты/.test(second));

    // 3. Администратор получил уведомление
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Уведомления/ }).click();
    const bell = ((await page.locator("body").textContent()) ?? "");
    check("уведомление администратору об отклонении", /отклонена: на выбранные даты нет мест/.test(bell), bell.match(/Заявка №\d+ отклонена[^«]*/)?.[0]?.slice(0, 70) ?? "уведомления нет");

    // 3а. Отклонённая заявка видна на доске своей колонкой и в таблице (ревью 22.09: исчезала из CRM)
    const rejected = [...bell.matchAll(/Заявка №(\d+) отклонена/g)].map((m) => Number(m[1])).sort((a, b) => b - a)[0];
    if (rejected) {
      await page.goto(`${BASE}/admin/boards/parking?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
      const column = page.locator("section", { has: page.getByRole("heading", { name: "Отклонена", exact: true }) });
      const colText = (await column.textContent({ timeout: 10000 }).catch(() => "")) ?? "";
      check("на канбане есть колонка «Отклонена» с этой заявкой", colText.includes(`№${rejected}`), `№${rejected}`);
      await page.goto(`${BASE}/admin/boards/parking?view=table&t=${Date.now()}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Отклонена", exact: true }).click();
      const row = page.getByRole("link", { name: `№${rejected}`, exact: true });
      check("в таблице с фильтром «Отклонена» заявка видна", await row.isVisible({ timeout: 10000 }).catch(() => false));
      await row.click();
      await page.waitForURL(/\/admin\/bookings\//, { timeout: 15000 });
      const cardText = (await page.locator("body").textContent()) ?? "";
      check("в карточке брони этап «Отклонена · нет мест», автоматически", /Отклонена · нет мест/.test(cardText) && /автоматически/.test(cardText));
    } else {
      check("номер отклонённой заявки найден в уведомлении", false);
    }

    // 4. Автоподтверждение выключено — заявка снова ждёт администратора
    await setCapacity(page, { limit: 1, auto: false });
    const third = await lead(page, testPhone());
    check("с выключенным автоподтверждением заявка ждёт администратора", /Заявка принята/.test(third), third.slice(0, 90));
  } finally {
    await setCapacity(page, { limit: Number(savedLimit), auto: savedAuto });
    console.log(`  настройки возвращены: порог ${savedLimit}, автоподтверждение ${savedAuto ? "включено" : "выключено"}`);
  }

  finish("Автоподтверждение");
});
