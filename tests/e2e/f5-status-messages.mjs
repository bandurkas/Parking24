// Ф5 «Сообщения по статусам и номер договора» (docs/phases/PHASE_05_STATUS_MESSAGES.md, раздел «Код»).
// Отказ двух видов с разными текстами (кнопки «Отклонить» и «Мест нет», автоотказ с сайта); «Подтвердить место» снимает
// неотправленный отказ; «Заехал» — номер договора в карточке и в тексте, повторный заезд после «Исправить статус» номера
// не меняет, два одновременных заезда — разные номера, у комнаты номера нет; «Выехал» — «спасибо» через 2 часа;
// подтверждение по-прежнему одно на бронь.
// Проверяется очередь Outbox (собранный текст, статус, время), не отправка: планировщик в e2e не запускается.
// Правила Ф5 приезжают выключенными — сценарий включает их в базе и возвращает как было. На stage без базы —
// только страница «Автоматизации». Запуск: node tests/e2e/f5-status-messages.mjs --base http://localhost:3111 --login owner --password owner12345
import { BASE, LOGIN, PASSWORD, HEADED, loadPlaywright, check, equal, finish, testPhone, testPlate, isoPlus, moscowPlus, fillReliably } from "./lib.mjs";
import { LOCAL, db, live, setSender, snapshotGate } from "./autoconfirm-fixture.mjs";

const F5 = ["on_rejected_no_space", "on_rejected_other", "on_checked_in", "on_checked_out"];
const nb = (s) => (s ?? "").replace(/[  ]/g, " ");
const tag = String(Date.now()).slice(-4);
const net = 20 + Math.floor(Math.random() * 200);
let seq = 0;
const freshIp = () => `10.${net}.${150 + Math.floor(seq / 250)}.${(++seq % 250) + 1}`;
const why = (ok, detail) => (ok ? "" : detail); // длинный текст сообщения — только при провале
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(250);
  }
  return null;
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: !HEADED });

async function session() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [ошибка страницы] ${e.message}`));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? `e2e Ф5 ${tag}` : undefined).catch(() => {}));
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="login"]', LOGIN);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }), page.click('button[type="submit"]')]);
  return { ctx, page };
}

const chip = async (page) => nb(await page.locator("section.adm-card span.rounded-full.ring-inset").first().innerText().catch(() => "")).trim();
async function waitStatus(page, label, ms = 15000) {
  return !!(await until(async () => (await chip(page)) === label || null, ms));
}
async function open(page, id) {
  await page.goto(`${BASE}/admin/bookings/${id}?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
}
async function press(page, name, status) {
  await (await live(page.getByRole("button", { name, exact: true }))).click();
  return waitStatus(page, status);
}
// Запись очереди в карточке: код правила → строка статуса
async function cardOutbox(page, code) {
  const item = page.getByTestId("outbox-item").filter({ has: page.getByTestId("outbox-code").getByText(code, { exact: true }) });
  return (await item.count()) ? nb(await item.first().getByTestId("outbox-status").innerText()).trim() : null;
}
const outbox = (bookingId) => db().outbox.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });

// Бронь парковки прямо в базе (создание не проверяется здесь), телефон +7999… и госномер Т000… — их убирает cleanup
async function makeBooking({ status = "NEW", from = 30, to = 32, kind = "PARKING", paid = false } = {}) {
  const board = await db().board.findUniqueOrThrow({ where: { kind } });
  const phone = `+7${testPhone()}`;
  const client = await db().client.create({ data: { phone, name: `E2E Ф5 ${tag}`, firstSource: "CALL", messenger: "TELEGRAM", channels: ["TELEGRAM"] } });
  const days = to - from;
  const amount = kind === "PARKING" ? 350 * days : 2500 * days;
  const dateFrom = new Date(`${moscowPlus(from)}T00:00:00Z`);
  const dateTo = new Date(`${moscowPlus(to)}T00:00:00Z`);
  return db().booking.create({
    data: {
      boardId: board.id, kind, status, clientId: client.id, contactPhone: phone, contactName: client.name,
      vehicleType: kind === "PARKING" ? "CAR" : null, plate: kind === "PARKING" ? testPlate() : null, roomType: kind === "ROOM" ? "twin" : null,
      dateFrom, dateTo, days, amount, paidAmount: paid ? amount : 0, source: "CALL", confirmedAt: status === "CONFIRMED" ? new Date() : null,
    },
  });
}
const maxContract = async () => (await db().booking.aggregate({ _max: { contractNumber: true } }))._max.contractNumber ?? 0;
const pad = (n) => String(n).padStart(3, "0");

