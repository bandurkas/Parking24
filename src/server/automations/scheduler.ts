import "server-only";
import { PrismaClient, type Prisma } from "@prisma/client";
import { MIN_CRON_SECRET } from "@/server/lib/cron-auth";
import {
  ErrorLog, SCHEDULER_KEYS, parseModes, runTickWith, shouldStartScheduler,
  type Locked, type Scan, type Step, type TickResult, type TickSource,
} from "./tick-core";
import { overstayScan } from "./scans/overstay";
import { senderStep } from "./sender";

// Минутный тик (docs/phases/PHASE_01_SCHEDULER.md). На верхнем уровне модуля — только объявления:
// next build исполняет модули маршрутов, а route.ts импортирует этот файл.

type Tx = Prisma.TransactionClient;

// Отличается от блокировки занятости (autoconfirm.ts, 24_0921): общий ключ тормозил бы заявки с сайта
export const SCHEDULER_LOCK = 24_0922;
const PERIOD_MS = 60_000;
const FIRST_DELAY_MS = 15_000;
const TX_OPTS = { timeout: 30_000, maxWait: 10_000 };

// Сканы по фазам: Ф2б — перестой, Ф7 — напоминания и «не приехал». Код каждого — строкой в scan-registry.ts
// (подпись и режим в карточке «Планировщик»); порядок здесь — порядок в тике.
const SCANS: Scan<Tx>[] = [overstayScan];
// Шаги вне транзакции скана (Ф4: отправщик ходит в сеть). Клиент базы — функцией: здесь только объявление
const STEPS: Step[] = [senderStep(() => db())];

// Модуль в одном процессе исполняется дважды (бандл instrumentation и бандл маршрутов),
// поэтому всё состояние — в globalThis, без условий по NODE_ENV
type SchedulerGlobal = { db?: PrismaClient; timer?: ReturnType<typeof setTimeout>; state: { running: boolean }; log: ErrorLog };
function g(): SchedulerGlobal {
  const root = globalThis as typeof globalThis & { __p24Scheduler?: SchedulerGlobal };
  root.__p24Scheduler ??= { state: { running: false }, log: new ErrorLog() };
  return root.__p24Scheduler;
}

// Свой клиент без логов: основной печатает каждую ошибку сам, и при лежащей базе лог забивался бы каждую минуту.
// Два соединения: тик не отнимает пул у сайта.
function db(): PrismaClient {
  const s = g();
  if (!s.db) {
    const url = process.env.DATABASE_URL;
    const limited = url && !url.includes("connection_limit=") ? `${url}${url.includes("?") ? "&" : "?"}connection_limit=2` : url;
    s.db = new PrismaClient({ log: [], ...(limited ? { datasourceUrl: limited } : {}) });
  }
  return s.db;
}

class Rollback {
  constructor(readonly value: unknown) {}
}

// try, а не блокирующий вариант: тику надо пропустить работу, а не встать в очередь за другим процессом
async function withLock<T>(fn: (tx: Tx) => Promise<T>, opts: { rollback: boolean }): Promise<Locked<T>> {
  try {
    return await db().$transaction(async (tx) => {
      const [row] = await tx.$queryRawUnsafe<{ locked: boolean }[]>(`SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK}) AS locked`);
      if (!row?.locked) return { locked: false } as const;
      // Таймаут транзакции Prisma не прерывает зависший запрос — ограничиваем сам Postgres
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '25s'`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
      const value = await fn(tx);
      // «Пробно»: скан отработал, но его записи откатываются вместе с транзакцией
      if (opts.rollback) throw new Rollback(value);
      return { locked: true, value } as const;
    }, TX_OPTS);
  } catch (e) {
    if (e instanceof Rollback) return { locked: true, value: e.value as T };
    throw e;
  }
}

async function loadConfig() {
  const rows = await db().setting.findMany({ where: { key: { in: [SCHEDULER_KEYS.paused, SCHEDULER_KEYS.scans] } } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  return { paused: get(SCHEDULER_KEYS.paused) === true, modes: parseModes(get(SCHEDULER_KEYS.scans)) };
}

async function writePulse(tx: Tx, result: TickResult) {
  const value = { at: result.at, source: result.source, ms: result.ms, done: result.done, dry: result.dry, failed: result.failed, paused: result.paused === true };
  await tx.setting.upsert({ where: { key: SCHEDULER_KEYS.heartbeat }, update: { value }, create: { key: SCHEDULER_KEYS.heartbeat, value } });
}

export function runTick(source: TickSource): Promise<TickResult> {
  const s = g();
  return runTickWith(source, { scans: SCANS, steps: STEPS, loadConfig, withLock, writePulse, now: () => new Date(), state: s.state, log: s.log });
}

function startScheduler() {
  const s = g();
  if (s.timer) clearTimeout(s.timer);
  const arm = (ms: number) => {
    const t = setTimeout(loop, ms);
    (t as { unref?: () => void }).unref?.();
    s.timer = t;
  };
  // В таймер — обычная функция: перезавод в finally, иначе одно исключение останавливает тик навсегда при живом процессе
  const loop = () => {
    void runTick("timer")
      .catch((e) => s.log.error("tick", e))
      .finally(() => arm(PERIOD_MS));
  };
  arm(FIRST_DELAY_MS);
  console.log("[scheduler] минутный тик включён");
}

// Из register(): предупреждение о секрете — при любом RUN_SCHEDULER, иначе локальный e2e упрётся в молчаливый 404
export function bootScheduler() {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < MIN_CRON_SECRET) console.warn(`[scheduler] CRON_SECRET короче ${MIN_CRON_SECRET} символов — вход /api/cron/automations выключен`);
  if (shouldStartScheduler({ RUN_SCHEDULER: process.env.RUN_SCHEDULER, NEXT_PHASE: process.env.NEXT_PHASE })) startScheduler();
  else console.log("[scheduler] выключен (RUN_SCHEDULER ≠ 1), тик только через /api/cron/automations");
}
