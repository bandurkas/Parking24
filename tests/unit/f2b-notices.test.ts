import { test } from "node:test";
import assert from "node:assert/strict";
import {
  overstayCloseWhere, overstayFeedText, overstayKey, overstayNoticeText, planOverstay, unpaidCheckoutKey, unpaidCheckoutText,
} from "@/lib/overstay";
import { SCAN_REGISTRY, isScanCode } from "@/server/automations/scan-registry";
import { notifyOpts } from "@/server/lib/notify-opts";
import { isScanMode, parseModes, runTickWith, withScanMode, ErrorLog, type Locked, type TickDeps } from "@/server/automations/tick-core";

const row = (id: string, dateTo: string) => ({ id, dateTo });

test("overstayKey: бронь и дата выезда; после продления — новый ключ", () => {
  assert.equal(overstayKey("b1", "2026-09-25"), "overstay:b1:2026-09-25");
  assert.notEqual(overstayKey("b1", "2026-09-25"), overstayKey("b1", "2026-09-30"));
  assert.equal(unpaidCheckoutKey("b1", "2026-09-25"), "unpaid-out:b1:2026-09-25");
  // Повторный выезд в тот же день — тот же ключ; после ещё одних суток (дата выезда перенесена начислением) — новый
  assert.notEqual(unpaidCheckoutKey("b1", "2026-09-25"), unpaidCheckoutKey("b1", "2026-09-26"));
});

test("notifyOpts: четвёртый аргумент notify — транзакция (прежняя форма) или { tx, key }", () => {
  const tx = { adminNotice: {} };
  assert.deepEqual(notifyOpts(tx), { tx });
  assert.deepEqual(notifyOpts({ tx, key: "k" }), { tx, key: "k" });
  assert.deepEqual(notifyOpts<typeof tx>({ key: "k" }), { key: "k" });
  assert.deepEqual(notifyOpts(undefined), {});
});

test("planOverstay: уведомлённые пропускаются, новые — все", () => {
  const rows = [row("a", "2026-09-20"), row("b", "2026-09-21"), row("c", "2026-09-22")];
  assert.deepEqual(planOverstay(rows, [overstayKey("b", "2026-09-21")]).map((r) => r.id), ["a", "c"]);
  assert.deepEqual(planOverstay(rows, []).map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(planOverstay([], []), []);
});

test("planOverstay: уведомление по старой дате выезда не гасит новый перестой после продления", () => {
  assert.deepEqual(planOverstay([row("a", "2026-09-25")], [overstayKey("a", "2026-09-20")]).map((r) => r.id), ["a"]);
});

test("planOverstay: старые по дате выезда первыми, не больше лимита — остальные в следующем тике", () => {
  const rows = [row("x", "2026-09-22"), row("y", "2026-09-10"), row("z", "2026-09-15"), row("w", "2026-09-10")];
  assert.deepEqual(planOverstay(rows, [], 3).map((r) => r.id), ["w", "y", "z"]);
  const first = planOverstay(rows, [], 2);
  const next = planOverstay(rows, first.map((r) => overstayKey(r.id, r.dateTo)), 2);
  assert.deepEqual([...first, ...next].map((r) => r.id).sort(), ["w", "x", "y", "z"]);
});

test("overstayCloseWhere: только вид OVERSTAY; при пустом списке notIn не ставится", () => {
  assert.deepEqual(overstayCloseWhere([]), { kind: "OVERSTAY", readAt: null });
  assert.deepEqual(overstayCloseWhere(["overstay:a:2026-09-20"]), { kind: "OVERSTAY", readAt: null, dedupKey: { notIn: ["overstay:a:2026-09-20"] } });
});

test("тексты: уведомление, лента, «выехала, не оплачено»", () => {
  assert.equal(
    overstayNoticeText({ number: 12, plate: "А123ВС777", dateTo: "2026-09-25" }),
    "Перестой: бронь №12, А123ВС777 — выезд был 25 сент., машина на парковке. Выясните причину и освободите место",
  );
  assert.equal(overstayNoticeText({ number: 5, plate: null, dateTo: "2026-09-30" }), "Перестой: бронь №5 — выезд был 30 сент., машина на парковке. Выясните причину и освободите место");
  assert.equal(overstayFeedText("2026-09-30"), "Перестой с 1 окт.: машина на парковке после даты выезда. Уведомлён администратор");
  const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
  assert.equal(nb(unpaidCheckoutText({ kind: "PARKING", number: 12, plate: "А123ВС777" }, 1050)), "Машина выехала, не оплачено 1 050 ₽ — бронь №12, А123ВС777");
  assert.equal(unpaidCheckoutText({ kind: "ROOM", number: 3, plate: null }, 500), "Выезд, не оплачено 500 ₽ — бронь №3");
});

test("withScanMode: меняет только свой ключ, чужие режимы и посторонние значения не трогает", () => {
  assert.deepEqual(withScanMode({ overstay: "dry", sender: "on" }, "overstay", "on"), { overstay: "on", sender: "on" });
  assert.deepEqual(withScanMode({ sender: "dry", note: 1 }, "overstay", "off"), { sender: "dry", note: 1, overstay: "off" });
  for (const v of [null, undefined, "x", 5, ["on"]]) assert.deepEqual(withScanMode(v, "overstay", "dry"), { overstay: "dry" });
  assert.deepEqual(parseModes(withScanMode({ sender: "on" }, "overstay", "dry")), { sender: "on", overstay: "dry" });
});

test("isScanMode / isScanCode: неизвестные коды и режимы отклоняются", () => {
  for (const m of ["off", "dry", "on"]) assert.equal(isScanMode(m), true);
  for (const m of ["", "ON", "true", null, 1]) assert.equal(isScanMode(m), false);
  assert.equal(isScanCode("overstay"), true);
  for (const c of ["", "Overstay", "__proto__", "sender-x", null]) assert.equal(isScanCode(c), false);
});

test("реестр сканов: коды уникальны, подписи не пустые", () => {
  const codes = SCAN_REGISTRY.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const s of SCAN_REGISTRY) assert.ok(s.label.trim().length > 0, s.code);
});

test("тик с несколькими сканами: у каждого свой режим, «пробно» откатывается, «выкл» не запускается", async () => {
  const ran: string[] = [];
  const rollbacks: boolean[] = [];
  const d: TickDeps<object> = {
    scans: ["overstay", "b", "c"].map((code) => ({ code, run: async () => { ran.push(code); return 2; } })),
    loadConfig: async () => ({ paused: false, modes: { overstay: "dry", b: "on" } }),
    withLock: async <T,>(fn: (tx: object) => Promise<T>, opts: { rollback: boolean }): Promise<Locked<T>> => {
      rollbacks.push(opts.rollback);
      return { locked: true, value: await fn({}) };
    },
    writePulse: async () => {},
    now: () => new Date("2026-09-24T10:00:00Z"),
    state: { running: false },
    log: new ErrorLog(() => {}),
  };
  const r = await runTickWith("http", d);
  assert.deepEqual(ran, ["overstay", "b"]);
  assert.deepEqual(r.dry, { overstay: 2 });
  assert.deepEqual(r.done, { b: 2 });
  assert.deepEqual(rollbacks, [true, false, false]); // два скана + пульс
});