let restoreGate = null;
let saved = [];
try {
  console.log(`\nФ5 «Сообщения по статусам»: ${BASE}${LOCAL ? "" : " (без базы — только «Автоматизации»)"}`);
  const { page } = await session();

  // 0. Страница «Автоматизации»: четыре правила Ф5 на месте, скидочные выключены решением
  await page.goto(`${BASE}/admin/settings/automations?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  if (!page.url().includes("/settings/automations")) {
    console.log("  Пропуск: нужен вход владельцем (--login owner --password …)");
    await browser.close();
    finish("Ф5 «Сообщения по статусам»");
  }
  for (const code of F5) check(`«Автоматизации»: правило ${code} есть`, (await page.locator(`li[data-rule="${code}"]`).count()) === 1);
  check("«Когда срабатывает» у «мест нет» — «причина — нет мест»", nb(await page.locator('li[data-rule="on_rejected_no_space"]').innerText()).includes("Бронь переходит в «Отклонена», причина — нет мест"));
  check("«Когда срабатывает» у «спасибо» — «сообщение через 2 часа»", nb(await page.locator('li[data-rule="on_checked_out"]').innerText()).includes("Бронь переходит в «Выехал», сообщение через 2 часа"));
  for (const code of ["before_checkout_2d", "after_checkout_7d"]) {
    equal(`скидка 10 %: ${code} выключено`, await page.locator(`li[data-rule="${code}"] [role="switch"]`).getAttribute("aria-checked"), "false");
  }

  if (!LOCAL) {
    console.log("  Пропуск: остальные проверки меняют базу — только локально");
  } else {
    const rules = await db().automationRule.findMany({ where: { code: { in: F5 } } });
    equal("в базе четыре правила Ф5", rules.length, 4);
    equal("«Заехал» и «Выехал» — только парковка, отказы — любые", rules.map((r) => `${r.code}:${r.kind ?? "-"}`).sort().join(" "), "on_checked_in:PARKING on_checked_out:PARKING on_rejected_no_space:- on_rejected_other:-");
    saved = rules.map((r) => ({ code: r.code, isActive: r.isActive, editedAt: r.editedAt, editedById: r.editedById }));
    await db().automationRule.updateMany({ where: { code: { in: F5 } }, data: { isActive: true } });
    const review = ((await db().setting.findUnique({ where: { key: "links.review" } }))?.value ?? "").toString().trim();

    // 1. «Отклонить» — общий текст отказа, без слов про места
    const a = await makeBooking();
    await open(page, a.id);
    check("А: «Отклонить» → «Отклонена»", await press(page, "Отклонить", "Отклонена"));
    let rows = await outbox(a.id);
    equal("А: в очереди один отказ — on_rejected_other", rows.map((o) => o.templateCode).join(","), "on_rejected_other");
    equal("А: вид отказа в брони — OTHER", (await db().booking.findUnique({ where: { id: a.id } })).rejectKind, "OTHER");
    const ta = rows[0]?.renderedText ?? "";
    const okA = ta.includes(`К сожалению, ваша заявка № ${a.number} отклонена.`) && !/мест/.test(ta);
    check("А: текст «ваша заявка № N отклонена», без «мест»", okA, why(okA, ta));
    check("А: в карточке запись on_rejected_other «запланировано …»", /^запланировано /.test((await cardOutbox(page, "on_rejected_other")) ?? ""));

    // 2. «Мест нет» — текст «мест нет» с номером и датами; отметка NO_SPACE (сегмент Ф8)
    const b = await makeBooking();
    await open(page, b.id);
    check("Б: «Мест нет» → «Отклонена»", await press(page, "Мест нет", "Отклонена"));
    rows = await outbox(b.id);
    equal("Б: в очереди один отказ — on_rejected_no_space", rows.map((o) => o.templateCode).join(","), "on_rejected_no_space");
    equal("Б: вид отказа в брони — NO_SPACE", (await db().booking.findUnique({ where: { id: b.id } })).rejectKind, "NO_SPACE");
    const tb = rows[0]?.renderedText ?? "";
    const okB = tb.includes("на выбранные даты свободных мест нет") && tb.includes(`Заявка № ${b.number}`) && /\nДаты: .+ → .+\n/.test(tb) && !tb.includes("{{");
    check("Б: текст «свободных мест нет», «Заявка № N», «Даты:», без {{", okB, why(okB, tb));
    equal("Б: ключ записи — rejection:<id>", rows[0]?.dedupKey, `rejection:${b.id}`);

    // 3. Автоотказ с сайта (порог 0) → «мест нет»; «Подтвердить место» снимает отказ, встаёт «место забронировано»
    restoreGate = await snapshotGate();
    await setSender(true);
    await db().setting.upsert({ where: { key: "parking.autoConfirm" }, update: { value: true }, create: { key: "parking.autoConfirm", value: true } });
    await db().setting.upsert({ where: { key: "parking.autoConfirmLimit" }, update: { value: 0 }, create: { key: "parking.autoConfirmLimit", value: 0 } });
    const far = 300 + Math.floor(Math.random() * 60);
    const res = await fetch(`${BASE}/api/public/lead`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": freshIp() },
      body: JSON.stringify({ vehicleType: "car", dial: "+7", channels: ["TELEGRAM"], primary: "TELEGRAM", website: "", name: `E2E Ф5 ${tag}`, phone: testPhone(), dateFrom: isoPlus(far), dateTo: isoPlus(far + 2) }),
    }).then((r) => r.json()).catch((e) => ({ error: e.message }));
    await db().setting.update({ where: { key: "parking.autoConfirm" }, data: { value: false } });
    equal("В: заявка с сайта при пороге 0 — отклонена автоматически", res.state, "rejected");
    const c = res.number ? await db().booking.findUnique({ where: { number: res.number } }) : null;
    if (c) {
      rows = await outbox(c.id);
      equal("В: автоотказ — один отказ on_rejected_no_space", rows.map((o) => o.templateCode).join(","), "on_rejected_no_space");
      check("В: текст «свободных мест нет»", (rows[0]?.renderedText ?? "").includes("на выбранные даты свободных мест нет"));
      await open(page, c.id);
      check("В: «Подтвердить место» → «Ожидает оплаты»", await press(page, "Подтвердить место", "Ожидает оплаты"));
      rows = await outbox(c.id);
      equal("В: отказ отменён, подтверждение в очереди", rows.map((o) => `${o.templateCode}:${o.status}`).join(","), "on_rejected_no_space:CANCELLED,on_awaiting_payment:PENDING");
      check("В: в карточке отказ «отменено»", (await until(async () => (await cardOutbox(page, "on_rejected_no_space")) === "отменено" || null)) !== null);
      check("В: в карточке подтверждение «запланировано …»", /^запланировано /.test((await cardOutbox(page, "on_awaiting_payment")) ?? ""));
      check("В: текст подтверждения — «Ваше место забронировано»", (rows[1]?.renderedText ?? "").includes("Ваше место забронировано."));
    }

    // 4. «Заехал» — номер договора MAX+1 в карточке, в тексте и в журнале
    const d = await makeBooking({ status: "CONFIRMED", from: 0, to: 3, paid: true });
    const before = await maxContract();
    await open(page, d.id);
    check("Г: «Заехал» → «Заехал»", await press(page, "Заехал", "Заехал"));
    let dRow = await db().booking.findUnique({ where: { id: d.id } });
    equal("Г: номер договора = прежний максимум + 1", dRow.contractNumber, before + 1);
    const num = pad(dRow.contractNumber);
    check("Г: в шапке карточки «№<договор>»", (await until(async () => nb(await page.getByTestId("contract-number").innerText()) === `№${num}` || null)) !== null);
    rows = await outbox(d.id);
    equal("Г: в очереди «автомобиль принят» (on_checked_in)", rows.map((o) => o.templateCode).join(","), "on_checked_in");
    const td = rows[0]?.renderedText ?? "";
    const okD = td.includes(`\nБронь № ${d.number}\nДоговор № ${num}\n`) && /\nПринят: \d{1,2} [а-я]+, \d{2}:\d{2}\n/.test(td);
    check("Г: в тексте номер брони, «Договор № <номер>» и время приёмки", okD, why(okD, td));
    const aud = await db().auditLog.findFirst({ where: { entityId: d.id, action: "STATUS_CHANGE" }, orderBy: { createdAt: "desc" } });
    equal("Г: журнал перехода хранит номер договора", aud?.diff?.contract, dRow.contractNumber);

    // 5. «Исправить статус» назад и повторный «Заехал» — номер тот же, запись в очереди одна
    const form = page.locator("form", { has: page.getByLabel("Новый статус") });
    const openBtn = await live(page.getByRole("button", { name: /Исправить статус/ }));
    for (let i = 0; i < 4 && !(await form.isVisible().catch(() => false)); i++) { await openBtn.click().catch(() => {}); await form.waitFor({ timeout: 3000 }).catch(() => {}); }
    await form.getByLabel("Новый статус").selectOption({ label: "Подтверждена" });
    await fillReliably(form.getByLabel("Причина"), "e2e Ф5: заезд по ошибке");
    await form.getByRole("button", { name: "Исправить", exact: true }).click();
    check("Д: исправлено в «Подтверждена»", await waitStatus(page, "Подтверждена"));
    dRow = await db().booking.findUnique({ where: { id: d.id } });
    equal("Д: после исправления номер договора остался", dRow.contractNumber, before + 1);
    equal("Д: «автомобиль принят» снят исправлением", (await outbox(d.id)).map((o) => o.status).join(","), "CANCELLED");
    await open(page, d.id);
    check("Д: повторный «Заехал»", await press(page, "Заехал", "Заехал"));
    dRow = await db().booking.findUnique({ where: { id: d.id } });
    equal("Д: повторный заезд второго номера не выдал", dRow.contractNumber, before + 1);
    equal("Д: нумерация не сдвинулась", await maxContract(), before + 1);
    rows = await outbox(d.id);
    equal("Д: «автомобиль принят» — одна запись, снова в очереди, с тем же номером", rows.map((o) => `${o.templateCode}:${o.status}:${o.renderedText.includes(`Договор № ${num}`)}`).join(","), "on_checked_in:PENDING:true");

    // 6. Два заезда одновременно из двух вкладок — разные номера подряд, оба заезда прошли
    const e1 = await makeBooking({ status: "CONFIRMED", from: 0, to: 2, paid: true });
    const e2 = await makeBooking({ status: "CONFIRMED", from: 0, to: 2, paid: true });
    const p2 = await page.context().newPage();
    await Promise.all([open(page, e1.id), open(p2, e2.id)]);
    const [b1, b2] = await Promise.all([live(page.getByRole("button", { name: "Заехал", exact: true })), live(p2.getByRole("button", { name: "Заехал", exact: true }))]);
    const base2 = await maxContract();
    await Promise.all([b1.click(), b2.click()]);
    check("Е: оба заезда прошли", (await waitStatus(page, "Заехал")) && (await waitStatus(p2, "Заехал")));
    const pair = (await db().booking.findMany({ where: { id: { in: [e1.id, e2.id] } } })).map((x) => x.contractNumber).sort((x, y) => x - y);
    equal("Е: номера разные и подряд", pair.join(","), `${base2 + 1},${base2 + 2}`);
    await p2.close();

    // 7. Комната отдыха: номера договора нет, «автомобиль принят» не уходит
    const r = await makeBooking({ status: "CONFIRMED", from: 0, to: 1, kind: "ROOM", paid: true });
    await open(page, r.id);
    check("Ж: комната — «Заехал»", await press(page, "Заехал", "Заехал"));
    equal("Ж: у комнаты номера договора нет", (await db().booking.findUnique({ where: { id: r.id } })).contractNumber, null);
    equal("Ж: у комнаты сообщения при заезде нет", (await outbox(r.id)).length, 0);
    equal("Ж: в карточке комнаты строки «Договор» нет", await page.getByTestId("contract-number").count(), 0);

    // 8. «Выехал» — «спасибо и отзыв» через 2 часа, в карточке «запланировано»
    await open(page, d.id);
    check("З: «Выехал» → «Выехал»", await press(page, "Выехал", "Выехал"));
    dRow = await db().booking.findUnique({ where: { id: d.id } });
    const thanks = (await outbox(d.id)).find((o) => o.templateCode === "on_checked_out");
    const lag = thanks && dRow.checkedOutAt ? (thanks.scheduledAt.getTime() - dRow.checkedOutAt.getTime()) / 60_000 : NaN;
    check("З: запланировано через 120 минут после выезда", Math.abs(lag - 120) < 1, `${lag} мин`);
    equal("З: запись ждёт — PENDING", thanks?.status, "PENDING");
    const tt = thanks?.renderedText ?? "";
    const okT = tt.includes("спасибо, что доверили нам автомобиль") && !tt.includes("{{") && (review ? tt.includes(review) : !/отзыв/.test(tt));
    check(`З: текст «спасибо, что доверили нам автомобиль»${review ? " со ссылкой на отзывы" : ", ссылки нет — строки про отзыв нет"}`, okT, why(okT, tt));
    check("З: в карточке «запланировано …»", /^запланировано /.test((await cardOutbox(page, "on_checked_out")) ?? ""));

    // 9. Подтверждение одно на бронь: «Подтвердить место» → «Подтвердить» → «Заехал»
    const g = await makeBooking({ from: 0, to: 2 });
    await open(page, g.id);
    check("И: «Подтвердить место»", await press(page, "Подтвердить место", "Ожидает оплаты"));
    check("И: «Подтвердить»", await press(page, "Подтвердить", "Подтверждена"));
    check("И: «Заехал»", await press(page, "Заехал", "Заехал"));
    rows = await outbox(g.id);
    equal("И: подтверждение одно (ключ confirmation), плюс «автомобиль принят»", rows.map((o) => `${o.dedupKey.split(":")[0]}:${o.templateCode}`).join(","), "confirmation:on_awaiting_payment,on_checked_in:on_checked_in");
  }
} catch (e) {
  console.error(`\nСбой сценария: ${e.message}`);
  check("сценарий дошёл до конца", false, e.message.split("\n")[0]);
} finally {
  for (const s of saved) await db().automationRule.update({ where: { code: s.code }, data: { isActive: s.isActive, editedAt: s.editedAt, editedById: s.editedById } }).catch(() => {});
  // Отправщик, автоподтверждение и порог — как были; заодно закрывает соединение с базой
  if (restoreGate) await restoreGate().catch(() => {});
  else if (LOCAL) await db().$disconnect().catch(() => {});
  await browser.close();
}
finish("Ф5 «Сообщения по статусам»");
