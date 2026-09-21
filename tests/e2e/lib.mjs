// Общие помощники e2e. Playwright берётся из глобального ~/node_modules (в проекте его нет специально:
// чтобы не тянуть браузеры в образ). Запуск: node tests/e2e/<файл>.mjs [--base URL]
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

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
