// МФ-1 «Автоподтверждение: надёжность и предохранитель» (docs/phases/PHASE_MF1_AUTOCONFIRM.md).
// Предохранитель не даёт включить автоподтверждение и объясняет почему; сервер перепроверяет устаревшую форму;
// сохранение ёмкости не трогает выключатель; гонка двух заявок на последнее место; отказ «нечем отправить»;
// дубль заявки под блокировкой (и при выключенном автоподтверждении); цена 0; уведомление об автоотказе в той же
// транзакции, что и бронь; наплыв без 500; антибот и спешащие часы; «Вернуть ручной режим» и журнал.
// Заявки — прямыми POST с отдельным X-Forwarded-For (у каждого адреса свой лимит 8 за 10 минут, форму на сайте
// проверяют site-lead.mjs и autoconfirm.mjs). Состояние базы — только локально; на stage — только предохранитель.
// Запуск: node tests/e2e/mf1-autoconfirm.mjs --base http://localhost:3111 --login owner --password owner12345
import { BASE, withBrowser, adminLogin, check, equal, finish, testPhone, isoPlus, fillReliably } from "./lib.mjs";
import { LOCAL, db, live, openGate, setRejectRule, setSender, snapshotGate } from "./autoconfirm-fixture.mjs";

const net = 20 + Math.floor(Math.random() * 200);
let seq = 0;
function freshIp() {
  seq += 1;
  return `10.${net}.${Math.floor(seq / 250)}.${(seq % 250) + 1}`;
}

// Отдельные дальние даты на каждый сценарий: чужие брони и прошлые прогоны не мешают
const base = 250 + Math.floor(Math.random() * 90);
const span = (k) => ({ dateFrom: isoPlus(base + k * 3), dateTo: isoPlus(base + k * 3 + 1) });

async function postLead(body, { ip = freshIp(), ts } = {}) {
  const res = await fetch(`${BASE}/api/public/lead`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ vehicleType: "car", name: "E2E МФ-1", dial: "+7", channels: ["TELEGRAM"], primary: "TELEGRAM", website: "", ...body, ...(ts === undefined ? {} : { ts }) }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, ...(json ?? {}) };
}

const phoneOf = (digits) => `+7${digits}`;

function capacityUrl() {
  return `${BASE}/admin/settings/capacity?t=${Date.now()}`;
}

async function stateText(page) {
  return ((await page.getByTestId("autoconfirm-state").textContent()) ?? "").trim();
}

async function openPanel(page) {
  await page.goto(capacityUrl(), { waitUntil: "domcontentloaded" });
  await (await live(page.getByRole("button", { name: "Включить…" }))).click();
  await live(page.getByRole("checkbox", { name: /Понимаю/ }));
}

async function setLimit(page, limit) {
  await page.goto(capacityUrl(), { waitUntil: "domcontentloaded" });
  if (!(await fillReliably(page.getByLabel("Порог автоподтверждения"), String(limit)))) throw new Error("не удалось задать порог");
  await (await live(page.getByRole("button", { name: /Сохранить/ }))).click();
  await page.getByText("Сохранено").waitFor({ timeout: 10000 });
}

