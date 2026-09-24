// Ф8 «Не смогли к нам попасть» (docs/phases/PHASE_08_MISSED_SEGMENT.md, раздел «Код»): заявка с сайта отклонена
// «мест нет» → клиент в сегменте на странице «Клиенты»; клиент, который потом забронировал, помечен; администратор
// сегмент видит, а выгрузки у него нет (403); охрана, водитель и парковщик сегмента не видят; CSV скачивает только
// владелец, и в журнале появляется EXPORT.
// Отказ «мест нет» создаётся локально: предохранитель открывается фикстурой МФ-1, порог — 0; на stage без базы
// проверяются только вкладка, выгрузка и права.
// Запуск: node tests/e2e/f8-segment.mjs --base http://localhost:3101 --login owner --password owner12345
// Второй вход — admin (E2E_ADMIN_PASSWORD или --admin-password), роли — E2E_GUARD/DRIVER/PARKER_PASSWORD.
import { readFile } from "node:fs/promises";
import { BASE, LOGIN, PASSWORD, HEADED, arg, loadPlaywright, check, equal, finish, testPhone, isoPlus } from "./lib.mjs";
import { LOCAL, db, openGate, snapshotGate } from "./autoconfirm-fixture.mjs";

const ADMIN_PASSWORD = arg("admin-password", process.env.E2E_ADMIN_PASSWORD ?? "admin12345");
const FIELD = [
  ["guard", process.env.E2E_GUARD_PASSWORD ?? "guard12345"],
  ["driver", process.env.E2E_DRIVER_PASSWORD ?? "driver12345"],
  ["parker", process.env.E2E_PARKER_PASSWORD ?? "parker12345"],
];
const EXPORT_URL = `${BASE}/api/admin/clients/no-space`;
const SEGMENT_URL = () => `${BASE}/admin/clients?segment=no_space&t=${Date.now()}`;

const net = 20 + Math.floor(Math.random() * 200);
let seq = 0;
const freshIp = () => `10.${net}.${200 + Math.floor(seq / 250)}.${(++seq % 250) + 1}`;
const base = 250 + Math.floor(Math.random() * 90);
const span = (k) => ({ dateFrom: isoPlus(base + k * 3), dateTo: isoPlus(base + k * 3 + 1) });
const fmtPhone = (d) => `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");

async function postLead(body) {
  const res = await fetch(`${BASE}/api/public/lead`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": freshIp() },
    body: JSON.stringify({ vehicleType: "car", dial: "+7", channels: ["TELEGRAM"], primary: "TELEGRAM", website: "", ...body }),
  });
  return { status: res.status, ...((await res.json().catch(() => null)) ?? {}) };
}

async function login(browser, user, pass) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [ошибка страницы] ${e.message}`));
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', user);
  await page.fill('input[name="password"]', pass);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }), page.click('button[type="submit"]')]);
  return { ctx, page };
}

