// МФ-UI: роли и навигация. Вход полевых ролей (водитель, парковщик) на свои экраны без денег и телефонов,
// редиректы по roleHome, мобильная нижняя панель с листом «Ещё», путь «← CRM» с экрана КПП.
// Пароли сидов: driver12345/parker12345 (локально); на stage — E2E_DRIVER_PASSWORD/E2E_PARKER_PASSWORD.
import { BASE, LOGIN, PASSWORD, loadPlaywright, check, equal, finish } from "./lib.mjs";

const DRIVER_PASSWORD = process.env.E2E_DRIVER_PASSWORD ?? "driver12345";
const PARKER_PASSWORD = process.env.E2E_PARKER_PASSWORD ?? "parker12345";
const GUARD_PASSWORD = process.env.E2E_GUARD_PASSWORD ?? "guard12345";

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });

async function login(page, user, pass) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', user);
  await page.fill('input[name="password"]', pass);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }), page.click('button[type="submit"]')]);
}

const nb = (s) => (s ?? "").replace(/[  ]/g, " ");

try {
  console.log(`\nРоли и навигация (МФ-UI): ${BASE}`);

  // ── Водитель ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, "driver", DRIVER_PASSWORD);
    check("водитель: после входа /admin/transfers", page.url().includes("/admin/transfers"));
    const body = nb(await page.locator("body").innerText());
    check("водитель: на экране нет сумм", !/\d[\d ]*₽/.test(body), body.match(/[\d ]+₽/)?.[0] ?? "");
    equal("водитель: нет tel:-ссылок", await page.locator('a[href^="tel:"]').count(), 0);
    equal("водитель: нет ссылок на карточки броней", await page.locator('a[href*="/admin/bookings/"]').count(), 0);
    await page.goto(`${BASE}/admin/today`, { waitUntil: "domcontentloaded" });
    check("водитель: /admin/today вручную → редирект на свой экран", page.url().includes("/admin/transfers"));
    await ctx.close();
  }

  // ── Парковщик ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, "parker", PARKER_PASSWORD);
    check("парковщик: после входа /admin/parking-lot", page.url().includes("/admin/parking-lot"));
    const body = nb(await page.locator("body").innerText());
    check("парковщик: на экране нет сумм", !/\d[\d ]*₽/.test(body), body.match(/[\d ]+₽/)?.[0] ?? "");
    equal("парковщик: нет tel:-ссылок", await page.locator('a[href^="tel:"]').count(), 0);
    equal("парковщик: нет ссылок на карточки броней", await page.locator('a[href*="/admin/bookings/"]').count(), 0);
    check("парковщик: кнопок «Заехал»/«Выехал» нет", (await page.getByRole("button", { name: /^(Заехал|Выехал)$/ }).count()) === 0);
    await ctx.close();
  }

  // ── Владелец на телефоне: нижняя панель и лист «Ещё» ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, LOGIN === "admin" ? "owner" : LOGIN, LOGIN === "admin" ? "owner12345" : PASSWORD);
    await page.goto(`${BASE}/admin/boards/parking`, { waitUntil: "domcontentloaded" });
    const more = page.getByRole("button", { name: "Ещё" });
    await more.waitFor({ timeout: 15000 });
    check("телефон: нижняя панель видна («Ещё» есть)", await more.isVisible());
    await more.click();
    const sheet = page.getByRole("dialog", { name: "Меню" });
    await sheet.waitFor({ timeout: 10000 });
    const sheetText = nb(await sheet.innerText());
    check("лист «Ещё»: есть «Экран охраны»", /Экран охраны/.test(sheetText));
    check("лист «Ещё»: есть «Выйти»", /Выйти/.test(sheetText));
    check("лист «Ещё»: «Касса» серым «скоро»", /Касса/.test(sheetText) && /скоро/i.test(sheetText));
    check("лист «Ещё»: «Отчёты» есть, «Дашборд» нет", /Отчёты/.test(sheetText) && !/Дашборд/.test(sheetText));

    // «+» закрывает лист и открывает быструю заявку — один оверлей, не два
    await page.getByRole("button", { name: /Новая заявка|^\+$/ }).last().click().catch(() => page.locator('[aria-label="Новая заявка"]').last().click());
    await page.waitForTimeout(800);
    const drawer = page.getByRole("dialog", { name: "Новая заявка" });
    check("«+» из листа: открыт QuickBookingDrawer", await drawer.isVisible().catch(() => false));
    check("«+» из листа: лист «Ещё» закрыт", !(await sheet.isVisible().catch(() => false)));
    await page.keyboard.press("Escape");

    // выход из листа завершает сессию
    await page.getByRole("button", { name: "Ещё" }).click();
    await sheet.waitFor({ timeout: 10000 });
    await sheet.getByRole("button", { name: "Выйти" }).click();
    await page.waitForURL(/\/admin\/login/, { timeout: 15000 });
    check("лист «Ещё»: «Выйти» ведёт на логин", page.url().includes("/admin/login"));
    await ctx.close();
  }

  // ── «← CRM» на экране КПП: есть у владельца, нет у охраны ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();
    await login(page, LOGIN === "admin" ? "owner" : LOGIN, LOGIN === "admin" ? "owner12345" : PASSWORD);
    await page.goto(`${BASE}/admin/today?guard=1`, { waitUntil: "domcontentloaded" });
    const back = page.getByRole("link", { name: /CRM/ });
    check("владелец на КПП: ссылка «← CRM» есть", (await back.count()) > 0);
    if ((await back.count()) > 0) {
      await back.first().click();
      await page.waitForURL((u) => !u.search.includes("guard=1"), { timeout: 15000 });
      check("«← CRM» уводит с экрана КПП", !page.url().includes("guard=1"));
    }
    await ctx.close();

    const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page2 = await ctx2.newPage();
    await login(page2, "guard", GUARD_PASSWORD);
    check("охрана: попала на КПП", page2.url().includes("/admin/today"));
    equal("охрана: ссылки «← CRM» нет", await page2.getByRole("link", { name: /CRM/ }).count(), 0);
    await ctx2.close();
  }
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
if (process.exitCode) process.exit(1); // сбой сценария не маскируется зелёными проверками
finish("Роли и навигация (МФ-UI)");