// Пик занятости пула на датах — по сетке /admin/occupancy (подсказка «Занято N из M»), как в autoconfirm.mjs
async function poolBusy(page, from) {
  await page.goto(`${BASE}/admin/occupancy?from=${from}&t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  const cells = page.locator("tr", { hasText: "Всего в пуле" }).locator("td[title]");
  const titles = [await cells.nth(0).getAttribute("title"), await cells.nth(1).getAttribute("title")];
  const busy = titles.map((t) => Number(t?.match(/Занято (\d+)/)?.[1] ?? NaN));
  if (busy.some(Number.isNaN)) throw new Error(`не удалось прочитать занятость пула: ${titles.join(" | ")}`);
  return Math.max(...busy);
}

async function bookingByNumber(number) {
  return db().booking.findUnique({ where: { number }, include: { notices: true, outbox: true, interactions: true } });
}

await withBrowser(async (page) => {
  console.log(`\nМФ-1 автоподтверждение: ${BASE}${LOCAL ? "" : " (без базы — только предохранитель)"}`);
  await adminLogin(page);
  await page.goto(capacityUrl(), { waitUntil: "domcontentloaded" });
  if (!page.url().includes("/settings/capacity")) {
    console.log("  Пропуск: нужен вход владельцем (--login owner --password …)");
    return finish("МФ-1 автоподтверждение");
  }

  // 1. В форме ёмкости выключателя нет, панель отдельно
  equal("в форме ёмкости галочки автоподтверждения нет", await page.locator('form input[type="checkbox"]').count(), 0);
  check("панель автоподтверждения отдельно от ёмкости", await page.getByRole("region", { name: "Автоподтверждение" }).isVisible());

  if (!LOCAL) {
    if (/выключено/.test(await stateText(page))) {
      await (await live(page.getByRole("button", { name: "Включить…" }))).click();
      await page.getByText("Понимаю: отказ клиенту уходит автоматически").click();
      const blocked = await page.locator('[data-check][data-ok="0"]').count();
      if (blocked) check("предохранитель: кнопка «Включить автоподтверждение» неактивна", await page.getByRole("button", { name: "Включить автоподтверждение" }).isDisabled());
      check("панель объясняет последствия: отменить отказ нельзя", await page.getByText("Отправленное сообщение отменить нельзя").isVisible());
    }
    console.log("  Пропуск: остальные проверки меняют базу — только локально");
    return finish("МФ-1 автоподтверждение");
  }

  const restore = await snapshotGate();
  const tariffsOff = [];
  const phones = [];
  try {
    await db().setting.upsert({ where: { key: "parking.autoConfirm" }, update: { value: false }, create: { key: "parking.autoConfirm", value: false } });
    const savedLimit = Number(await page.getByLabel("Порог автоподтверждения").inputValue());

    // 2. Предохранитель закрыт: нет отправщика и правила отказа
    await setSender(null);
    await setRejectRule(false);
    await openPanel(page);
    check("выключено: «Каждую заявку с сайта подтверждает администратор»", await page.getByText("Каждую заявку с сайта подтверждает администратор").isVisible());
    check("пять последствий, в т.ч. «Отправленное сообщение отменить нельзя»", (await page.getByRole("region", { name: "Автоподтверждение" }).locator("ol li").count()) === 5 && (await page.getByText("Отправленное сообщение отменить нельзя").isVisible()));
    check("проверка «Отправщик сообщений включён» не пройдена, с подсказкой", (await page.locator('[data-check="sender"][data-ok="0"]').count()) === 1 && (await page.getByText("копятся в очереди").isVisible()));
    check("проверка «Клиенту есть чем ответить на отказ» не пройдена", (await page.locator('[data-check="reject_message"][data-ok="0"]').count()) === 1);
    check("проверка «Клиенту есть чем ответить на подтверждение» пройдена (правило из seed)", (await page.locator('[data-check="confirm_message"][data-ok="1"]').count()) === 1);
    await page.getByText("Понимаю: отказ клиенту уходит автоматически").click();
    check("с галочкой «Понимаю» кнопка всё равно неактивна", await page.getByRole("button", { name: "Включить автоподтверждение" }).isDisabled());
    check("панель говорит, почему: «Включить нельзя, пока не пройдены все проверки»", await page.getByText("Включить нельзя, пока не пройдены все проверки").isVisible());

    // 3. Предохранитель открыт: без «Понимаю» не включить; устаревшую форму сервер перепроверяет
    await openGate();
    await openPanel(page);
    equal("все проверки пройдены", await page.locator('[data-check][data-ok="0"]').count(), 0);
    const enable = page.getByRole("button", { name: "Включить автоподтверждение" });
    check("без галочки «Понимаю» кнопка неактивна", await enable.isDisabled());
    await page.getByText("Понимаю: отказ клиенту уходит автоматически").click();
    check("с галочкой — активна", await enable.isEnabled());
    await setSender(false); // за время, пока форма открыта, отправщик выключили
    await enable.click();
    const refused = page.getByText(/Включить нельзя, не пройдено: Отправщик сообщений включён/);
    check("сервер отказал по устаревшей форме", await refused.waitFor({ timeout: 10000 }).then(() => true, () => false));
    equal("в базе автоподтверждение осталось выключенным", (await db().setting.findUnique({ where: { key: "parking.autoConfirm" } }))?.value, false);

    // 4. Включение: состояние, порог и резерв, кто включил, журнал
    await setSender(true);
    await openPanel(page);
    await page.getByText("Понимаю: отказ клиенту уходит автоматически").click();
    await page.getByRole("button", { name: "Включить автоподтверждение" }).click();
    await page.getByTestId("autoconfirm-state").getByText(/включено/).waitFor({ timeout: 10000 });
    check("«Автоподтверждение включено. Порог N, резерв M мест»", /^Автоподтверждение включено\. Порог \d+, (резерв \d+ (место|места|мест)|резерва нет)$/.test(await stateText(page)), await stateText(page));
    check("«Включил <владелец>, <дата по Москве>»", /^Включил .+, \d{1,2} [а-я]+, \d{2}:\d{2}$/.test((await page.getByTestId("autoconfirm-changed").textContent()) ?? ""));
    check("кнопка «Вернуть ручной режим» видна", await page.getByRole("button", { name: "Вернуть ручной режим" }).isVisible());
    const owner = await db().user.findUnique({ where: { login: "owner" } });
    const onAudit = await db().auditLog.findFirst({ where: { entity: "Setting", entityId: "parking.autoConfirm", userId: owner?.id }, orderBy: { createdAt: "desc" } });
    equal("журнал: включение с автором", onAudit?.diff?.autoConfirm, true);

    // 5. Сохранение ёмкости не трогает выключатель
    await setLimit(page, savedLimit);
    check("после «Сохранить» ёмкости автоподтверждение по-прежнему включено", /включено/.test(await stateText(page)));
    equal("и в базе", (await db().setting.findUnique({ where: { key: "parking.autoConfirm" } }))?.value, true);

    // Прогрев маршрута: первый запрос в dev компилирует его, гонка должна идти на готовом
    await postLead({});

    // 6. Гонка двух заявок на последнее место
    const race = span(0);
    const busy = await poolBusy(page, race.dateFrom);
    await setLimit(page, busy + 1);
    const [pa, pb] = [testPhone(), testPhone()];
    phones.push(pa, pb);
    const both = await Promise.all([postLead({ ...race, phone: pa }), postLead({ ...race, phone: pb })]);
    const states = both.map((r) => r.state).sort();
    check("гонка: одна подтверждена, вторая отклонена", states.join(",") === "confirmed,rejected", `${states.join(",")} (занято ${busy}, порог ${busy + 1})`);
    const lost = both.find((r) => r.state === "rejected");
    const rej = lost ? await bookingByNumber(lost.number) : null;
    equal("отклонённая: статус «Отклонена», причина NO_SPACE", `${rej?.status}/${rej?.rejectKind}`, "REJECTED/NO_SPACE");
    equal("уведомление ровно одно", rej?.notices.length, 1);
    const text = rej?.notices[0]?.text ?? "";
    check("текст: «Заявка №N отклонена автоматически: на <даты по-русски> мест нет (занято N, порог M)»",
      new RegExp(`^Заявка №${lost?.number} отклонена автоматически: на \\d{1,2} [а-я]+ → \\d{1,2} [а-я]+ мест нет \\(занято ${busy + 1}, порог ${busy + 1}\\)$`).test(text), text);
    const [tx] = rej ? await db().$queryRaw`SELECT b.xmin::text AS b, n.xmin::text AS n FROM "Booking" b JOIN "AdminNotice" n ON n."bookingId" = b.id WHERE b.id = ${rej.id}` : [];
    check("уведомление записано той же транзакцией, что и бронь (xmin совпадает)", !!tx && tx.b === tx.n, tx ? `${tx.b} / ${tx.n}` : "нет строки");
    check("отказ клиенту поставлен в очередь (правило на «Отклонена»)", (rej?.outbox ?? []).some((o) => o.templateCode === "e2e_on_rejected_no_space"));
    await page.goto(`${BASE}/admin?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Уведомления/ }).click();
    check("колокольчик показывает уведомление", ((await page.locator("body").innerText()) ?? "").includes(`Заявка №${lost?.number} отклонена автоматически`));

    // 7. Мест нет, а отказать нечем (отправщик выключили после включения АП) — заявка остаётся администратору
    await setSender(false);
    const pc = testPhone();
    phones.push(pc);
    const third = await postLead({ ...race, phone: pc });
    equal("мест нет, отказ отправить нечем — «Заявка принята»", third.state, "pending");
    const nb = third.number ? await bookingByNumber(third.number) : null;
    check("бронь «Новая заявка» с пояснением в ленте, без уведомления",
      nb?.status === "NEW" && nb.notices.length === 0 && nb.interactions.some((i) => /отказ клиенту отправить нечем/.test(i.text ?? "")));
    await setSender(true);

    // 8. Двойной клик: три одинаковые заявки одновременно — одна бронь, одно сообщение
    await setLimit(page, savedLimit);
    const dupSpan = span(1);
    const pd = testPhone();
    phones.push(pd);
    const ipd = freshIp();
    const dups = await Promise.all([0, 1, 2].map(() => postLead({ ...dupSpan, phone: pd }, { ip: ipd })));
    equal("все три ответа «ок»", dups.filter((r) => r.ok).length, 3);
    equal("номер у всех один", new Set(dups.map((r) => r.number)).size, 1);
    equal("новой бронью ответила одна", dups.filter((r) => r.duplicate === false).length, 1);
    const dupRows = await db().booking.findMany({ where: { contactPhone: phoneOf(pd) }, include: { outbox: true } });
    equal("в базе одна бронь", dupRows.length, 1);
    equal("в очереди одно сообщение", dupRows[0]?.outbox.length, 1);

    // 9. Цена 0 (тариф не найден) — не подтверждается автоматически
    const moto = await db().tariff.findMany({ where: { kind: "PARKING", vehicleType: "MOTO", isActive: true } });
    tariffsOff.push(...moto.map((t) => t.id));
    await db().tariff.updateMany({ where: { id: { in: tariffsOff } }, data: { isActive: false } });
    const pz = testPhone();
    phones.push(pz);
    const zero = await postLead({ ...span(2), phone: pz, vehicleType: "moto" });
    equal("цена 0: «Заявка принята», не «Место забронировано»", zero.state, "pending");
    const zb = zero.number ? await bookingByNumber(zero.number) : null;
    check("бронь «Новая заявка», сумма 0, в ленте «Стоимость не рассчитана»", zb?.status === "NEW" && zb.amount === 0 && zb.interactions.some((i) => /Стоимость не рассчитана/.test(i.text ?? "")));
    await db().tariff.updateMany({ where: { id: { in: tariffsOff } }, data: { isActive: true } });
    tariffsOff.length = 0;

    // 10. Наплыв: 15 разных заявок одновременно — ни одного 5xx, все в базе
    const burstPhones = Array.from({ length: 15 }, () => testPhone());
    phones.push(...burstPhones);
    const burst = await Promise.all(burstPhones.map((p, i) => postLead({ dateFrom: isoPlus(base + 10 + (i % 5)), dateTo: isoPlus(base + 12 + (i % 5)), phone: p })));
    equal("наплыв: ответов 5xx нет", burst.filter((r) => r.status >= 500).length, 0);
    equal("наплыв: у всех номер заявки", burst.filter((r) => r.ok && r.number).length, 15);
    const burstRows = await db().booking.findMany({ where: { contactPhone: { in: burstPhones.map(phoneOf) } }, include: { interactions: true } });
    equal("наплыв: все 15 заявок в базе", burstRows.length, 15);
    const overload = burstRows.filter((b) => b.interactions.some((i) => /перегрузка/.test(i.text ?? ""))).length;
    console.log(`  наплыв: подтверждено ${burstRows.filter((b) => b.status === "AWAITING_PAYMENT").length}, «Новая заявка» по перегрузке ${overload}`);

    // 11. Антибот: спешащие часы не съедают заявку, честная быстрая отправка отсекается как раньше
    const pf = testPhone();
    phones.push(pf);
    const ahead = await postLead({ ...span(3), phone: pf }, { ts: Date.now() + 60 * 60_000 });
    check("часы браузера на час вперёд — заявка создана", ahead.ok === true && Number.isInteger(ahead.number), JSON.stringify(ahead).slice(0, 80));
    const pq = testPhone();
    const quick = await postLead({ ...span(4), phone: pq }, { ts: Date.now() - 300 });
    check("отправка через 300 мс — «ок» без заявки (антибот)", quick.ok === true && quick.number === undefined);
    equal("и в базе её нет", await db().booking.count({ where: { contactPhone: phoneOf(pq) } }), 0);

    // 12. «Вернуть ручной режим» — одним нажатием, в журнале с автором
    await page.goto(capacityUrl(), { waitUntil: "domcontentloaded" });
    await (await live(page.getByRole("button", { name: "Вернуть ручной режим" }))).click();
    await page.getByTestId("autoconfirm-state").getByText(/выключено/).waitFor({ timeout: 10000 });
    check("«Вернуть ручной режим» выключает сразу, без подтверждения", /выключено/.test(await stateText(page)));
    check("«Выключил <владелец>, <дата>»", /^Выключил /.test((await page.getByTestId("autoconfirm-changed").textContent()) ?? ""));
    const offAudit = await db().auditLog.findFirst({ where: { entity: "Setting", entityId: "parking.autoConfirm", userId: owner?.id }, orderBy: { createdAt: "desc" } });
    equal("журнал: выключение с автором", offAudit?.diff?.autoConfirm, false);
    const pm = testPhone();
    phones.push(pm);
    equal("с ручным режимом заявка ждёт администратора", (await postLead({ ...span(5), phone: pm })).state, "pending");

    // 13. Двойной клик при выключенном автоподтверждении — замок берётся всё равно
    const pd2 = testPhone();
    phones.push(pd2);
    const ip2 = freshIp();
    const dups2 = await Promise.all([0, 1].map(() => postLead({ ...span(6), phone: pd2 }, { ip: ip2 })));
    equal("выключено: две одинаковые заявки — один номер", new Set(dups2.map((r) => r.number)).size, 1);
    const dup2Rows = await db().booking.findMany({ where: { contactPhone: phoneOf(pd2) }, include: { outbox: true } });
    equal("выключено: в базе одна бронь и одно сообщение", `${dup2Rows.length}/${dup2Rows[0]?.outbox.length}`, "1/1");

    // 14. Инвариант: отклонённой «нет мест» брони без уведомления не бывает
    const orphan = await db().booking.count({ where: { contactPhone: { in: phones.map(phoneOf) }, status: "REJECTED", rejectKind: "NO_SPACE", notices: { none: {} } } });
    equal("броней «Отклонена · нет мест» без уведомления — 0", orphan, 0);
  } finally {
    if (tariffsOff.length) await db().tariff.updateMany({ where: { id: { in: tariffsOff } }, data: { isActive: true } });
    await restore();
    console.log("  настройки, правило отказа и выключатель отправщика возвращены");
  }

  finish("МФ-1 автоподтверждение");
});
