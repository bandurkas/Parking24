// Общие помощники e2e. Playwright берётся из глобального ~/node_modules (в проекте его нет специально:
// чтобы не тянуть браузеры в образ). Запуск: node tests/e2e/<файл>.mjs [--base URL]
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(join(homedir(), "node_modules", "noop.js"));

export function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    console.error("Playwright не найден. Установите: npm i -g playwright && npx playwright install chromium");
    process.exit(2);
  }
}

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export const BASE = arg("base", process.env.E2E_BASE ?? "http://localhost:3100").replace(/\/$/, "");
export const LOGIN = arg("login", process.env.E2E_LOGIN ?? "admin");
export const PASSWORD = arg("password", process.env.E2E_PASSWORD ?? "admin12345");
export const HEADED = process.argv.includes("--headed");

// Секрет запасного входа планировщика: --secret, E2E_CRON_SECRET или CRON_SECRET из локального .env
export function cronSecret() {
  const given = arg("secret", process.env.E2E_CRON_SECRET);
  if (given) return given;
  try {
    const env = readFileSync(join(process.cwd(), ".env"), "utf8");
    return env.match(/^CRON_SECRET=(.*)$/m)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

// Госномер теста: префикс Т000 не пересекается с реальными
export const TEST_PLATE_PREFIX = "Т000";
export function testPlate() {
  return `${TEST_PLATE_PREFIX}${String(Math.floor(Math.random() * 90) + 10)}77`;
}
export function testPhone() {
  return `999${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
}
export function isoPlus(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const checks = [];
export function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ✔" : "  ✘"} ${name}${detail ? ` — ${detail}` : ""}`);
}
export function equal(name, actual, expected) {
  check(name, actual === expected, actual === expected ? "" : `получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`);
}

export function finish(title) {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${title}: проверок ${checks.length}, провалено ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
  console.log("Тестовые данные удалить: node tests/e2e/cleanup.mjs\n");
  process.exit(0);
}

// Поля форм — управляемые React-компоненты. Пока страница не гидратирована, введённое значение
// остаётся в DOM, но обработчик не срабатывает и состояние формы не меняется. Поэтому проверять
// надо не само поле, а результат ввода на экране.
export async function fillReliably(locator, value, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    await locator.fill(value);
    await locator.page().waitForTimeout(150 * i);
    if ((await locator.inputValue()) === value) return true;
  }
  return (await locator.inputValue()) === value;
}

// Заполняет поля и ждёт, пока страница ответит (появилась цена, раскрылся шаг). При отсутствии
// реакции повторяет ввод: значит форма ещё не была готова принять его.
export async function fillUntil(page, fills, ready, attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    for (const [locator, value] of fills) await locator.fill(value);
    await page.waitForTimeout(350 * i);
    if (await ready().catch(() => false)) return true;
  }
  return false;
}

export async function adminLogin(page) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', LOGIN);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }), page.click('button[type="submit"]')]);
}

export async function withBrowser(fn) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage());
  page.on("pageerror", (e) => console.log(`  [ошибка страницы] ${e.message}`));
  try {
    await fn(page);
  } catch (e) {
    console.error(`\nСбой сценария: ${e.message}`);
    await page.screenshot({ path: `/tmp/e2e-fail-${Date.now()}.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
