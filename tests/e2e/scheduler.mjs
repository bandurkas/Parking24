// Планировщик (Ф1, docs/phases/PHASE_01_SCHEDULER.md): запасной вход, пульс в карточке настроек, пауза.
// Нужен вход владельцем и секрет: --secret, E2E_CRON_SECRET или CRON_SECRET из локального .env
import { BASE, withBrowser, adminLogin, check, finish, cronSecret } from "./lib.mjs";

const secret = cronSecret();
const url = `${BASE}/api/cron/automations`;
const tick = (headers = { "X-Cron-Secret": secret }) => fetch(url, { method: "POST", headers });

// Время тика по Москве, как его печатает fmtDateTime в карточке: «03:41»
const hhmm = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

await withBrowser(async (page) => {
  console.log(`\nПланировщик: ${BASE}`);
  if (!secret) throw new Error("нет секрета: --secret, E2E_CRON_SECRET или CRON_SECRET в .env");

  // 1. Вход закрыт без секрета
  check("без секрета — 404", (await tick({})).status === 404);
  check("с чужим секретом — 404", (await tick({ "X-Cron-Secret": "x".repeat(40) })).status === 404);
  const get = await fetch(url);
  check("GET не принимается", get.status !== 200, `статус ${get.status}`);

  // 2. С секретом — результат тика
  const one = await tick();
  const body = one.status === 200 ? await one.json() : null;
  check("с секретом — 200 и результат тика", !!body && typeof body.at === "string" && Array.isArray(body.failed) && typeof body.done === "object", `статус ${one.status}`);
  check("тик без сбоев", !!body && body.failed.length === 0, body ? JSON.stringify(body.failed) : "");

  // 3. Параллельные вызовы не дают 500
  const many = await Promise.all(Array.from({ length: 5 }, () => tick()));
  check("пять вызовов подряд — ни одного 500", many.every((r) => r.status === 200), many.map((r) => r.status).join(","));

  // 4. Карточка владельца показывает время последнего тика
  const last = await (await tick()).json();
  await adminLogin(page);
  await page.goto(`${BASE}/admin/settings?t=${Date.now()}`, { waitUntil: "load" });
  const state = page.getByTestId("scheduler-state");
  const text = ((await state.textContent({ timeout: 10000 }).catch(() => "")) ?? "").replace(/ /g, " ");
  if (!text) {
    check("карточка «Планировщик» видна (нужен вход владельцем)", false);
    return finish("Планировщик");
  }
  check("карточка показывает время последнего тика", text.includes(hhmm(last.at)), text);

  // 5. Пауза останавливает тик и снимается обратно
  const pauseBtn = page.getByRole("button", { name: "Поставить на паузу" });
  const resumeBtn = page.getByRole("button", { name: "Снять с паузы" });
  if (await resumeBtn.isVisible().catch(() => false)) {
    // Кто-то поставил паузу намеренно — не трогаем
    console.log("  Пропуск проверки паузы: планировщик уже на паузе до теста");
    return finish("Планировщик");
  }
  try {
    await pauseBtn.click();
    await resumeBtn.waitFor({ timeout: 15000 });
    const paused = await (await tick()).json();
    check("на паузе тик отвечает paused", paused.paused === true);
    const card = ((await state.textContent()) ?? "");
    // При RUN_SCHEDULER≠1 карточка честно пишет «Выключен», пауза видна только на включённом сервере
    if (!/Выключен/.test(card)) check("карточка сразу показывает «На паузе»", /На паузе/.test(card), card);
  } finally {
    // Снять паузу при любом исходе: оставленная пауза на stage молча останавливает все автоматизации
    for (let i = 0; i < 3; i++) {
      const now = await tick().then((r) => r.json()).catch(() => null);
      if (now && now.paused !== true) break;
      await page.goto(`${BASE}/admin/settings?t=${Date.now()}`, { waitUntil: "load" }).catch(() => {});
      if (await resumeBtn.isVisible().catch(() => false)) {
        await resumeBtn.click().catch(() => {});
        await pauseBtn.waitFor({ timeout: 15000 }).catch(() => {});
      }
    }
    const final = await tick().then((r) => r.json()).catch(() => null);
    if (!final || final.paused === true) console.error("\n  ⚠ ПЛАНИРОВЩИК ОСТАЛСЯ НА ПАУЗЕ — снимите паузу в /admin/settings\n");
  }
  const after = await (await tick()).json();
  check("после снятия паузы тик снова работает", after.paused !== true && after.failed.length === 0);

  finish("Планировщик");
});
