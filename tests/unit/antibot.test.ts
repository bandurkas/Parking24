import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_FILL_MS, tooFast } from "@/lib/antibot";

const now = Date.UTC(2026, 8, 24, 12, 0, 0);

test("tooFast: метка в будущем (часы клиента спешат) — не бот", () => {
  assert.equal(tooFast(now, now + 60 * 60_000), false);
  assert.equal(tooFast(now, now + 1), false);
});

test("tooFast: метка старше 10 минут (часы отстают) — не бот", () => {
  assert.equal(tooFast(now, now - 11 * 60_000), false);
});

test("tooFast: честная метка, прошло 300 мс — слишком быстро", () => {
  assert.equal(tooFast(now, now - 300), true);
});

test("tooFast: прошло больше порога — не бот", () => {
  assert.equal(tooFast(now, now - MIN_FILL_MS), false);
  assert.equal(tooFast(now, now - 5_000), false);
});

test("tooFast: метки нет — не бот", () => {
  assert.equal(tooFast(now, undefined), false);
  assert.equal(tooFast(now, null), false);
  assert.equal(tooFast(now, 0), false);
});
