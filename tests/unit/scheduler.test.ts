import { test } from "node:test";
import assert from "node:assert/strict";
import { cronSecretOk } from "@/server/lib/cron-auth";
import {
  ErrorLog, heartbeatState, parseHeartbeat, parseModes, runTickWith, shouldStartScheduler,
  type Locked, type Scan, type ScanMode, type TickDeps, type TickResult,
} from "@/server/automations/tick-core";

type Tx = { id: string };

// Подставные зависимости тика: блокировка всегда берётся, если не сказано иное
function deps(over: Partial<TickDeps<Tx>> & { modes?: Record<string, ScanMode>; paused?: boolean; locked?: boolean } = {}) {
  const calls = { pulses: [] as TickResult[], rollbacks: [] as boolean[], printed: [] as string[] };
  const t0 = new Date("2026-09-22T10:00:00Z");
  const d: TickDeps<Tx> = {
    scans: [],
    loadConfig: async () => ({ paused: over.paused ?? false, modes: over.modes ?? {} }),
    withLock: async <T,>(fn: (tx: Tx) => Promise<T>, opts: { rollback: boolean }): Promise<Locked<T>> => {
      if (over.locked === false) return { locked: false };
      calls.rollbacks.push(opts.rollback);
      return { locked: true, value: await fn({ id: "tx" }) };
    },
    writePulse: async (_tx, r) => { calls.pulses.push({ ...r }); },
    now: () => t0,
    state: { running: false },
    log: new ErrorLog((line) => calls.printed.push(line)),
    ...over,
  };
  return { d, calls };
}

const scan = (code: string, run: Scan<Tx>["run"] = async () => 1): Scan<Tx> => ({ code, run });

test("cronSecretOk: пустой, короткий и чужой секрет не проходят, верный проходит", () => {
  const want = "a".repeat(32);
  assert.equal(cronSecretOk("x", undefined), false);
  assert.equal(cronSecretOk("короткий-секрет", "короткий-секрет"), false); // 15 символов < 16
  assert.equal(cronSecretOk(null, want), false);
  assert.equal(cronSecretOk("b".repeat(32), want), false);
  assert.equal(cronSecretOk("a".repeat(31), want), false); // другая длина не бросает
  assert.equal(cronSecretOk(want, want), true);
});

test("shouldStartScheduler: таймер только при RUN_SCHEDULER=1 и не при сборке", () => {
  assert.equal(shouldStartScheduler({ RUN_SCHEDULER: "1" }), true);
  for (const v of [undefined, "", "0", "true", " 1"]) assert.equal(shouldStartScheduler({ RUN_SCHEDULER: v }), false, String(v));
  assert.equal(shouldStartScheduler({ RUN_SCHEDULER: "1", NEXT_PHASE: "phase-production-build" }), false);
});

test("runTickWith: сбой одного скана не мешает остальным, тик не бросает", async () => {
  const { d, calls } = deps({
    modes: { a: "on", b: "on", c: "on" },
    scans: [scan("a", async () => { throw new Error("база"); }), scan("b", async () => 2), scan("c", async () => 3)],
  });
  const r = await runTickWith("timer", d);
  assert.deepEqual(r.failed, ["a"]);
  assert.deepEqual(r.done, { b: 2, c: 3 });
  assert.equal(r.ok, false);
  assert.equal(calls.pulses.length, 1, "пульс пишется и при сбое скана");
  assert.equal(calls.printed.length, 1);
});

test("runTickWith: второй тик во время первого отвечает busy, сканы и пульс не трогает", async () => {
  let release!: () => void;
  const gate = new Promise<void>((ok) => (release = ok));
  let runs = 0;
  const { d, calls } = deps({ modes: { slow: "on" }, scans: [scan("slow", async () => { runs++; await gate; return 1; })] });
  const first = runTickWith("timer", d);
  const second = await runTickWith("http", d);
  assert.equal(second.busy, true);
  assert.equal(runs, 1);
  release();
  const r = await first;
  assert.deepEqual(r.done, { slow: 1 });
  assert.equal(calls.pulses.length, 1);
  assert.equal(d.state.running, false);
});

test("runTickWith: блокировку держит другой процесс — busy без пульса", async () => {
  const { d, calls } = deps({ locked: false, modes: { a: "on" }, scans: [scan("a")] });
  const r = await runTickWith("timer", d);
  assert.equal(r.busy, true);
  assert.equal(calls.pulses.length, 0);
});