const row = (page, digits) => page.locator('[data-testid="no-space-table"] tr[data-client]', { hasText: fmtPhone(digits) });

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !HEADED });
let restore = null;
try {
  console.log(`\nФ8 «Не смогли к нам попасть»: ${BASE}${LOCAL ? "" : " (без базы — вкладка, выгрузка, права)"}`);
  const owner = await login(browser, LOGIN, PASSWORD);
  await owner.page.goto(SEGMENT_URL(), { waitUntil: "domcontentloaded" });
  if ((await owner.page.getByTestId("no-space-export").count()) === 0) {
    console.log("  Пропуск: нужен вход владельцем (--login owner --password …)");
    finish("Ф8 сегмент");
  }

  const [pa, pb] = [testPhone(), testPhone()];
  let a = null, b = null, b2 = null;
  if (LOCAL) {
    restore = await snapshotGate();
    await openGate();
    const set = (key, value) => db().setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await set("parking.autoConfirm", true);
    await set("parking.autoConfirmLimit", 0);
    // 1. Две заявки с сайта отклонены «мест нет»
    a = await postLead({ ...span(0), phone: pa, name: "E2E Ф8 Анна" });
    b = await postLead({ ...span(1), phone: pb, name: "E2E Ф8 Борис" });
    equal("заявка А с сайта: «мест нет»", a.state, "rejected");
    equal("заявка Б с сайта: «мест нет»", b.state, "rejected");
    const ra = await db().booking.findUnique({ where: { number: a.number } });
    equal("у отказа А — «Отклонена», NO_SPACE", `${ra?.status}/${ra?.rejectKind}`, "REJECTED/NO_SPACE");
    // 2. Места появились — Б бронирует на другие даты
    await set("parking.autoConfirmLimit", 395);
    b2 = await postLead({ ...span(2), phone: pb, name: "E2E Ф8 Борис" });
    equal("Б потом забронировал: «Место забронировано»", b2.state, "confirmed");
  }

  // 3. Владелец: вкладка, строки, пометка «потом забронировал»
  await owner.page.goto(`${BASE}/admin/clients?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  const tab = owner.page.getByRole("link", { name: /^Не смогли к нам попасть · \d+$/ });
  check("в «Клиентах» вкладка «Не смогли к нам попасть · N»", await tab.isVisible());
  await tab.click();
  await owner.page.waitForURL(/segment=no_space/);
  await owner.page.getByTestId("no-space-table").waitFor();
  check("подпись: только личный звонок, реклама без согласия запрещена", await owner.page.getByText("ст. 18 ФЗ «О рекламе»").isVisible());
  if (LOCAL) {
    const rowA = nb(await row(owner.page, pa).innerText().catch(() => ""));
    check("А в сегменте: имя, мессенджер, заявка", rowA.includes("E2E Ф8 Анна") && rowA.includes("Telegram") && rowA.includes(`№${a.number}`), rowA ? "" : "строки нет");
    check("А: время отказа по Москве", /\d{1,2} [а-я]{3,4},? \d{2}:\d{2}/.test(rowA));
    equal("А: «потом забронировал» — нет", nb(await row(owner.page, pa).locator('[data-col="booked-later"]').innerText()).trim(), "нет");
    const later = nb(await row(owner.page, pb).locator('[data-col="booked-later"]').innerText().catch(() => "")).trim();
    equal("Б помечен: «да · №N · Ожидает оплаты»", later, `да · №${b2.number} · Ожидает оплаты`);
    const total = Number((await tab.innerText()).match(/(\d+)$/)?.[1]);
    const inDb = await db().client.count({ where: { bookings: { some: { rejectKind: "NO_SPACE" } } } });
    equal("счётчик на вкладке = клиентов с отказом NO_SPACE", total, inDb);
  }

  // 4. Выгрузка владельцем: файл CSV с BOM, запись EXPORT
  const auditBefore = LOCAL ? await db().auditLog.count({ where: { action: "EXPORT", entity: "Client" } }) : 0;
  const [download] = await Promise.all([owner.page.waitForEvent("download"), owner.page.getByTestId("no-space-export").click()]);
  const csv = await readFile(await download.path(), "utf8");
  check("файл ne-smogli-popast-<дата>.csv", /^ne-smogli-popast-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), download.suggestedFilename());
  check("BOM и заголовок «Телефон;Имя;Мессенджер…»", csv.startsWith('\uFEFF"Телефон";"Имя";"Мессенджер";"Не беспокоить";"Отказ (МСК)"'), csv.slice(0, 80));
  if (LOCAL) {
    const lineA = csv.split("\r\n").find((l) => l.includes(fmtPhone(pa))) ?? "";
    check("в файле А: телефон обезврежен апострофом, имя, даты, № заявки", lineA.startsWith(`"'${fmtPhone(pa)}";"E2E Ф8 Анна";"Telegram";""`) && lineA.includes(`"${a.number}";""`), lineA);
    const lineB = csv.split("\r\n").find((l) => l.includes(fmtPhone(pb))) ?? "";
    check("в файле Б: «потом забронировал №»", lineB.endsWith(`"${b.number}";"${b2.number}"`), lineB);
    const ownerUser = await db().user.findUnique({ where: { login: LOGIN } });
    const log = await db().auditLog.findFirst({ where: { action: "EXPORT", entity: "Client" }, orderBy: { createdAt: "desc" } });
    equal("журнал: одна новая запись EXPORT", await db().auditLog.count({ where: { action: "EXPORT", entity: "Client" } }), auditBefore + 1);
    check("журнал: EXPORT от владельца, сегмент и число строк", log?.userId === ownerUser?.id && log?.diff?.segment === "no_space" && log?.diff?.count === csv.split("\r\n").length - 1, JSON.stringify(log?.diff));
  }

  // 5. Администратор видит сегмент, выгрузки нет
  {
    const { ctx, page } = await login(browser, "admin", ADMIN_PASSWORD);
    await page.goto(SEGMENT_URL(), { waitUntil: "domcontentloaded" });
    check("администратор: сегмент открыт", await page.getByTestId("no-space-table").isVisible());
    if (LOCAL) check("администратор: А в списке с телефоном", (await row(page, pa).count()) === 1);
    equal("администратор: кнопки «Выгрузить CSV» нет", await page.getByTestId("no-space-export").count(), 0);
    const res = await page.request.get(EXPORT_URL);
    equal("администратор: выгрузка в обход кнопки — 403", res.status(), 403);
    equal("администратор: «Выгрузка доступна только владельцу»", (await res.json().catch(() => ({}))).error, "Выгрузка доступна только владельцу");
    await ctx.close();
  }

  // 6. Охрана, водитель, парковщик — ни сегмента, ни выгрузки
  for (const [user, pass] of FIELD) {
    const { ctx, page } = await login(browser, user, pass);
    await page.goto(SEGMENT_URL(), { waitUntil: "domcontentloaded" });
    check(`${user}: /admin/clients?segment=no_space → свой экран`, !page.url().includes("/admin/clients"), page.url());
    equal(`${user}: таблицы сегмента нет`, await page.getByTestId("no-space-table").count(), 0);
    equal(`${user}: выгрузка — 403`, (await page.request.get(EXPORT_URL)).status(), 403);
    await ctx.close();
  }
  equal("без входа выгрузка — 401", (await fetch(EXPORT_URL)).status, 401);
  if (LOCAL) equal("журнал: чужие попытки EXPORT не пишут", await db().auditLog.count({ where: { action: "EXPORT", entity: "Client" } }), auditBefore + 1);
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (restore) await restore();
  await browser.close();
}
if (process.exitCode) process.exit(process.exitCode);
finish("Ф8 сегмент");
