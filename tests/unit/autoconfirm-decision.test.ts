import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decisionComment,
  isTransientDbError,
  noSpaceDecision,
  preDecision,
  rejectNoticeKey,
  rejectNoticeText,
  withOverloadFallback,
  type AutoDecision,
  type LeadFacts,
} from "@/lib/autoconfirm-decision";
import { fmtRange } from "@/server/lib/dates";

const ok: LeadFacts = { autoConfirm: true, vehicleType: "CAR", phone: "+79990000000", amount: 700 };

test("preDecision: всё есть — решаем по занятости", () => {
  assert.equal(preDecision(ok), null);
});

test("preDecision: цена 0 или не число — администратору, не автоматически", () => {
  assert.deepEqual(preDecision({ ...ok, amount: 0 }), { status: "NEW", reason: "no_price" });
  assert.deepEqual(preDecision({ ...ok, amount: NaN }), { status: "NEW", reason: "no_price" });
  assert.deepEqual(preDecision({ ...ok, amount: -1 }), { status: "NEW", reason: "no_price" });
});

test("preDecision: выключено, фура, без типа, без телефона", () => {
  assert.equal(preDecision({ ...ok, autoConfirm: false })?.reason, "off");
  assert.equal(preDecision({ ...ok, vehicleType: "TRUCK", amount: 0 })?.reason, "truck");
  assert.equal(preDecision({ ...ok, vehicleType: null })?.reason, "manual");
  assert.equal(preDecision({ ...ok, phone: null })?.reason, "no_phone");
});

test("noSpaceDecision: отказать есть чем — «Отклонена», нечем — «Новая заявка» с числами", () => {
  assert.deepEqual(noSpaceDecision(396, 395, true), { status: "REJECTED", reason: "no_space", peak: 396, limit: 395 });
  assert.deepEqual(noSpaceDecision(396, 395, false), { status: "NEW", reason: "no_reject_message", peak: 396, limit: 395 });
});

test("decisionComment: у no_price, no_reject_message и overload тексты не пустые и разные", () => {
  const texts = (["no_price", "overload"] as const).map((reason) => decisionComment({ status: "NEW", reason }));
  texts.push(decisionComment(noSpaceDecision(396, 395, false)));
  for (const t of texts) assert.ok(t.length > 10, t);
  assert.equal(new Set(texts).size, 3);
  assert.match(texts[2], /занято 396, порог 395/);
});

test("decisionComment: «выключено» пояснения в ленте не даёт", () => {
  assert.equal(decisionComment({ status: "NEW", reason: "off" } as AutoDecision), "");
});

test("rejectNoticeText: даты по-русски, номер, занято и порог", () => {
  assert.equal(
    rejectNoticeText(41, fmtRange("2026-11-03", "2026-11-05"), 396, 395),
    "Заявка №41 отклонена автоматически: на 3 нояб → 5 нояб мест нет (занято 396, порог 395)",
  );
  assert.equal(rejectNoticeKey("abc"), "reject-no-space:abc");
});

test("isTransientDbError: пул, закрытая транзакция, конфликт записи — да; нет базы, уникальность, обычная ошибка — нет", () => {
  for (const code of ["P2024", "P2028", "P2034"]) assert.equal(isTransientDbError({ code }), true, code);
  for (const code of ["P1001", "P1002", "P1017", "P2002"]) assert.equal(isTransientDbError({ code }), false, code);
  assert.equal(isTransientDbError(new Error("P2024")), false);
  assert.equal(isTransientDbError(null), false);
  assert.equal(isTransientDbError("P2024"), false);
});

const transient = (code: string) => Object.assign(new Error(code), { code });

test("withOverloadFallback: без сбоя — одна попытка, без перегрузки", async () => {
  const calls: boolean[] = [];
  assert.equal(await withOverloadFallback(async (o) => (calls.push(o), "ok")), "ok");
  assert.deepEqual(calls, [false]);
});

test("withOverloadFallback: временная ошибка — ровно один повтор с перегрузкой", async () => {
  const calls: boolean[] = [];
  const seen: unknown[] = [];
  const r = await withOverloadFallback(async (o) => {
    calls.push(o);
    if (!o) throw transient("P2028");
    return "manual";
  }, (e) => seen.push(e));
  assert.equal(r, "manual");
  assert.deepEqual(calls, [false, true]);
  assert.equal(seen.length, 1);
});

test("withOverloadFallback: повтор тоже упал — ошибка наверх, третьей попытки нет", async () => {
  const calls: boolean[] = [];
  await assert.rejects(withOverloadFallback(async (o) => {
    calls.push(o);
    throw transient("P2024");
  }), { code: "P2024" });
  assert.deepEqual(calls, [false, true]);
});

test("withOverloadFallback: повтор заявки и ошибки правил не повторяются", async () => {
  class DuplicateLead extends Error {}
  for (const err of [new DuplicateLead("dup"), transient("P2002"), transient("P1001")]) {
    const calls: boolean[] = [];
    await assert.rejects(withOverloadFallback(async (o) => {
      calls.push(o);
      throw err;
    }), (e) => e === err);
    assert.deepEqual(calls, [false]);
  }
});

test("withOverloadFallback: повтор нашёл дубль — DuplicateLead проходит наверх", async () => {
  class DuplicateLead extends Error {}
  const dup = new DuplicateLead("dup");
  await assert.rejects(withOverloadFallback(async (o) => {
    throw o ? dup : transient("P2034");
  }), (e) => e === dup);
});