test("runTickWith: режимы «выкл», «пробно», «вкл»", async () => {
  const seen: string[] = [];
  const { d, calls } = deps({
    modes: { dryOne: "dry", onOne: "on" },
    scans: [scan("offOne", async () => { seen.push("off"); return 1; }), scan("dryOne", async () => 5), scan("onOne", async () => 7)],
  });
  const r = await runTickWith("timer", d);
  assert.deepEqual(seen, [], "скан без режима считается выключенным");
  assert.deepEqual(r.dry, { dryOne: 5 });
  assert.deepEqual(r.done, { onOne: 7 });
  assert.deepEqual(calls.rollbacks, [true, false, false], "пробный скан просит откат, рабочий и пульс — нет");
});

test("runTickWith: пауза не запускает сканы, но пульс пишет с отметкой", async () => {
  let ran = false;
  const { d, calls } = deps({ paused: true, modes: { a: "on" }, scans: [scan("a", async () => { ran = true; return 1; })] });
  const r = await runTickWith("timer", d);
  assert.equal(ran, false);
  assert.equal(r.paused, true);
  assert.equal(calls.pulses[0]?.paused, true);
});

test("runTickWith: база недоступна — failed config, без пульса и без исключения", async () => {
  const { d, calls } = deps({ loadConfig: async () => { throw new Error("ECONNREFUSED"); } });
  const r = await runTickWith("timer", d);
  assert.deepEqual(r.failed, ["config"]);
  assert.equal(calls.pulses.length, 0);
  assert.equal(d.state.running, false);
});

test("runTickWith: сбой записи пульса попадает в failed", async () => {
  const { d } = deps({ writePulse: async () => { throw new Error("timeout"); } });
  const r = await runTickWith("timer", d);
  assert.deepEqual(r.failed, ["pulse"]);
  assert.equal(r.ok, false);
});

test("ErrorLog: первая ошибка печатается, повторы молчат, восстановление — одной строкой", () => {
  const lines: string[] = [];
  const log = new ErrorLog((line) => lines.push(line));
  log.ok("a");
  log.error("a", new Error("x"));
  log.error("a", new Error("x"));
  log.error("a", new Error("x"));
  assert.equal(lines.length, 1);
  log.ok("a");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /снова работает, повторов ошибки 2/);
  log.ok("a");
  assert.equal(lines.length, 2);
});

test("parseHeartbeat и parseModes: мусор вместо JSON — как отсутствие", () => {
  assert.equal(parseHeartbeat(null), null);
  assert.equal(parseHeartbeat("строка"), null);
  assert.equal(parseHeartbeat({ at: "не дата" }), null);
  const hb = parseHeartbeat({ at: "2026-09-22T10:00:00Z", source: "http", failed: ["a", 1], done: { a: 1, b: "x" }, paused: true });
  assert.equal(hb?.source, "http");
  assert.deepEqual(hb?.failed, ["a"]);
  assert.deepEqual(hb?.done, { a: 1 });
  assert.equal(hb?.paused, true);
  assert.deepEqual(parseModes({ a: "on", b: "dry", c: "yes", d: 1 }), { a: "on", b: "dry" });
  assert.deepEqual(parseModes("x"), {});
});

test("heartbeatState: выключен, не запускался, отстаёт, на паузе, работает", () => {
  const now = new Date("2026-09-22T10:10:00Z");
  const fresh = parseHeartbeat({ at: "2026-09-22T10:09:10Z" });
  const stale = parseHeartbeat({ at: "2026-09-22T10:00:00Z" });
  const pausedHb = parseHeartbeat({ at: "2026-09-22T10:09:30Z", paused: true });
  assert.equal(heartbeatState(fresh, now, false).kind, "off");
  assert.equal(heartbeatState(null, now, true).kind, "never");
  const late = heartbeatState(stale, now, true);
  assert.equal(late.kind, "late");
  assert.equal(late.kind === "late" && late.ageMin, 10);
  assert.equal(heartbeatState(pausedHb, now, true).kind, "paused");
  assert.equal(heartbeatState(fresh, now, true).kind, "ok");
  // ровно 3 минуты — ещё «работает», больше — «отстаёт»
  assert.equal(heartbeatState(parseHeartbeat({ at: "2026-09-22T10:07:00Z" }), now, true).kind, "ok");
  assert.equal(heartbeatState(parseHeartbeat({ at: "2026-09-22T10:06:59Z" }), now, true).kind, "late");
});
