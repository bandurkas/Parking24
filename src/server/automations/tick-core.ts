// Ядро минутного тика без базы и без server-only: блокировка, настройки и запись пульса подставляются.
// Так логику тика покрывают юнит-тесты, а Prisma живёт в scheduler.ts. Архитектура: docs/phases/PHASE_01_SCHEDULER.md.

export type ScanMode = "off" | "dry" | "on";

// Строки в Setting. Здесь, а не в settings.ts: планировщик не должен тянуть основной клиент базы
export const SCHEDULER_KEYS = {
  heartbeat: "scheduler.heartbeat",
  paused: "scheduler.paused",
  scans: "scheduler.scans", // { код скана: "off" | "dry" | "on" }, по умолчанию «выкл»
} as const;

export function parseModes(value: unknown): Record<string, ScanMode> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([, m]) => m === "off" || m === "dry" || m === "on")) as Record<string, ScanMode>;
}

// Контракт скана: идемпотентный и «догоняющий», внутри транзакции только запись в базу, лимит объектов за вызов,
// время — из now, а не new Date(). Возвращает, сколько сделал.
export type Scan<Tx> = { code: string; run: (tx: Tx, now: Date) => Promise<number> };

export type TickSource = "timer" | "http";

export type TickResult = {
  at: string;
  source: TickSource;
  ok: boolean;
  busy?: true;
  paused?: true;
  ms: number;
  done: Record<string, number>;
  dry: Record<string, number>;
  failed: string[];
};

export type Locked<T> = { locked: false } | { locked: true; value: T };

export type TickDeps<Tx> = {
  scans: Scan<Tx>[];
  loadConfig: () => Promise<{ paused: boolean; modes: Record<string, ScanMode> }>;
  // rollback: выполнить и откатить транзакцию (режим «пробно»)
  withLock: <T>(fn: (tx: Tx) => Promise<T>, opts: { rollback: boolean }) => Promise<Locked<T>>;
  writePulse: (tx: Tx, result: TickResult) => Promise<void>;
  now: () => Date;
  state: { running: boolean };
  log: ErrorLog;
};

// Тик по контракту не бросает: всё, что может упасть, ловится и попадает в failed.
export async function runTickWith<Tx>(source: TickSource, d: TickDeps<Tx>): Promise<TickResult> {
  const started = d.now();
  const result: TickResult = { at: started.toISOString(), source, ok: true, ms: 0, done: {}, dry: {}, failed: [] };
  const finish = () => {
    result.ms = d.now().getTime() - started.getTime();
    result.ok = result.failed.length === 0;
    return result;
  };
  // Второй тик в процессе (таймер и HTTP одновременно) не ждёт первого и пульс не трогает
  if (d.state.running) return { ...finish(), busy: true };
  d.state.running = true;
  try {
    let config: Awaited<ReturnType<TickDeps<Tx>["loadConfig"]>>;
    try {
      config = await d.loadConfig();
      d.log.ok("config");
    } catch (e) {
      d.log.error("config", e);
      result.failed.push("config");
      return finish();
    }

    if (config.paused) result.paused = true;
    else {
      for (const scan of d.scans) {
        const mode = config.modes[scan.code] ?? "off";
        if (mode === "off") continue;
        try {
          const r = await d.withLock((tx) => scan.run(tx, started), { rollback: mode === "dry" });
          // Блокировку держит другой процесс — вся работа этого тика его
          if (!r.locked) return { ...finish(), busy: true };
          (mode === "dry" ? result.dry : result.done)[scan.code] = r.value;
          d.log.ok(scan.code);
        } catch (e) {
          result.failed.push(scan.code);
          d.log.error(scan.code, e);
        }
      }
    }

    // Пульс под той же блокировкой: «работает» значит «транзакция под блокировкой прошла»
    try {
      const snapshot = finish();
      const r = await d.withLock((tx) => d.writePulse(tx, snapshot), { rollback: false });
      if (!r.locked) return { ...finish(), busy: true };
      d.log.ok("pulse");
    } catch (e) {
      result.failed.push("pulse");
      d.log.error("pulse", e);
    }
    return finish();
  } finally {
    d.state.running = false;
  }
}

// Запуск таймера — только по строке "1": пусто, "0" и "true" тик не включают
export function shouldStartScheduler(env: { RUN_SCHEDULER?: string; NEXT_PHASE?: string }): boolean {
  return env.RUN_SCHEDULER === "1" && env.NEXT_PHASE !== "phase-production-build";
}

// Журнал по смене состояния: первая ошибка по ключу печатается, повторы считаются молча,
// при восстановлении — одна строка со счётчиком. При лежащей базе лог не забивается каждую минуту.
export class ErrorLog {
  private failing = new Map<string, number>();
  constructor(private print: (line: string, e?: unknown) => void = (line, e) => (e === undefined ? console.log(line) : console.error(line, e))) {}

  error(key: string, e: unknown) {
    const n = this.failing.get(key);
    if (n === undefined) this.print(`[scheduler] ${key}: ошибка`, e);
    this.failing.set(key, (n ?? 0) + 1);
  }

  ok(key: string) {
    const n = this.failing.get(key);
    if (n === undefined) return;
    this.failing.delete(key);
    this.print(`[scheduler] ${key}: снова работает${n > 1 ? `, повторов ошибки ${n - 1}` : ""}`);
  }
}

export const LATE_AFTER_MS = 3 * 60_000;

export type Heartbeat = { at: Date; source: TickSource; ms: number; failed: string[]; paused: boolean; done: Record<string, number>; dry: Record<string, number> };

// Пульс хранится JSON-ом в Setting: всё, что не похоже на пульс, считаем его отсутствием
export function parseHeartbeat(value: unknown): Heartbeat | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const at = typeof v.at === "string" ? new Date(v.at) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const counts = (x: unknown): Record<string, number> =>
    x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([, n]) => typeof n === "number")) as Record<string, number> : {};
  return {
    at,
    source: v.source === "http" ? "http" : "timer",
    ms: typeof v.ms === "number" ? v.ms : 0,
    failed: Array.isArray(v.failed) ? v.failed.filter((s): s is string => typeof s === "string") : [],
    paused: v.paused === true,
    done: counts(v.done),
    dry: counts(v.dry),
  };
}

export type SchedulerState =
  | { kind: "off"; last: Heartbeat | null }
  | { kind: "never" }
  | { kind: "late"; last: Heartbeat; ageMin: number }
  | { kind: "paused"; last: Heartbeat }
  | { kind: "ok"; last: Heartbeat };

// paused — сама настройка, а не отметка в пульсе: иначе до следующего тика карточка спорила бы с кнопкой паузы
export function heartbeatState(pulse: Heartbeat | null, now: Date, enabled: boolean, paused: boolean): SchedulerState {
  if (!enabled) return { kind: "off", last: pulse };
  if (!pulse) return { kind: "never" };
  const age = now.getTime() - pulse.at.getTime();
  if (age > LATE_AFTER_MS) return { kind: "late", last: pulse, ageMin: Math.floor(age / 60_000) };
  return paused ? { kind: "paused", last: pulse } : { kind: "ok", last: pulse };
}
