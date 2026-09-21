# Этап 2 (уведомления): проектные решения (22.09.2026)

Шесть независимых разборов перед тем, как писать код этапа 2. Каждый читал код и документацию Next 16.3 сам. Критики этого разбора не дошли до результата — сессия закончилась раньше, поэтому решения ниже **не прошли сверку на противоречия между собой**: перед реализацией их надо прочитать подряд и снять расхождения.

Порядок разделов — порядок реализации.



## Планировщик: как запускается минутный тик

Файл инструментации в этой версии Next должен лежать строго в `src/instrumentation.ts` (сборка сканирует только каталог рядом с `app`, корень проекта не смотрит), register() вызывается ровно один раз на процесс сервера и при `next build` не вызывается вовсе. Тик делаем цепочкой setTimeout (следующий заводится только после завершения предыдущего) с тремя слоями защиты от двойной работы: флаг в памяти, `pg_try_advisory_xact_lock` на каждый скан в отдельной транзакции и уникальный `Outbox.dedupKey` как последний рубеж. Запасной эндпоинт `/api/cron/automations` оставляем — без него e2e вынужден ждать минуту; он отвечает 404 на любую неудачу, сравнивает секрет через sha256+timingSafeEqual и требует исключения `/api/cron` из Basic Auth в `src/proxy.ts`, иначе на stage вернёт 401.


### Решения

**1. Где физически лежит файл инструментации в ЭТОЙ версии Next (есть src/ и src/proxy.ts)**

`src/instrumentation.ts` — и только там. Файл в корне рядом с package.json НЕ будет подхвачен вообще.

**Можно ли из instrumentation импортировать модули с `import "server-only"` (autoconfirm.ts, bookings.ts, dispatcher.ts)**

Да, безопасно. Слой `instrument` входит в группу serverOnly, и `server-only` алиасится в пустой модуль.

**2а. Сколько раз вызывается register() в standalone-сборке в Docker**

Ровно один раз на процесс контейнера. Больше процессов не бывает при одной реплике.

**2б. Сколько раз в dev-режиме и как пережить HMR**

Один раз на процесс dev-сервера. HMR сам по себе register() не перезапускает, но перезапуск процесса (правка next.config.ts, env, devMemoryThresholdRestart) даёт новый процесс — старые таймеры умирают вместе со старым. Защита: хранить handle таймера в globalThis и гасить предыдущий.

**2в. Как не получить два параллельных тика**

Цепочка setTimeout (следующий тик заводится только в finally предыдущего), а не setInterval; плюс флаг `__p24Running` в globalThis на случай параллельного вызова через HTTP; плюс clearTimeout старого handle при повторном исполнении модуля.

**3а. Нужен ли запасной HTTP-эндпоинт, если тик встроенный**

Нужен, но как вторичный вход: (1) только им можно детерминированно дёрнуть тик в e2e, иначе тест ждёт минуту; (2) аварийный запуск, если RUN_SCHEDULER=0 или таймер умер; (3) он уже обещан в плане. Метод только POST.

**3б. Как защитить эндпоинт и как сравнить секрет безопасно**

sha256 от обоих значений → timingSafeEqual (одинаковая длина буферов, без раннего выхода и без утечки длины секрета). Любая неудача — 404 «Not found», а не 401: маршрута как будто нет. Минимальная длина секрета 16 символов, иначе вход выключен и в лог пишется предупреждение.

**3в. Что мешает эндпоинту работать на stage**

src/proxy.ts:10-23 навешивает Basic Auth на ВСЕ пути (matcher исключает только _next/static, favicon, photos, icons, brand). Если на stage заданы BASIC_AUTH_USER/PASS, внешний крон получит 401, не дойдя до маршрута. Нужно исключить `/api/cron` из Basic Auth — у него свой, более сильный секрет.

**4. Как два тика не сделают одну работу дважды**

Три слоя. (1) Флаг в памяти — перекрытие тика и HTTP-вызова в одном процессе. (2) `pg_try_advisory_xact_lock(24_0922)` внутри prisma.$transaction — второй процесс/вторая реплика/внешний крон молча выходит. (3) Уникальный `Outbox.dedupKey` и переходы статуса через updateMany с условием по старому статусу — единственный слой, который переживает потерю блокировки. Транзакция — ОДНА НА СКАН, не одна на тик.

**4б. Почему нельзя оставить enqueue как есть**

src/server/automations/dispatcher.ts:24-26 делает findUnique → create: два тика в гонке оба пройдут проверку и второй упадёт на P2002. Ловить P2002 и считать «уже в очереди» (или createMany({ skipDuplicates: true })).

**4в. Как системный автопереход в «Не приехал» вписать в тик**

Через tx-вариант перехода. Текущий `transition()` открывает свою `prisma.$transaction` и требует `SessionUser` — внутри тика это второе соединение и второй коннект под блокировкой. Нужен внутренний `transitionInTx(tx, bookingId, to, actor|null, opts)`, где actor = null даёт `userId: null` в ленте и журнале.

**5. Что делать с ошибками внутри тика**

(1) Никогда не передавать async-функцию прямо в setTimeout/setInterval — отклонённый промис там это unhandledRejection, а Node 22 по умолчанию убивает процесс. Только `void runTick().catch(log).finally(rearm)`. (2) runTick сам никогда не реджектит: каждый скан в своём try/catch, следующий тик заводится в finally. (3) register() целиком в try/catch. (4) Троттлинг лога: при лежащей базе не писать одну и ту же ошибку каждую минуту.

**6а. Как выключить планировщик при сборке**

Ничего делать не надо — Next сам не зовёт register() при `next build`. Свою проверку всё равно ставим, плюс `await import()` модуля планировщика только в ветке NEXT_RUNTIME === 'nodejs', чтобы Prisma не попала ни в build-time, ни в edge-граф.

**6б. Как выключить на время тестов**

Единственный выключатель — `RUN_SCHEDULER === "1"`. Пусто или 0 — тика нет (локальный .env уже 0). Юнит-тесты модуль вообще не импортируют. E2E поднимает dev с `RUN_SCHEDULER=0` и дёргает тик через `/api/cron/automations` — прогон становится детерминированным вместо ожидания минуты.

**Нужен ли edge-вариант register**

Нет. В этой версии proxy по умолчанию на Node-рантайме, edge-инстанса в проекте нет. Гард `NEXT_RUNTIME !== 'nodejs' → return` оставляем по рекомендации дока.

**Окна сканов: узкая минутная полоса или «догоняющее» условие**

Догоняющее: «плановый момент уже прошёл порог И записи в Outbox ещё нет», а не «попал в интервал [now-1мин, now]». Иначе перезапуск контейнера, залипший тик или минута простоя базы навсегда теряют сообщение.


### Файлы

- **src/instrumentation.ts** — НОВЫЙ. Точка входа Next. Только заводит таймер и мгновенно возвращает управление. Ничего не импортирует на верхнем уровне — динамический import только в ветке nodejs.

```
// Next зовёт register() один раз на процесс сервера и ждёт его до приёма запросов,
// поэтому здесь только заводим таймер — работа уходит в фон.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Сборка register() не вызывает (Next отсекает phase-production-build сам), проверка — на всякий случай
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.RUN_SCHEDULER !== "1") return;
  try {
    const { startScheduler } = await import("@/server/automations/scheduler");
    startScheduler();
  } catch (e) {
    // Ошибка из register() роняет старт сервера целиком — гасим её здесь
    console.error("[scheduler] не запустился:", e);
  }
}
```

- **src/server/automations/scheduler.ts** — НОВЫЙ. Минутный тик, блокировка в базе, изоляция ошибок, реестр сканов. Сканы получают tx и НЕ открывают своих транзакций. Контракт скана: `(tx, now) => Promise<number>` (сколько сделал), идемпотентный.

```
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { remind24h, noShowNotice, autoNoShow } from "./scans";

// Ключ не совпадает с OCCUPANCY_LOCK (autoconfirm.ts:11): общий ключ заставил бы тик
// блокировать заявки с сайта.
export const SCHEDULER_LOCK = 24_0922;

const PERIOD_MS = 60_000;
const FIRST_DELAY_MS = 15_000; // дать контейнеру подняться после migrate/seed
const TX = { timeout: 30_000, maxWait: 10_000 }; // по умолчанию у Prisma 5 с — скану мало

type Scan = { code: string; run: (tx: Prisma.TransactionClient, now: Date) => Promise<number> };
const SCANS: Scan[] = [
  { code: "remind_24h", run: remind24h },
  { code: "no_show_notice", run: noShowNotice },
  { code: "auto_no_show", run: autoNoShow },
];

const g = globalThis as typeof globalThis & { __p24Tick?: ReturnType<typeof setTimeout>; __p24Running?: boolean };

// try, а не блокирующий вариант: тику надо пропустить работу, а не встать в очередь.
async function withLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | "busy"> {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
      `SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK}) AS locked`,
    );
    return row?.locked ? fn(tx) : ("busy" as const);
  }, TX);
}

export type TickResult = { ok: boolean; busy?: true; done: Record<string, number>; failed: string[] };

export async function runTick(source: "timer" | "http"): Promise<TickResult> {
  if (g.__p24Running) return { ok: true, busy: true, done: {}, failed: [] };
  g.__p24Running = true;
  const now = new Date();
  const done: Record<string, number> = {};
  const failed: string[] = [];
  try {
    for (const scan of SCANS) {
      // Каждый скан в своей транзакции: пойманная ошибка базы переводит транзакцию
      // в aborted, и соседние сканы в ней уже не выполнятся.
      try {
        const n = await withLock((tx) => scan.run(tx, now));
        if (n === "busy") return { ok: true, busy: true, done, failed };
        if (n > 0) done[scan.code] = n;
      } catch (e) {
        failed.push(scan.code);
        logOnce(`${scan.code}:${source}`, e);
      }
    }
    return { ok: failed.length === 0, done, failed };
  } finally {
    g.__p24Running = false;
  }
}

export function startScheduler() {
  if (g.__p24Tick) clearTimeout(g.__p24Tick); // переживаем повторное исполнение модуля в dev
  const arm = (ms: number) => {
    const t = setTimeout(loop, ms);
    // Таймер не держит процесс: иначе скрипт, импортировавший модуль, не завершится
    (t as { unref?: () => void }).unref?.();
    g.__p24Tick = t;
  };
  const loop = () => {
    // async-функцию в setTimeout передавать нельзя: её reject — unhandledRejection,
    // а Node 22 по умолчанию на нём убивает процесс.
    void runTick("timer")
      .catch((e) => console.error("[scheduler] тик:", e))
      .finally(() => arm(PERIOD_MS));
  };
  arm(FIRST_DELAY_MS);
  console.log("[scheduler] минутный тик включён");
}
```

- **src/server/automations/scheduler-log.ts** — НОВЫЙ (или функция logOnce прямо в scheduler.ts). Троттлинг лога: при лежащей базе не писать одну и ту же ошибку каждую минуту сутками.

```
const last = new Map<string, { msg: string; at: number; n: number }>();
const QUIET_MS = 15 * 60_000;

// Повторяющуюся ошибку печатаем раз в 15 минут со счётчиком: иначе лог за ночь
// заполняется одной и той же строкой и скрывает остальное.
export function logOnce(key: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const prev = last.get(key);
  if (prev && prev.msg === msg && Date.now() - prev.at < QUIET_MS) { prev.n++; return; }
  console.error(`[scheduler] ${key}${prev && prev.n > 1 ? ` (и ещё ${prev.n} раз)` : ""}:`, e);
  last.set(key, { msg, at: Date.now(), n: 1 });
}
```

- **src/server/lib/cron-auth.ts** — НОВЫЙ. Чистая проверка секрета — отдельным модулем, чтобы её можно было покрыть юнит-тестом без базы и без server-only.

```
import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_CRON_SECRET = 16;

// sha256 уравнивает длину: timingSafeEqual падает на разных длинах, а проверка длины
// до сравнения — утечка длины секрета.
export function cronSecretOk(given: string | null | undefined, want: string | undefined): boolean {
  if (!want || want.length < MIN_CRON_SECRET) return false;
  const a = createHash("sha256").update(given ?? "").digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}
```

- **src/app/api/cron/automations/route.ts** — НОВЫЙ. Запасной вход: POST + X-Cron-Secret. Любая неудача — 404, чтобы наружу маршрута как будто не было. Тот же runTick, та же блокировка.

```
import { NextResponse } from "next/server";
import { cronSecretOk } from "@/server/lib/cron-auth";
import { runTick } from "@/server/automations/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new NextResponse("Not found", { status: 404 });

// Запасной вход для внешнего крона и для e2e: тик по запросу.
// Отвечаем 404, а не 401: наличие маршрута наружу не подтверждаем.
export async function POST(req: Request) {
  if (!cronSecretOk(req.headers.get("x-cron-secret"), process.env.CRON_SECRET)) return notFound();
  return NextResponse.json(await runTick("http"));
}
```

- **src/proxy.ts** — ПРАВКА (строки 8-25). Поднять разбор pathname выше блока Basic Auth и исключить /api/cron: у крона свой секрет, Basic Auth со stage ему не выдаётся. Сейчас :10-23 отдаёт 401 всем путям до того, как маршрут вообще начнёт работать.

```
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  // Крон приходит со своим секретом в X-Cron-Secret, Basic Auth stage ему не выдаётся
  if (user && pass && !pathname.startsWith("/api/cron")) {
    ...
  }
  // (ниже строку `const { pathname } = req.nextUrl;` убрать — она уже выше)
```

- **src/server/automations/dispatcher.ts** — ПРАВКА строк 23-38 (зона соседнего агента, но нужна для тика): findUnique→create не атомарны, два тика в гонке дают P2002 и валят весь скан. Ловить P2002 как «уже в очереди».

```
try {
    return await tx.outbox.create({ data: { ... } });
  } catch (e) {
    // Уникальный dedupKey — последний рубеж от дубля: гонку двух тиков считаем «уже поставлено»
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
```

- **src/server/services/bookings.ts** — ПРАВКА (transition, строки 98-151). Выделить внутреннее ядро `transitionInTx(tx, bookingId, to, actor: SessionUser | null, opts)`, а `transition()` оставить обёрткой, открывающей транзакцию. Нужно скану авто-«Не приехал»: сейчас transition открывает свою транзакцию (второе соединение под блокировкой) и на :141,:147 безусловно пишет actor.id. Системное действие требует userId = null. Обновление статуса делать через updateMany с условием по старому статусу, чтобы гонка не перевела бронь дважды.

```
// Системное действие (планировщик): actor = null → в ленте и журнале userId = null
const res = await tx.booking.updateMany({
  where: { id: bookingId, status: { in: ["AWAITING_PAYMENT", "CONFIRMED"] } },
  data: { status: "NO_SHOW", noShowAt: now },
});
if (res.count === 0) return null; // другой тик успел раньше
```

- **.env.example** — ПРАВКА строк 12-15. Уточнить: RUN_SCHEDULER=1 только на stage/проде, локально и в тестах 0; CRON_SECRET не короче 16 символов, иначе запасной вход выключен; как сгенерировать.

```
# Секрет для POST /api/cron/automations (заголовок X-Cron-Secret), не короче 16 символов:
# openssl rand -hex 32
CRON_SECRET=
# 1 — встроенный минутный тик (src/instrumentation.ts). Локально и в e2e держать 0
RUN_SCHEDULER=0
```

- **.env** — ТРЕБУЕТ ВНИМАНИЯ (не правлю, только сообщаю): текущий CRON_SECRET длиной 14 символов — при пороге 16 запасной вход будет молча отвечать 404. Перевыпустить и на stage тоже.
- **tests/unit/scheduler.test.ts** — НОВЫЙ. Юнит-тесты чистых частей: проверка секрета и решение «запускать ли тик». База и сервер не нужны, укладывается в существующий `npm test`.

```
import { test } from "node:test";
import assert from "node:assert/strict";
import { cronSecretOk } from "@/server/lib/cron-auth";

test("cronSecretOk: короткий, пустой и чужой секрет не проходят", () => {
  assert.equal(cronSecretOk("x", undefined), false);
  assert.equal(cronSecretOk("короткий", "короткий"), false); // < 16 символов
  const want = "a".repeat(32);
  assert.equal(cronSecretOk(null, want), false);
  assert.equal(cronSecretOk("a".repeat(31), want), false); // разная длина не бросает
  assert.equal(cronSecretOk(want, want), true);
});
```

- **tests/e2e/automations.mjs** — НОВЫЙ. Сценарий по образцу tests/e2e/autoconfirm.mjs: тик дёргается через эндпоинт, а не ожиданием минуты. Проверяет дедуп при параллельных вызовах, авто-«Не приехал» и закрытость эндпоинта.

```
// Пять POST /api/cron/automations параллельно → в Outbox ровно одна запись на бронь
const calls = Array.from({ length: 5 }, () => fetch(`${base}/api/cron/automations`, {
  method: "POST", headers: { "X-Cron-Secret": secret },
}));
const res = await Promise.all(calls);
// хотя бы один ответ busy или done, ни одного 500
```

- **tests/README.md** — ПРАВКА. Раздел про планировщик: e2e поднимать как `RUN_SCHEDULER=0 npx next dev -p 3100`, тик дёргать вручную через эндпоинт; в «Подводных камнях» — что на stage Basic Auth не пускает крон, пока не исключён /api/cron.
- **docker-compose.yml** — ПРАВКА (комментарий у сервиса web). Одна реплика: `--scale web=2` даст два тика. Если когда-нибудь понадобится две — работает блокировка в базе, но проверять это надо отдельно.

```
web:
    # Одна реплика: минутный тик живёт в процессе сервера (src/instrumentation.ts).
    # При --scale web=2 тиков станет два; от дубля спасает pg_try_advisory_xact_lock, но проверено это не было.
    build: .
```

- **docs/TZ_2026-09-21_PLAN.md** — ПРАВКА строки 89. Отметить сделанное и зафиксировать решения: файл в src/, тик — цепочка setTimeout, три слоя защиты от дубля, эндпоинт отвечает 404 и исключён из Basic Auth, RUN_SCHEDULER=0 в тестах.

### Риски

- **Риск:** Basic Auth на stage (src/proxy.ts:10-23) перехватывает /api/cron/automations и отдаёт 401 до маршрута. Внешний крон и e2e против stage не работают, а причина выглядит как «эндпоинт сломан».
  **Что делаем:** Исключить `/api/cron` из блока Basic Auth в proxy.ts (у маршрута свой секрет, он сильнее). Обязательно проверить курлом на stage сразу после деплоя: ответ должен быть 404 на пустой заголовок и 200 на верный.
- **Риск:** Текущий CRON_SECRET — 14 символов. При пороге 16 запасной вход молча отвечает 404, и это невозможно отличить от «маршрута нет».
  **Что делаем:** Перевыпустить секрет (`openssl rand -hex 32`) в .env локально и на stage ДО деплоя. Плюс при старте планировщика писать в лог предупреждение «CRON_SECRET короче 16 символов — запасной вход выключен», чтобы молчания не было.
- **Риск:** Две реплики web или перекрытие старого и нового контейнера при деплое дают два тика. Без блокировки — двойные сообщения клиенту и двойные записи в ленте.
  **Что делаем:** pg_try_advisory_xact_lock(24_0922) в каждом скане + уникальный Outbox.dedupKey + updateMany с условием по старому статусу. Ключ обязательно отличается от OCCUPANCY_LOCK=24_0921. В compose держать одну реплику и написать это комментарием.
- **Риск:** Отклонённый промис, переданный в setTimeout/setInterval, — unhandledRejection; Node 22 по умолчанию убивает процесс. Один сбой базы в 3 часа ночи кладёт CRM до утра.
  **Что делаем:** В таймер передаётся синхронная функция, внутри `void runTick().catch(log).finally(arm)`. runTick оборачивает каждый скан в try/catch и по контракту не реджектит. Проверить тестом: скан, который бросает, не мешает следующему и не роняет процесс.
- **Риск:** Если register() бросит, Next перевыбросит её как «An error occurred while loading instrumentation hook» (instrumentation-globals.external.js:60-67) — сервер не поднимется вообще. Сейчас на старте контейнера база может быть недоступна секунду-другую.
  **Что делаем:** Весь register() в try/catch, первый тик НЕ ждать (док: register должен завершиться до приёма запросов), динамический import внутри try. Первый тик отложен на 15 с.
- **Риск:** Дефолтный таймаут интерактивной транзакции Prisma — 5 с. Скан по выросшей таблице броней упирается в P2028, работа не делается, а в логе висит невнятная ошибка транзакции.
  **Что делаем:** `{ timeout: 30_000, maxWait: 10_000 }` в $transaction; запросы сканов — по индексированным полям (@@index([dateFrom]), @@index([boardId, status]) в schema.prisma). После этапа замерить длительность тика на stage и записать в HANDOFF.
- **Риск:** Ошибка Postgres, пойманная внутри открытой транзакции, переводит её в aborted (25P02): все следующие сканы в той же транзакции упадут с «current transaction is aborted», и один сбойный скан утащит за собой остальные.
  **Что делаем:** Одна транзакция на скан, не одна на тик. Тестом: скан №1 бросает ошибку БД — сканы №2 и №3 отрабатывают и возвращают свои числа.
- **Риск:** enqueue (dispatcher.ts:24-26) делает findUnique→create: гонка двух тиков даёт P2002 и валит скан целиком.
  **Что делаем:** Ловить P2002 и возвращать null («уже в очереди»). Согласовать с агентом, который делает сканы и шаблоны, — это его файл.
- **Риск:** Узкое минутное окно скана («плановый момент попал в [now-1мин, now]») теряет сообщение при перезапуске контейнера, при пропущенном тике или при залипшей блокировке. Клиент просто не получает напоминание, и никто этого не замечает.
  **Что делаем:** Условие догоняющее: «порог пройден И записи в Outbox ещё нет». Уникальный dedupKey делает это безопасным. Тестом: тик, пропущенный на 3 часа, всё равно ставит напоминание ровно один раз.
- **Риск:** На stage RUN_SCHEDULER=1 и в очереди уже 7 неотправленных сообщений за 08–21.09 (docs/TZ_2026-09-21_PLAN.md:161). Когда на этот же тик повесят отправщик Wazzup (этап 2а), они уйдут реальным людям через две недели после брони.
  **Что делаем:** На этапе 2 тик ничего не отправляет — только ставит в очередь и меняет статусы. В отправщик этапа 2а обязательны отсечка по возрасту сообщения и белый список номеров; до этого — почистить залежавшиеся PENDING на stage.
- **Риск:** Планировщик, забытый включённым локально или в e2e, портит тестовые данные: авто-«Не приехал» и лишние записи в Outbox ломают ассерты site-lead.mjs («сообщение в очереди»).
  **Что делаем:** RUN_SCHEDULER=1 и только 1 включает тик; локальный .env уже 0. В tests/README.md закрепить запуск dev для e2e с RUN_SCHEDULER=0 и дёрганье тика через эндпоинт.
- **Риск:** В dev перезапуск процесса (правка next.config.ts, env, devMemoryThresholdRestart) заводит новый таймер; при повторном исполнении модуля без перезапуска процесса можно получить два.
  **Что делаем:** Handle таймера в globalThis, clearTimeout прежнего при startScheduler — тот же паттерн, что в src/server/db/prisma.ts:3-11. unref(), чтобы таймер не держал процесс.
- **Риск:** TypeScript: в проекте подключены и lib.dom, и @types/node, поэтому возвращаемый тип setTimeout может разойтись (number против NodeJS.Timeout) и сборка упадёт на присваивании handle.
  **Что делаем:** Тип поля — `ReturnType<typeof setTimeout>`, unref вызывать как `(t as { unref?: () => void }).unref?.()`. Проверяется обычным `npm run build`.
- **Риск:** Prisma-параметр в теговом $queryRaw делает `pg_try_advisory_xact_lock($1)` неоднозначным по типу (есть перегрузки bigint и (int,int)) — возможна ошибка «function does not exist».
  **Что делаем:** Ключ — константа в коде, поэтому $queryRawUnsafe с литералом, как уже сделано в autoconfirm.ts:22 ($executeRawUnsafe). Внешних данных в строку не попадает.

### Что покрыть тестами

- Юнит (tests/unit/scheduler.test.ts): cronSecretOk — пустой секрет, секрет короче 16, верный, неверный той же длины, неверный другой длины (не бросает), given = null.
- Юнит: shouldStartScheduler({ NEXT_RUNTIME, NEXT_PHASE, RUN_SCHEDULER }) — nodejs+"1" → true; edge → false; phase-production-build → false; RUN_SCHEDULER не задан / "0" / "true" → false (только строка "1").
- Юнит с подставным списком сканов: скан, который бросает, не мешает следующим — runTick возвращает failed:["a"] и done для b и c, и сам не реджектит.
- Юнит: повторный вызов runTick во время выполнения первого возвращает busy:true и не запускает сканы второй раз (флаг в памяти).
- Юнит: startScheduler дважды подряд оставляет ровно один активный таймер (проверяется тем, что второй вызов гасит handle из globalThis).
- E2E (tests/e2e/automations.mjs): POST /api/cron/automations без заголовка → 404; с неверным секретом → 404; с верным → 200 и JSON с полями done/failed.
- E2E: бронь с плановым заездом через 23 часа; один тик через эндпоинт ставит ровно одно напоминание в Outbox; второй тик подряд новых записей не создаёт (dedupKey).
- E2E, гонка: пять POST на эндпоинт параллельно → в Outbox по-прежнему одна запись на бронь, ни одного ответа 500 (блокировка + dedupKey).
- E2E: бронь «Ожидает оплаты» с плановым заездом 49 часов назад после тика переходит в «Не приехал», в ленте запись с автором «система» (userId = null), оставшиеся PENDING по этой брони отменены.
- E2E: повторный тик по уже переведённой брони ничего не меняет (updateMany с условием по старому статусу, count = 0).
- Ручная проверка на stage после деплоя: curl -X POST -H "X-Cron-Secret: <секрет>" https://.../api/cron/automations под включённым Basic Auth — должен вернуть 200, а не 401 (иначе исключение /api/cron в proxy.ts не сработало).
- Ручная проверка: `RUN_SCHEDULER=1 npx next dev` — в логе ровно одна строка «[scheduler] минутный тик включён»; правка любого файла под src/ (HMR) второй строки не добавляет.
- Ручная проверка: `npm run build` проходит и в логе НЕТ строки про включённый тик — register() при сборке не зовётся; в .next/server/ появился instrumentation.js.
- Ручная проверка: остановить контейнер базы на 5 минут при работающем тике — процесс web жив, в логе одна сообщённая ошибка со счётчиком повторов, после подъёма базы тик догоняет пропущенное.


## Моменты времени: когда именно срабатывает каждое правило

Плановый момент заезда = дата брони + время (или 12:00) как настенное время Europe/Moscow, переведённое в UTC двухпроходным Intl-переводом (новая функция `zonedToUtc` в `src/server/lib/dates.ts`, рядом с уже работающим `actualParkingDays`) — жёсткого UTC+3 нигде нет. Все три момента (−24 ч, +24 ч, +48 ч) считает один чистый модуль `src/lib/automation-time.ts` (как `occupancy-math.ts`), сканер берёт кандидатов SQL-предфильтром по DATE-колонке и решает уже в JS; идемпотентность — через `dedupKey = правило:бронь:2026-10-01T12:00` (штамп плановых даты и времени), плюс перехват P2002. Автопереход в «Не приехал» делается новой `systemTransition()`, которая разделяет тело нынешней `transition()` (actor = null, как уже умеют `createBooking` и `audit`), а от лавины на старых бронях защищает пара «нижняя граница времени» (`max(activatedAt, now − maxAgeHours)`) + выключатель + dry-run + лимит на тик.


### Решения

**1. Что считать «плановым моментом заезда» и как надёжно получить его в UTC**

plannedArrival = настенное время Европы/Москвы из `toIso(dateFrom)` + `timeFrom ?? "12:00"`, переведённое в UTC функцией `zonedToUtc(dateIso, time, tz)` с двумя проходами по смещению зоны. Часовой пояс — константа `PARKING_TZ = "Europe/Moscow"` в одном месте, смещение берётся у `Intl.DateTimeFormat`, а не константой +3. Аналогично `plannedDeparture` из `dateTo`/`timeTo` — она нужна сообщению «спасибо» и блоку «Планируют выезд» из этапа 3. Ни в одном расчёте не использовать `Date#getHours()`/локальное время процесса: контейнер `web` в docker-compose.yml запускается без переменной TZ, то есть в UTC.

**2. Какие брони попадают в каждый скан**

Общий фильтр: `kind = PARKING`, `status in (AWAITING_PAYMENT, CONFIRMED)`, `contactPhone != null`. CHECKED_IN исключён самим статусом (клиент приехал), NEW исключён намеренно (место не держится, заявку ещё смотрит администратор), CANCELLED/NO_SHOW/REJECTED/CHECKED_OUT — терминальные. Напоминание: плановый заезд в будущем и `now >= arrival − 24 ч`; предфильтр по SQL `dateFrom between today−1 and today+2`. «Вы не приехали»: `now >= arrival + 24 ч`; предфильтр `dateFrom between floorDate and today`. Автопереход: `now >= arrival + 48 ч`, тот же предфильтр. Точное сравнение — в JS по `plannedArrival`, потому что в SQL московские часы не пересчитать без дублирования логики, а кандидатов единицы. Брони без телефона и без `clientId` отсеиваем: Outbox для них некуда отправить.

**3. Как не отправить напоминание, если бронь создана позже момента «за 24 часа»**

Условие `booking.createdAt <= arrival − reminderHours` прямо в решателе (одна строка в чистой функции, не в SQL). Узкое окно «строго в момент −24 ч» не годится: при остановке планировщика на деплой брони, чей момент прошёл во время простоя, потеряют напоминание навсегда, а широкое окно + проверка `createdAt` даёт напоминание с опозданием, но по делу. Отдельно предлагаю добавить в `Booking` необязательное поле `datesChangedAt DateTime?` (добавляющая миграция), которое `updateBooking` ставит при смене `dateFrom/timeFrom`, и сравнивать с `max(createdAt, datesChangedAt)`: иначе бронь, созданную месяц назад и передвинутую администратором на «через два часа», сканер сочтёт достойной напоминания. Смысл при этом не теряется — про перенос клиент получит отдельное сообщение «бронь изменена» из того же этапа 2.

**4. Какой ключ дедупликации использовать для сообщений по времени**

`dedupKey = `${ruleCode}:${bookingId}:${stamp}``, где `stamp` — плановые дата и время строкой, как они лежат в брони: `${toIso(dateFrom)}T${timeFrom ?? "12:00"}` (для «спасибо» — `dateTo`/`timeTo`). Повторный тик даёт тот же ключ и ничего не создаёт; смена дат или времени меняет штамп, и сообщение уходит заново. Штамп берём из тех же полей, что и `plannedArrival`, а не из посчитанного UTC-момента: он читается человеком в карточке и не зависит от возможной смены часового пояса стоянки. Три обязательные правки в `enqueue`: (а) принимать ключ и `scheduledAt` через опции, (б) ловить P2002 и возвращать null — сейчас `findUnique` + `create` это гонка двух тиков, (в) не создавать запись, если у брони нет клиента и телефона. Подтверждение (сообщение 1) остаётся на групповом ключе `confirmation:${bookingId}` из `triggerParams.dedupGroup`.

**5. Как сделать системный переход в «Не приехал», не ломая проверки прав**

Разделить нынешнюю `transition()` на две части: приватную `applyTransition(tx, booking, to, actor: SessionUser | null, opts)` с текущим телом (отметки времени, лента, журнал, отмена очереди, `onStatusChanged`) и публичную `transition(bookingId, to, actor: SessionUser, opts)`, которая делает ровно то же, что сейчас: читает бронь, проверяет `canTransition` и зовёт `applyTransition`. Рядом — `systemTransition(bookingId, to, { from, reason })`: внутри транзакции блокирует строку (`SELECT id FROM "Booking" WHERE id = $1 FOR UPDATE`), убеждается, что статус всё ещё в списке `from` и переход есть в `TRANSITIONS`, и зовёт `applyTransition` с `actor = null`. Роли не проверяются (пользователя нет), но набор разрешённых переходов остаётся общим — одна таблица `TRANSITIONS` на оба пути. В ленте и журнале `userId = null`, текст с пометкой «автоматически»; ровно так уже работает автоподтверждение. Публичная сигнатура `transition`/`canTransition` не меняется, серверный экшен не трогаем.

**6. Что делать со старыми бронями, чтобы первый запуск планировщика не устроил лавину**

Пять предохранителей, все в настройках: (1) выключатель `automations.enabled`, по умолчанию выключен, выкатываем на stage выключенным; (2) момент включения `automations.activatedAt` (ISO пишется при включении) — событие, чей срок наступил раньше этого момента, не обрабатывается никогда; (3) жёсткий потолок давности `automations.maxAgeHours` (6 ч) на случай долгого простоя, итоговая нижняя граница `floor = max(activatedAt, now − maxAgeHours)`; (4) режим `automations.dryRun` — тик считает и пишет в лог/колокольчик, что сделал бы, но не создаёт Outbox и не меняет статусы; (5) лимит на тик (`take: 50`, сортировка по `dateFrom asc`) — даже при ошибке в расчёте это капельница, а не залп. Пропущенный «хвост» считаем и один раз кладём в колокольчик одним уведомлением («планировщик пропустил N старых броней»), а не рассылаем по ним сообщения; разобрать их администратор может руками. Это же решает stage-специфику: там уже лежат 7 неотправленных сообщений за 08–21.09.


### Файлы

- **src/server/lib/dates.ts** — Добавить часовой пояс стоянки одной константой и обратный перевод «настенное время зоны → UTC», плюс два помощника для плановых моментов брони и штамп для ключа дедупликации. Импорт расширить: `import { DEFAULT_TIME, billingPeriods, parkingDays } from "@/lib/periods"`.

```
export const PARKING_TZ = "Europe/Moscow";

const FMT = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = FMT.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); FMT.set(tz, f); }
  return f;
}

// Сколько прибавить к UTC, чтобы получить часы зоны в этот момент
function zoneOffsetMs(t: number, tz: string): number {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(t))) if (x.type !== "literal") p[x.type] = x.value;
  // "24" вместо "00" в полночь встречается в старых сборках ICU
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

// Настенное время зоны → момент в UTC. Два прохода: смещение берётся уже на найденном моменте,
// иначе в зонах с переводом часов результат уезжает на час. В России перевода нет, но зона — настройка.
export function zonedToUtc(dateIso: string, time?: string | null, tz = PARKING_TZ): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mi] = (time && /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_TIME).split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mi);
  const first = wall - zoneOffsetMs(wall, tz);
  return new Date(wall - zoneOffsetMs(first, tz));
}

type Planned = { dateFrom: Date; timeFrom: string | null; dateTo: Date; timeTo: string | null };
export const plannedArrival = (b: Pick<Planned, "dateFrom" | "timeFrom">) => zonedToUtc(toIso(b.dateFrom), b.timeFrom);
export const plannedDeparture = (b: Pick<Planned, "dateTo" | "timeTo">) => zonedToUtc(toIso(b.dateTo), b.timeTo);

// Штамп плановых даты и времени для ключа дедупликации: меняется вместе с бронью, читается человеком
export const arrivalStamp = (b: Pick<Planned, "dateFrom" | "timeFrom">) => `${toIso(b.dateFrom)}T${b.timeFrom ?? DEFAULT_TIME}`;
export const departureStamp = (b: Pick<Planned, "dateTo" | "timeTo">) => `${toIso(b.dateTo)}T${b.timeTo ?? DEFAULT_TIME}`;
```

- **src/lib/automation-time.ts** — НОВЫЙ чистый модуль (как src/lib/occupancy-math.ts): вся арифметика моментов и решение «пора / рано / поздно / пропустить» без обращения к базе, чтобы её можно было покрыть юнит-тестами без Postgres. Сканер остаётся тонким.

```
export type TimedCfg = { reminderHours: number; noticeHours: number; releaseHours: number; floorMs: number };
export type TimedBooking = { arrivalMs: number; knownSinceMs: number };
export type TimedAction = "reminder" | "no_show_notice" | "release" | null;

const H = 3_600_000;

// Что положено сделать с бронью в момент nowMs. floorMs — нижняя граница давности:
// момент, наступивший раньше неё, пропускаем навсегда (иначе первый запуск разошлёт всё разом).
export function dueAction(b: TimedBooking, nowMs: number, c: TimedCfg): TimedAction {
  const release = b.arrivalMs + c.releaseHours * H;
  if (nowMs >= release) return release >= c.floorMs ? "release" : null;
  const notice = b.arrivalMs + c.noticeHours * H;
  if (nowMs >= notice) return notice >= c.floorMs ? "no_show_notice" : null;
  const remind = b.arrivalMs - c.reminderHours * H;
  // заезд уже наступил — напоминать поздно; бронь создана позже момента «за 24 часа» — напоминание бессмысленно
  if (nowMs >= remind && nowMs < b.arrivalMs) return remind >= c.floorMs && b.knownSinceMs <= remind ? "reminder" : null;
  return null;
}

export const floorMs = (nowMs: number, activatedAtMs: number | null, maxAgeHours: number) =>
  Math.max(activatedAtMs ?? 0, nowMs - maxAgeHours * H);
```

- **src/server/automations/scanner.ts** — НОВЫЙ файл: один тик сканера. Достаёт кандидатов широким предфильтром по DATE-колонке, точное решение делегирует чистому модулю, ставит сообщения через enqueue и зовёт systemTransition. Возвращает счётчики для лога и dry-run.

```
const HOLD: BookingStatus[] = ["AWAITING_PAYMENT", "CONFIRMED"]; // предоплаты нет: «не приехал» ловим из обоих
const BATCH = 50;

export async function tickTimed(now = new Date()) {
  const cfg = await automationSettings();
  if (!cfg.enabled) return { skipped: "off" as const };
  const floor = floorMs(now.getTime(), cfg.activatedAt?.getTime() ?? null, cfg.maxAgeHours);
  const today = todayIso();
  const rows = await prisma.booking.findMany({
    where: {
      kind: "PARKING",
      status: { in: HOLD },
      contactPhone: { not: null },
      // запас по суткам с обеих сторон: московская дата и дата в базе могут разойтись на день
      dateFrom: { gte: toDate(addDays(today, -Math.ceil(cfg.releaseHours / 24) - 1)), lte: toDate(addDays(today, 2)) },
    },
    orderBy: { dateFrom: "asc" },
    take: BATCH,
  });
  const out = { reminder: 0, notice: 0, release: 0, wouldSkipOld: 0 };
  for (const b of rows) {
    const arrivalMs = plannedArrival(b).getTime();
    const knownSinceMs = Math.max(b.createdAt.getTime(), b.datesChangedAt?.getTime() ?? 0);
    const action = dueAction({ arrivalMs, knownSinceMs }, now.getTime(), { ...cfg, floorMs: floor });
    if (!action) continue;
    if (cfg.dryRun) { out[action === "release" ? "release" : action === "reminder" ? "reminder" : "notice"]++; continue; }
    if (action === "release") {
      await systemTransition(b.id, "NO_SHOW", { from: HOLD, reason: `Автоматически: клиент не приехал за ${cfg.releaseHours} ч после планового заезда` });
      out.release++;
    } else {
      const code = action === "reminder" ? "before_checkin_24h" : "no_show_notice";
      await enqueueByRule(b, code, { dedupKey: `${code}:${b.id}:${arrivalStamp(b)}` });
      out[action === "reminder" ? "reminder" : "notice"]++;
    }
  }
  return out;
}
```

- **src/server/automations/dispatcher.ts** — Строки 23-41: перевести enqueue на опции (свой dedupKey и scheduledAt), перехватывать P2002 вместо гонки findUnique+create, не ставить в очередь сообщение без клиента/телефона. В onStatusChanged (строки 14-20) поддержать `triggerParams.delayHours` — им сообщение «спасибо + отзыв» уедет на 2 часа после выезда, отдельный скан не нужен, и `triggerParams.dedupGroup` для общего ключа подтверждения.

```
export async function enqueue(
  booking: Booking, ruleId: string | null, ruleCode: string, templateBody: string, tx: Tx = prisma,
  opts: { scheduledAt?: Date; dedupKey?: string } = {},
) {
  const dedupKey = opts.dedupKey ?? `${ruleCode}:${booking.id}`;
  const client = booking.clientId ? await tx.client.findUnique({ where: { id: booking.clientId } }) : null;
  if (!client && !booking.contactPhone) return null; // отправлять некуда
  const renderedText = renderTemplate(templateBody, { booking, client });
  try {
    return await tx.outbox.create({ data: { ruleId, bookingId: booking.id, clientId: booking.clientId, channel: client?.messenger ?? "WHATSAPP", templateCode: ruleCode, renderedText, scheduledAt: opts.scheduledAt ?? new Date(), dedupKey } });
  } catch (e) {
    // два тика одновременно: уникальный dedupKey — и есть защита от дубля
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

// в onStatusChanged:
const delayMs = Number(p.delayHours ?? 0) * 3_600_000;
await enqueue(booking, rule.id, rule.code, rule.template.body, tx, {
  scheduledAt: new Date(Date.now() + delayMs),
  dedupKey: p.dedupGroup ? `${p.dedupGroup}:${booking.id}` : undefined,
});
```

- **src/server/services/bookings.ts** — Строки 99-152: вынести тело в приватную applyTransition(tx, b, to, actor: SessionUser | null, opts), публичная transition остаётся прежней (читает бронь, проверяет canTransition, зовёт applyTransition). Добавить systemTransition с блокировкой строки и проверкой исходного статуса. Строки 195-197: отменять только сообщения, чей момент ещё не наступил, и освобождать dedupKey при отмене. Строки 319-325 (updateBooking): при смене dateFrom/timeFrom ставить datesChangedAt.

```
async function applyTransition(tx: Prisma.TransactionClient, b: Booking, to: BookingStatus, actor: SessionUser | null, opts: { reason?: string; at?: Date } = {}) {
  /* нынешнее тело transition, строки 105-150, с userId: actor?.id ?? null в ленте и журнале */
}

export async function transition(bookingId: string, to: BookingStatus, actor: SessionUser, opts: { reason?: string; at?: Date } = {}) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (!canTransition(b.status, to, actor)) throw new BookingError(`Переход «${STATUS_LABEL[b.status]}» → «${STATUS_LABEL[to]}» недопустим`);
    return applyTransition(tx, b, to, actor, opts);
  });
}

// Системный переход без пользователя (авто «Не приехал»): права не проверяем — проверять некого,
// но сам переход обязан быть разрешён общей таблицей TRANSITIONS.
export async function systemTransition(bookingId: string, to: BookingStatus, opts: { from: BookingStatus[]; reason: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    // статус мог измениться руками между сканом и переходом
    if (!opts.from.includes(b.status) || !TRANSITIONS[b.status].includes(to)) return null;
    return applyTransition(tx, b, to, null, { reason: opts.reason });
  });
}

async function cancelPendingOutbox(bookingId: string, tx: Prisma.TransactionClient) {
  // Сообщение, чей момент уже наступил, отменять нельзя: «вы не приехали» ставится за 24 ч до автоперехода.
  // dedupKey освобождается, иначе возврат брони к прежним датам больше не создаст сообщение.
  await tx.$executeRaw`UPDATE "Outbox" SET status = 'CANCELLED', "dedupKey" = 'cancelled:' || id
                       WHERE "bookingId" = ${bookingId} AND status = 'PENDING' AND "scheduledAt" > now()`;
}
```

- **src/server/services/settings.ts** — Добавить блок настроек планировщика рядом с SETTINGS (строки 5-10) и читалку automationSettings(). Значение activatedAt хранится строкой ISO в том же Setting.value (Json), поэтому нужен помощник str() рядом с num() (строки 19-22).

```
export const AUTOMATION = {
  enabled: { key: "automations.enabled", def: false, label: "Сообщения и автопереходы по времени" },
  dryRun: { key: "automations.dryRun", def: true, label: "Только считать, ничего не отправлять" },
  reminderHours: { key: "automations.reminderHours", def: 24, label: "Напоминание за, ч" },
  noticeHours: { key: "automations.noticeHours", def: 24, label: "«Вы не приехали» через, ч" },
  releaseHours: { key: "automations.releaseHours", def: 48, label: "Освобождение места через, ч" },
  thanksDelayHours: { key: "automations.thanksDelayHours", def: 2, label: "«Спасибо» после выезда через, ч" },
  maxAgeHours: { key: "automations.maxAgeHours", def: 6, label: "Не отрабатывать моменты старше, ч" },
  activatedAt: { key: "automations.activatedAt", def: "", label: "Включено" }, // ISO, ставится при включении выключателя
} as const;
```

- **prisma/schema.prisma** — Две добавляющие миграции. Первая — только значения enum: AutomationTrigger + AFTER_PLANNED_CHECKIN и BOOKING_CHANGED (строки 116-121), NoticeKind + AUTOMATION_BACKLOG (строки 53-58). Вторая — поля: Booking.datesChangedAt DateTime? (модель, строки 288-347). Использовать новые значения enum в той же миграции нельзя.

```
enum AutomationTrigger {
  STATUS_CHANGED
  BEFORE_CHECKIN
  BEFORE_CHECKOUT
  AFTER_CHECKOUT
  AFTER_PLANNED_CHECKIN // «вы не приехали» и автоосвобождение места
  BOOKING_CHANGED
}

model Booking {
  // когда в последний раз меняли даты или время: напоминание считается от более позднего из createdAt и этого поля
  datesChangedAt DateTime?
}
```

- **prisma/seed.ts** — Строки 103-118: правило no_show_notice (AFTER_PLANNED_CHECKIN, hoursAfter 24) с шаблоном из ТЗ п. 2; before_checkin_24h — текст на редакцию 2 из docs/MESSAGE_TEMPLATES_2026-09-22.md; thanks_review — STATUS_CHANGED со status CHECKED_OUT и delayHours 2; on_awaiting_payment и on_confirmed получают dedupGroup "confirmation"; before_checkout_2d и after_checkout_7d выключить (isActive: false) — скидку заказчик не утверждал.

```
{ code: "no_show_notice", name: "Через 24 ч после планового заезда → «вы не приехали»", trigger: "AFTER_PLANNED_CHECKIN", triggerParams: { hoursAfter: 24 }, templateId: ids.no_show_notice, sync: true },
{ code: "thanks_review", name: "Через 2 ч после выезда → спасибо и отзыв", trigger: "STATUS_CHANGED", triggerParams: { status: "CHECKED_OUT", delayHours: 2 }, templateId: ids.thanks_review, sync: true },
{ code: "on_awaiting_payment", …, triggerParams: { status: "AWAITING_PAYMENT", dedupGroup: "confirmation" }, sync: true },
```

- **src/instrumentation.ts** — НОВЫЙ файл (корень src, как требует node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md). register() запускается один раз на инстанс сервера и должен завершиться до приёма запросов — значит внутри только setInterval, без ожидания первого тика. Обязательны проверка NEXT_RUNTIME === "nodejs" (иначе тик заведётся и в edge-рантайме) и флаг в globalThis, чтобы горячая перезагрузка в dev не плодила таймеры. Сам тик — динамический импорт сканера, try/catch на каждый тик, никакого revalidatePath.

```
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_SCHEDULER !== "1") return;
  const g = globalThis as { p24Tick?: NodeJS.Timeout };
  if (g.p24Tick) return;
  g.p24Tick = setInterval(async () => {
    try {
      const { tickTimed } = await import("@/server/automations/scanner");
      await tickTimed();
    } catch (e) { console.error("[scheduler]", e); }
  }, 60_000);
}
```

- **src/app/api/cron/automations/route.ts** — НОВЫЙ роут для внешнего вызова тика (и для e2e-теста): проверка заголовка X-Cron-Secret против CRON_SECRET, runtime nodejs, dynamic force-dynamic — как в src/app/api/public/lead/route.ts:7-8. Возвращает счётчики tickTimed, чтобы dry-run можно было посмотреть глазами.

```
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await tickTimed()) });
}
```

- **src/app/admin/(app)/bookings/[id]/page.tsx** — Строка 183: `fmtDate(o.scheduledAt, { … hour, minute })` печатает время в UTC — fmtDate жёстко задаёт timeZone "UTC" (dates.ts:37-40), потому что рассчитан на DATE-колонки. Запланированное сообщение показывается на 3 часа раньше московского. Заменить на fmtDateTime, как уже сделано в clients/[id]/page.tsx:191.

```
`запланировано ${fmtDateTime(o.scheduledAt)}`
```


### Риски

- **Риск:** Автопереход в «Не приехал» отменяет ещё не отправленное сообщение «вы не приехали». Оно ставится в очередь за 24 часа до перехода, а отправщика пока нет — сообщение всё это время лежит PENDING, и transition() на NO_SHOW переводит его в CANCELLED (bookings.ts:148 → :195-197). Клиент не получит ничего, а в карточке будет выглядеть как «система передумала».
  **Что делаем:** Отменять только сообщения, чей момент ещё не наступил (`scheduledAt > now()`), и опираться на предохранитель отправщика «не слать сообщения старше N часов» (план §6). Тест на это обязателен.
- **Риск:** Лавина на первом запуске: на stage и в демо-данных есть брони в AWAITING_PAYMENT/NEW с датами в прошлом (prisma/seed.ts:133-143). Без нижней границы времени первый же тик разошлёт по ним «вы не приехали» и переведёт их в NO_SHOW, разом освободив места и завалив колокольчик.
  **Что делаем:** floor = max(activatedAt, now − maxAgeHours) в чистой функции dueAction, выключатель по умолчанию выключен, dryRun по умолчанию включён, take: 50 на тик; пропущенный хвост — одно уведомление в колокольчик, а не рассылка.
- **Риск:** Гонка двух тиков. enqueue проверяет dedupKey отдельным findUnique и потом создаёт запись (dispatcher.ts:25-29) — при двух параллельных тиках (или тике одновременно с экшеном администратора) вторая вставка падает с P2002 и роняет весь тик; у автоперехода в READ COMMITTED оба тика могут увидеть AWAITING_PAYMENT и сделать переход дважды.
  **Что делаем:** Перехватывать P2002 и считать это «уже стоит в очереди»; в systemTransition брать строку брони SELECT … FOR UPDATE и перепроверять статус внутри транзакции (приём уже применён в autoconfirm.ts:21-23).
- **Риск:** Ключ дедупликации занят отменённой записью. dedupKey уникален глобально (schema.prisma:454) и остаётся на строках со статусом CANCELLED. Если администратор передвинул даты (старое сообщение отменено), а потом вернул прежние — ключ совпадёт со старым, и напоминание молча не создастся.
  **Что делаем:** При отмене освобождать ключ: `SET status='CANCELLED', "dedupKey" = 'cancelled:' || id` (одним $executeRaw, Prisma updateMany выражения от поля не умеет).
- **Риск:** Бронь, созданную давно и передвинутую администратором на «через два часа», проверка по createdAt пропустит, и клиент получит бессмысленное «завтра ждём вас» через минуту после разговора с администратором.
  **Что делаем:** Необязательное поле Booking.datesChangedAt, которое ставит updateBooking при смене дат или времени; напоминание считать от max(createdAt, datesChangedAt).
- **Риск:** Запланированное время в карточке брони показывается в UTC (page.tsx:183 через fmtDate с timeZone "UTC"). Проверяя этап 2 на stage, легко решить, что сканер считает моменты на 3 часа неверно, и «починить» правильный расчёт.
  **Что делаем:** Заменить на fmtDateTime (Europe/Moscow), как в карточке клиента (clients/[id]/page.tsx:191), и добавить в юнит-тесты проверку формата.
- **Риск:** Брони без телефона и без клиента (заявка с сайта, где телефон не распознан — leads.ts:69-71) породят Outbox-записи, которые никто никогда не отправит, и они будут висеть PENDING, мешая читать очередь.
  **Что делаем:** Отсеивать `contactPhone: null` в запросе сканера и дополнительно проверять в enqueue; таким броням место освобождается автопереходом, но сообщение не ставится.
- **Риск:** Тик из instrumentation.ts запускается на каждый инстанс сервера: в dev register() вызывается и для edge-рантайма, при горячей перезагрузке таймеры накапливаются, а при будущем масштабировании web-контейнера тиков станет несколько.
  **Что делаем:** Проверка NEXT_RUNTIME === "nodejs", флаг в globalThis, переменная RUN_SCHEDULER; идемпотентность сканера (dedupKey + FOR UPDATE) делает лишние тики безвредными.
- **Риск:** Несуществующее или неоднозначное настенное время при смене часового пояса стоянки: 02:30 в ночь перевода стрелок вперёд не существует, а осенью бывает дважды. В России перевода нет, но зона — настройка, и правило должно быть записано, а не обнаружено потом.
  **Что делаем:** Зафиксировать поведение двухпроходного zonedToUtc в комментарии и тесте: несуществующее время сдвигается вперёд на час, неоднозначное берётся по зимнему времени (проверено на Europe/Berlin 2026-03-29 и 2026-10-25).

### Что покрыть тестами

- zonedToUtc: Москва 2026-10-01 12:00 → 2026-10-01T09:00Z; 00:00 → 2026-09-30T21:00Z; без времени подставляется 12:00 (DEFAULT_TIME из periods.ts)
- zonedToUtc на зоне с переводом часов (Europe/Berlin): 2026-03-29 01:30 → 00:30Z, 03:30 → 01:30Z, несуществующее 02:30 сдвигается на 03:30, неоднозначное 2026-10-25 02:30 → 01:30Z — правило зафиксировано тестом, а не догадкой
- plannedArrival от брони, прочитанной из @db.Date (Date в полночь UTC): дата не уезжает на сутки ни при timeFrom "00:00", ни при null
- dueAction: границы ровно на 24 ч до заезда, 24 ч и 48 ч после (проверить ±1 минуту вокруг каждой) — раньше срока null, в срок нужное действие
- dueAction: бронь, созданная позже момента «за 24 часа», напоминания не получает; она же получает «вы не приехали» и освобождение места
- dueAction: knownSinceMs берётся как максимум из createdAt и datesChangedAt — перенос дат на «через два часа» напоминание отменяет
- dueAction с floorMs: момент, наступивший раньше включения планировщика или старше maxAgeHours, возвращает null для всех трёх действий (защита от лавины на старых бронях)
- dedupKey: повторный тик даёт тот же ключ (второй записи нет), смена dateFrom или timeFrom ключ меняет (сообщение уходит заново), у on_awaiting_payment и on_confirmed ключ общий — подтверждение уходит один раз
- enqueue проглатывает P2002 и возвращает null, не роняя тик; не создаёт запись для брони без клиента и телефона
- systemTransition: из AWAITING_PAYMENT и CONFIRMED переводит в NO_SHOW, из CHECKED_IN и CANCELLED не делает ничего и возвращает null; в Interaction и AuditLog userId = null; noShowAt проставлен
- cancelPendingOutbox не отменяет сообщение, чей scheduledAt уже наступил (сценарий: «вы не приехали» в очереди → через 24 ч автопереход в «Не приехал» → сообщение осталось PENDING)
- e2e на stage (tests/e2e/, по образцу autoconfirm.mjs): бронь с заездом «через 23 часа» → тик через /api/cron/automations с X-Cron-Secret → в карточке одно напоминание; повторный тик второго не создаёт; бронь с заездом 49 часов назад → «вы не приехали» плюс статус «Не приехал» и освобождённое место
- tickTimed в режиме dryRun ничего не создаёт и не меняет статусы, но возвращает те же счётчики, что и боевой прогон


## Шаблоны и рендер: как тексты попадают в базу и в сообщение

renderTemplate переписывается на построчную отрисовку: пробелы и табы внутри строки схлопываются, переносы и пустые строки между абзацами сохраняются, а строка, набранная из одних переменных, которые оказались пустыми, исчезает целиком. Новые переменные считаются в чистой функции (дата+время склеиваются вручную, потому что ru-Intl с month:"long" даёт «1 октября в 14:32»), а условные строки (трансфер, доплата, договор) хранятся отдельными шаблонами `line_*` в той же таблице MessageTemplate — заказчик правит их в CRM наравне с текстами. Проблема имени решается переменными-обращениями `{{client.hello}}` и `{{client.dear}}`, дедупликация подтверждения — `dedupGroup` в triggerParams, но главный подводный камень в том, что seed сейчас вообще не обновляет `triggerParams` существующих правил (seed.ts:115), поэтому на stage dedupGroup молча не применится.


### Решения

**1. Точная замена регулярного выражения в renderTemplate**

Отрисовывать построчно вместо одного прохода по всему тексту. Вместо `.replace(/\s{2,}/g, " ").replace(/ ,/g, ",").trim()`:

```ts
const PH = /\{\{\s*([\w.]+)\s*\}\}/g;

export function renderTemplate(body: string, ctx: RenderCtx): string {
  const vars = buildVars(ctx);
  return body
    .split("\n")
    .map((src) => {
      const out = tidy(src.replace(PH, (_, k: string) => vars[k] ?? ""));
      // строка из одних переменных, которые оказались пустыми, исчезает целиком — иначе в сообщении дырка
      return out === "" && src.trim() !== "" ? null : out;
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tidy(line: string): string {
  return line
    .replace(/[ \t]+/g, " ")        // пробелы и табы, перенос не трогаем
    .replace(/ +([,.!?;:])/g, "$1") // «Здравствуйте, !» → «Здравствуйте,!»
    .replace(/,+(?=[.!?])/g, "")    // → «Здравствуйте!»
    .trim();
}
```

Почему именно так, а не одна регулярка: заменить `\s{2,}` на `[^\S\n]{2,}` недостаточно — останутся пустые строки от условных переменных («Маршрут: …\n\n\nСоветуем») и висячие пробелы в начале строк. Разбор по строкам решает обе задачи и заодно даёт точное правило «строка была не пустой в шаблоне, а стала пустой → убрать», которое одной регуляркой не выразить.

ВАЖНО: в `tidy` именно `[ \t]`, а не `\s` — `\s` в JS ловит неразрывный пробел U+00A0, а Intl.NumberFormat('ru-RU') разделяет тысячи именно им («2 800 ₽»).

ПРОВЕРЕНО на прототипе (/private/tmp/.../scratchpad/proto.mjs, proto2.mjs).

ДО (текущий код, сообщение 1): «Здравствуйте, Иван Петров! Это парковка «Питстоп» у Шереметьево. Ваше место забронировано, бронь №142.\nЗаезд: 1 октября, 12:00\n…\nСтоимость: 2 800 ₽ за 8 суток сут. Предоплата не нужна: оплатите на месте…» — абзацы склеены, часть переносов пережила только потому, что после них шёл один пробел.

ПОСЛЕ: структура сохранена дословно, 686 символов.

ДО/ПОСЛЕ для исчезающей строки (transferLine пустой): было бы «Маршрут: https://…\n\n\nСоветуем приехать» → стало «Маршрут: https://…\n\nСоветуем приехать» (ровно одна пустая строка между абзацами).

ДО/ПОСЛЕ для dueLine внутри абзаца: «Бронь №142, заезд 1 октября, 12:00.\n{{booking.dueLine}}\nВозьмите с собой СТС» при пустом dueLine → «…12:00.\nВозьмите с собой СТС» без дырки.

Оба существующих теста в tests/unit/render.test.ts проходят без правок (проверено): однострочные шаблоны новый код не меняет, а «{{client.name}} {{client.phone}} {{unknown.var}}» по-прежнему даёт «Иван +79055250660».

**2. Как считать новые переменные и где брать ссылки**

Все переменные — в чистой функции `buildVars(ctx)` внутри render.ts, без обращений к базе (иначе юнит-тесты потребуют Postgres). Данные, которых нет в Booking, приходят в контексте из dispatcher.

- **booking.arrival / booking.departure** = `fmtDayTime(dateFrom, timeFrom)` / `fmtDayTime(dateTo, timeTo)`. Новая функция в src/server/lib/dates.ts:
  ```ts
  // «1 октября, 12:00» — ru-Intl с month:"long" и временем даёт «1 октября в 14:32», поэтому склеиваем сами
  export function fmtDayTime(d: Date | string, time?: string | null): string {
    const hhmm = time && /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_TIME;
    return `${fmtDate(d, { day: "numeric", month: "long" })}, ${hhmm}`;
  }
  ```
  Часовой пояс здесь не нужен: `dateFrom`/`dateTo` — это `@db.Date` (UTC-полночь), `fmtDate` уже форматирует их в timeZone UTC (dates.ts:39), а `timeFrom`/`timeTo` — строки «12:00» и изначально московские. DEFAULT_TIME = "12:00" уже есть в src/lib/periods.ts:5.
- **booking.days** = `${days} ${plural(days, "сутки", "суток", "суток")}`, `plural` из src/lib/tariffs.ts:68 (склонение уже покрыто тестом tests/unit/plural.test.ts: 1 сутки / 3 суток / 21 сутки). Брать `b.actualDays ?? b.days`, чтобы сообщение 4 после досрочного выезда называло фактические сутки. ВНИМАНИЕ: в docs/MESSAGE_TEMPLATES_2026-09-22.md:29 строка «за {{booking.days}} сут.» — «сут.» надо убрать из текста, иначе выйдет «за 8 суток сут.».
- **booking.contract** = `b.contractNumber ? String(b.contractNumber).padStart(3, "0") : ""`. Поля `contractNumber` в схеме ЕЩЁ НЕТ (prisma/schema.prisma, модель Booking, строки 288–347) — его добавляет этап 2 по плану (docs/TZ_2026-09-21_PLAN.md:61). Номер брать из отдельной последовательности Postgres (`CREATE SEQUENCE booking_contract_seq`, `nextval` в той же транзакции перехода в CHECKED_IN), а не `max+1`: `Booking.number` уже живёт на autoincrement, гонок не будет.
- **booking.checkedInAt** = `fmtMoscow(b.checkedInAt)`, новая функция в dates.ts (день и время собираются двумя Intl-вызовами по той же причине — «в» между ними):
  ```ts
  export function fmtMoscow(d: Date): string {
    const opt = { timeZone: "Europe/Moscow" } as const;
    const day = new Intl.DateTimeFormat("ru-RU", { ...opt, day: "numeric", month: "long" }).format(d);
    const time = new Intl.DateTimeFormat("ru-RU", { ...opt, hour: "2-digit", minute: "2-digit" }).format(d);
    return `${day}, ${time}`;
  }
  ```
- **booking.dueLine** = сумма к доплате `due = Math.max(0, b.amount - b.paidAmount)`; `due > 0` → шаблон `line_due_open` («К оплате на месте: {{booking.due}} ₽, наличными или картой.»), иначе `line_due_paid` («Бронь оплачена.»).
- **booking.transferLine / booking.returnLine** = по `b.transferNeeded` (Booking.transferNeeded, schema.prisma:312; ставится при `days >= 4` в bookings.ts:66 и правится администратором вручную) → шаблоны `line_transfer_yes|no`, `line_return_yes|no`.
- **links.route / links.review** — ключи `links.route`, `links.review` в таблице Setting (docs/TZ_2026-09-21_PLAN.md:68). В src/server/services/settings.ts их нет: сейчас там только четыре числовых/булевых ключа, а `setSetting` принимает `number | boolean` (settings.ts:38) — нужен строковый вариант и хелпер `str()`. Пока заказчик не дал ссылки, значения по умолчанию берём с собственного сайта: `${NEXT_PUBLIC_SITE_URL}/#directions` и `/#reviews` (якоря существуют: src/app/page.tsx, `id="directions"`, `id="reviews"`) — иначе в сообщении останется голое «Маршрут:».

КЛЮЧЕВОЕ АРХИТЕКТУРНОЕ РЕШЕНИЕ: тексты условных строк НЕ хардкодим в render.ts, а держим отдельными строками в MessageTemplate с кодами `line_*`. Тогда заказчик правит их на той же странице «Шаблоны сообщений», что и сами сообщения. renderTemplate остаётся чистой функцией и получает их готовым словарём:
```ts
export type RenderCtx = {
  booking: Booking; client: Client | null;
  links?: { route?: string; review?: string };
  lines?: Record<string, string>; // тексты условных строк по коду шаблона
};
```
Подстановка в снипет — один проход тем же `PH`, без рекурсии (снипет не может ссылаться на другой снипет):
```ts
const line = (code: string) => tidy((lines[code] ?? "").replace(PH, (_, k: string) => v[k] ?? ""));
v["booking.dueLine"] = line(due > 0 ? "line_due_open" : "line_due_paid");
v["booking.transferLine"] = line(b.transferNeeded ? "line_transfer_yes" : "line_transfer_no");
v["booking.returnLine"] = line(b.transferNeeded ? "line_return_yes" : "line_return_no");
v["booking.payLine"] = line(due > 0 ? "line_pay_none" : "line_pay_done");
v["booking.contractLine"] = b.contractNumber ? line("line_contract") : "";
```
Загружает `lines` и `links` диспетчер (один findMany по `code: { startsWith: "line_" }` и один parkingSettings) и передаёт в renderTemplate — это контракт к соседней задаче по dispatcher.ts.

ЕЩЁ: `booking.amount` сейчас `String(booking.amount)` = «12600». Суммы в сообщениях лучше группировать: `new Intl.NumberFormat("ru-RU").format(n)` → «12 600» (разделитель U+00A0, `tidy` его не трогает). Это меняет ожидание в tests/unit/render.test.ts:15 («1050 ₽» → «1 050 ₽») — правка на одну строку, но сделать её надо осознанно.

**3. Пустое имя клиента: «Здравствуйте, !» и «, напоминаем»**

Механизм: переменная-обращение целиком, две штуки, обе редактируемые заказчиком через текст шаблона (он видит `{{client.hello}}`, а не голое `{{client.name}}`).

```ts
const name = (client?.name || b.contactName || "").trim();
"client.name": name,                                             // остаётся для совместимости
"client.hello": name ? `Здравствуйте, ${name}!` : "Здравствуйте!",
"client.dear":  name ? `${name},` : "Здравствуйте,",
```

В шаблонах:
- сообщение 1: `{{client.hello}} Это парковка «Питстоп» у Шереметьево.` → «Здравствуйте, Иван Петров! Это парковка…» / «Здравствуйте! Это парковка…»;
- сообщения 2, 3, 4: `{{client.dear}} напоминаем: завтра ждём вас…` → «Иван, напоминаем: …» / «Здравствуйте, напоминаем: …». Обе формы грамматичны, предложение не начинается со строчной буквы.

Почему не условные блоки `{{#client.name}}…{{/client.name}}`: заказчик правит тексты руками в CRM, парные теги он сломает первой же правкой, а сломанный тег молча уедет клиенту.

Почему не только регулярка: `tidy` действительно чинит «Здравствуйте, !» → «Здравствуйте!» (правила ` +([,.!?;:])` и `,+(?=[.!?])`), и это полезная страховка на случай, если заказчик всё-таки напишет `{{client.name}}` руками. Но случай «{{client.name}}, напоминаем» она не чинит: получается «, напоминаем: завтра…» (проверено). Убирать ведущую запятую регуляркой нельзя — останется «напоминаем» со строчной буквы. Поэтому регулярка — страховка, а решение — переменная.

ПРЕДПОСЫЛКА, которой сейчас нет: страница /admin/settings/templates ссылается из src/app/admin/(app)/settings/page.tsx:10, но каталога нет — сегодня это 404, заказчик тексты править не может вообще. Для этапа 2 страницу надо сделать (список шаблонов, textarea, палитра переменных с подсказкой и предпросмотром на демо-брони, отдельная группа «Строки внутри сообщений» для кодов `line_*`).

**4. Какие правила автоматизации нужны в seed**

| code | trigger | triggerParams | шаблон | комментарий |
|---|---|---|---|---|
| on_new_lead | STATUS_CHANGED | `{status:"NEW", source:"SITE"}` | new_lead_reply | как есть, для заявок, не решившихся автоматически (фуры, автоподтверждение выключено) |
| on_awaiting_payment | STATUS_CHANGED | `{status:"AWAITING_PAYMENT", dedupGroup:"confirmation"}` | **booking_confirmed** | текст 1; переводим с шаблона awaiting_payment на общий |
| on_confirmed | STATUS_CHANGED | `{status:"CONFIRMED", dedupGroup:"confirmation"}` | **booking_confirmed** | тот же текст; уйдёт только если подтверждения ещё не было (см. п. 5) |
| on_rejected_no_space | STATUS_CHANGED | `{status:"REJECTED", rejectKind:"NO_SPACE", dedupGroup:"rejection"}` | rejected_no_space | ТЗ п. 1.2 |
| on_rejected_other | STATUS_CHANGED | `{status:"REJECTED", rejectKind:"OTHER", dedupGroup:"rejection"}` | rejected_other | ТЗ п. 2, «Отклонение заявки» |
| before_checkin_24h | BEFORE_CHECKIN | `{hoursBefore:24, keyBy:"plannedArrival"}` | reminder_24h | текст 2; не ставить, если бронь создана позже момента отправки |
| on_checked_in | STATUS_CHANGED | `{status:"CHECKED_IN"}` | checked_in | текст 3, с номером договора |
| after_planned_checkin_24h | AFTER_PLANNED_CHECKIN | `{hoursAfter:24, statuses:["AWAITING_PAYMENT","CONFIRMED"]}` | no_show_ask | «вы не приехали»; через 48 ч отдельный системный автопереход в NO_SHOW (не правило) |
| on_booking_changed | BOOKING_CHANGED | `{fields:["dateFrom","dateTo","timeFrom","timeTo"], keyBy:"plannedArrival"}` | booking_changed | ТЗ п. 1.3 и п. 2 |
| after_checkout_2h | AFTER_CHECKOUT | `{hoursAfter:2}` | thanks_review | текст 4, через 2 часа после выезда |
| before_checkout_2d | — | — | — | **isActive: false** — продления в ТЗ нет |
| after_checkout_7d | — | — | — | **isActive: false** — скидка 10 % не утверждена |

Шаблоны: `booking_confirmed` (перезаписывается текстом 1), `reminder_24h` (текст 2), `checked_in`, `thanks_review`, `rejected_no_space`, `rejected_other`, `no_show_ask`, `booking_changed`, `new_lead_reply` (как есть); `awaiting_payment`, `extension_offer`, `thanks_discount` → `isActive: false`. Плюс снипеты `line_transfer_yes`, `line_transfer_no`, `line_return_yes`, `line_return_no`, `line_due_open`, `line_due_paid`, `line_pay_none`, `line_pay_done`, `line_contract`.

ЧТО ПРИДЁТСЯ ДОБАВИТЬ РЯДОМ (контракт к задаче по dispatcher.ts):
- `AutomationTrigger` + `BOOKING_CHANGED`, `AFTER_PLANNED_CHECKIN` (отдельной миграцией, план §3);
- `onStatusChanged` сейчас сверяет только `status` и `source` (dispatcher.ts:15-17) — нужен разбор `rejectKind`, иначе оба правила отклонения сработают на одну бронь (спасёт только dedupGroup, но клиент получит случайный из двух текстов);
- `AFTER_CHECKOUT` в существующем правиле считает `daysAfter`, для текста 4 нужен `hoursAfter`.

**5. Механизм dedupGroup при уникальном Outbox.dedupKey**

Ключ собирается не из кода правила, а из группы:

```ts
// dispatcher.ts
type TriggerParams = { status?: string; source?: string; rejectKind?: string; dedupGroup?: string; keyBy?: string };

const group = p.dedupGroup ?? rule.code;
const suffix = p.keyBy === "plannedArrival" ? `:${plannedArrivalKey(booking)}` : ""; // 2026-10-01T12:00
const dedupKey = `${group}:${booking.id}${suffix}`;
```

`templateCode` в Outbox по-прежнему пишем равным `rule.code` — администратор в карточке брони видит, какое именно правило сработало, а группа живёт только в ключе.

Сценарий, ради которого всё затевается: автоподтверждение создаёт бронь сразу в AWAITING_PAYMENT → `on_awaiting_payment` кладёт в Outbox `confirmation:<bookingId>`. Клиент приезжает, платит, бронь переходит в CONFIRMED → `on_confirmed` пытается положить `confirmation:<bookingId>`, находит существующую запись и выходит (dispatcher.ts:25-26). Второго «бронь подтверждена, до встречи» у ворот не будет.

ТРИ ДЫРЫ, которые надо закрыть вместе с этим:

1. **Текст один на два статуса.** Сообщение 1 содержит «Предоплата не нужна: оплатите на месте при заезде». Если бронь заводит администратор сразу оплаченной (CONFIRMED, минуя AWAITING_PAYMENT), этот текст врёт. Решение — не второй шаблон, а условная строка `{{booking.payLine}}`: не оплачено → «Предоплата не нужна: оплатите на месте при заезде, наличными или картой.», оплачено → «Бронь оплачена, при заезде платить ничего не нужно.»

2. **CANCELLED занимает ключ.** `cancelPendingOutbox` (bookings.ts:195-197) не удаляет запись, а ставит ей status = CANCELLED, ключ остаётся занят. Переход «Отклонена» → «Ожидает оплаты» (разрешён, labels.ts TRANSITIONS.REJECTED) после этого уже не отправит подтверждение. Лечится в enqueue:
```ts
const exists = await tx.outbox.findUnique({ where: { dedupKey } });
if (exists && exists.status !== "CANCELLED") return null;
if (exists) return tx.outbox.update({ where: { dedupKey }, data: { status: "PENDING", renderedText, scheduledAt, attempts: 0, lastError: null } });
```
Важно: оживлять только CANCELLED. FAILED оживлять нельзя — иначе сломанный номер будет долбиться вечно.

3. **Гонка check-then-act.** `findUnique` + `create` (dispatcher.ts:25-29) не атомарны: два параллельных перехода пройдут проверку оба, второй упадёт на уникальном индексе. Create обернуть в try/catch и молча глотать Prisma P2002 — именно этого мы и хотели.

**6. Как seed обновляет тексты, не затирая правки заказчика**

КАК РАБОТАЕТ СЕЙЧАС (prisma/seed.ts:97-118):
- шаблоны: `upsert(update: sync ? { name, body } : {})`. `sync: true` → seed перезаписывает текст при КАЖДОМ `npm run db:seed`, правки заказчика гибнут. Без `sync` → строка создаётся один раз и больше никогда не обновляется. Середины нет.
- правила: `update: sync ? { name, templateId, isActive: true } : {}`. Здесь ДВЕ ошибки для этапа 2: `trigger` и `triggerParams` не обновляются никогда (то есть `dedupGroup` на stage просто не появится), а `isActive: true` в sync-ветке возвращает к жизни правило, которое администратор осознанно выключил.

ЧТО СДЕЛАТЬ:

1. Добавить `MessageTemplate.seedBody String?` — добавляющая миграция, правило плана §3 соблюдено. Это «последний текст, который предлагал seed».
2. Логика на шаблон:
```ts
const row = await prisma.messageTemplate.findUnique({ where: { code: t.code } });
if (!row) { create({ ...data, seedBody: data.body }); }
else if (row.seedBody === null || row.seedBody === row.body) {
  // заказчик текст не трогал — обновляем
  update({ name: data.name, body: data.body, seedBody: data.body });
} else if (row.seedBody !== data.body) {
  // у заказчика своя редакция: текст не трогаем, но запоминаем новое предложение и говорим об этом
  update({ seedBody: data.body });
  notify("CHANNEL_DOWN"→нужен новый NoticeKind, `Шаблон «${data.name}» обновлён в коде, у вас своя редакция`);
}
```
   `seedBody === null` (все существующие строки) трактуем как «не правил» — и это не допущение: страницы /admin/settings/templates сегодня нет (404), править тексты было негде.
3. Для правил: seed всегда владеет структурой (`name`, `trigger`, `triggerParams`, `templateId`), `isActive` ставится только при создании. Разовое выключение `before_checkout_2d` и `after_checkout_7d` делаем под маркером, чтобы администратор мог включить их обратно и seed не переспорил:
```ts
const mark = await prisma.setting.findUnique({ where: { key: "seed.rulesOutOfScopeDisabled" } });
if (!mark) {
  await prisma.automationRule.updateMany({ where: { code: { in: ["before_checkout_2d", "after_checkout_7d"] } }, data: { isActive: false } });
  await prisma.setting.create({ data: { key: "seed.rulesOutOfScopeDisabled", value: true } });
}
```
4. Снипеты `line_*` заводятся тем же механизмом — заказчик правит их наравне с сообщениями.

**Готовые тексты шаблонов с переменными**

**booking_confirmed** (правила on_awaiting_payment и on_confirmed):
```
{{client.hello}} Это парковка «Питстоп» у Шереметьево.

Ваше место забронировано, бронь №{{booking.number}}.
Заезд: {{booking.arrival}}
Выезд: {{booking.departure}}
Автомобиль: {{booking.vehicle}}
Стоимость: {{booking.amount}} ₽ за {{booking.days}}

{{booking.payLine}}
При оформлении понадобятся СТС и водительское удостоверение.

Адрес: Московская область, г.о. Химки, с. Чашниково.
Маршрут: {{links.route}}
{{booking.transferLine}}

Советуем приехать на парковку за 3 часа до вылета.
Если планы изменятся, ответьте на это сообщение или позвоните: +7 905 525-06-60. Мы на связи круглосуточно.
```

**reminder_24h**:
```
{{client.dear}} напоминаем: завтра ждём вас на парковке «Питстоп».

Бронь №{{booking.number}}, заезд {{booking.arrival}}.
{{booking.dueLine}}
Возьмите с собой СТС и водительское удостоверение.

Приезжайте за 3 часа до вылета: оформление на ресепшене займёт несколько минут, до терминалов 3–5 минут езды.
Адрес: Московская область, г.о. Химки, с. Чашниково.
Маршрут: {{links.route}}

Задерживаетесь или планы изменились? Ответьте на это сообщение или позвоните: +7 905 525-06-60, круглосуточно.
```

**checked_in** (номер договора вынесен отдельной строкой — если он почему-то не присвоен, строка исчезнет целиком, а не оставит «договор №»):
```
{{client.dear}} автомобиль принят на стоянку. Спасибо, что выбрали «Питстоп»!

Бронь №{{booking.number}}
{{booking.contractLine}}
Автомобиль: {{booking.vehicle}}
Принят: {{booking.checkedInAt}}
Плановый выезд: {{booking.departure}}

{{booking.returnLine}}
Вернётесь раньше или позже срока? Сообщите нам, стоимость пересчитаем по фактическим суткам.

Хорошего полёта!
```

**thanks_review**:
```
{{client.dear}} спасибо, что доверили нам автомобиль! Надеемся, поездка прошла хорошо.

Будем благодарны за отзыв, это займёт минуту: {{links.review}}
Если что-то было не так, напишите нам прямо сюда, мы разберёмся.

Будем рады видеть вас снова. Забронировать место можно на сайте: {{site.url}}
```

**rejected_no_space** (ТЗ п. 1.2):
```
{{client.hello}} К сожалению, ваша заявка не подтверждена: на выбранные даты ({{booking.dates}}) нет свободных мест.

Будем рады видеть вас в другое время! Напишите другие даты прямо в этот чат или позвоните: +7 905 525-06-60.
```

**rejected_other**:
```
{{client.hello}} К сожалению, ваша заявка №{{booking.number}} отклонена. Будем рады видеть вас в другие даты!

Если это ошибка или хотите подобрать другие даты — ответьте на это сообщение или позвоните: +7 905 525-06-60.
```

**no_show_ask**:
```
{{client.hello}} Мы заметили, что вы не воспользовались бронью №{{booking.number}} на {{booking.arrival}}.

Подскажите, пожалуйста, ваши планы изменились? Будем благодарны за ответ.
Если вы ещё в пути — напишите, место придержим.
```

**booking_changed** (ТЗ п. 1.3):
```
{{client.dear}} ваша бронь №{{booking.number}} изменена.

Новый заезд: {{booking.arrival}}
Новый выезд: {{booking.departure}}
Стоимость: {{booking.amount}} ₽ за {{booking.days}}
{{booking.dueLine}}

Если что-то не так, ответьте на это сообщение или позвоните: +7 905 525-06-60.
```

**Снипеты (коды line_*):**
- `line_transfer_yes`: Трансфер до терминала и обратно для вас бесплатный, дорога занимает 3–5 минут.
- `line_transfer_no`: Бесплатный трансфер действует при стоянке от 4 суток. По вашей брони он оплачивается отдельно, стоимость подскажет администратор.
- `line_return_yes`: Когда прилетите и получите багаж, позвоните или напишите нам: +7 905 525-06-60. Пришлём за вами бесплатный трансфер.
- `line_return_no`: Если понадобится трансфер от терминала, позвоните или напишите нам: +7 905 525-06-60, стоимость подскажем.
- `line_due_open`: К оплате на месте: {{booking.due}} ₽, наличными или картой.
- `line_due_paid`: Бронь оплачена.
- `line_pay_none`: Предоплата не нужна: оплатите на месте при заезде, наличными или картой.
- `line_pay_done`: Бронь оплачена, при заезде платить ничего не нужно.
- `line_contract`: Договор №{{booking.contract}}

Длина сообщения 1 в развёрнутом виде — 686 символов (проверено), лимит Telegram 1 024 не задет.


### Файлы

- **src/server/automations/render.ts** — Переписать целиком: построчная отрисовка вместо `.replace(/\s{2,}/g, " ")`, новые переменные, обращения, условные строки из словаря. Функция остаётся чистой — в базу не ходит.

```
import type { Booking, Client } from "@prisma/client";
import { fmtDate, fmtRange, fmtDayTime, fmtMoscow } from "@/server/lib/dates";
import { VEHICLE_LABEL } from "@/lib/crm/labels";
import { plural } from "@/lib/tariffs";

export type RenderCtx = {
  booking: Booking;
  client: Client | null;
  links?: { route?: string; review?: string };
  // тексты условных строк по коду шаблона (line_transfer_yes и т. д.) — их ведёт заказчик в CRM
  lines?: Record<string, string>;
};

const PH = /\{\{\s*([\w.]+)\s*\}\}/g;
const rub = (n: number) => new Intl.NumberFormat("ru-RU").format(n);

export function renderTemplate(body: string, ctx: RenderCtx): string {
  const vars = buildVars(ctx);
  return body
    .split("\n")
    .map((src) => {
      const out = tidy(src.replace(PH, (_, k: string) => vars[k] ?? ""));
      // строка из одних переменных, которые оказались пустыми, исчезает целиком
      return out === "" && src.trim() !== "" ? null : out;
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// схлопываем только пробелы и табы: \s поймал бы неразрывный пробел из разрядки сумм
function tidy(line: string): string {
  return line.replace(/[ \t]+/g, " ").replace(/ +([,.!?;:])/g, "$1").replace(/,+(?=[.!?])/g, "").trim();
}

function buildVars({ booking: b, client, links = {}, lines = {} }: RenderCtx): Record<string, string> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const name = (client?.name || b.contactName || "").trim();
  const days = b.actualDays ?? b.days;
  const due = Math.max(0, b.amount - b.paidAmount);
  const v: Record<string, string> = {
    "client.name": name,
    "client.phone": client?.phone || b.contactPhone || "",
    "client.hello": name ? `Здравствуйте, ${name}!` : "Здравствуйте!",
    "client.dear": name ? `${name},` : "Здравствуйте,",
    "booking.number": String(b.number),
    "booking.dates": fmtRange(b.dateFrom, b.dateTo),
    "booking.arrival": fmtDayTime(b.dateFrom, b.timeFrom),
    "booking.departure": fmtDayTime(b.dateTo, b.timeTo),
    "booking.days": `${days} ${plural(days, "сутки", "суток", "суток")}`,
    "booking.vehicle": [b.vehicleType ? VEHICLE_LABEL[b.vehicleType] : "", b.plate ?? ""].filter(Boolean).join(" "),
    "booking.amount": rub(b.amount),
    "booking.due": rub(due),
    "booking.contract": b.contractNumber ? String(b.contractNumber).padStart(3, "0") : "",
    "booking.checkedInAt": b.checkedInAt ? fmtMoscow(b.checkedInAt) : "",
    "links.route": links.route || (site && `${site}/#directions`) || "",
    "links.review": links.review || (site && `${site}/#reviews`) || "",
    "site.url": site,
  };
  const line = (code: string) => tidy((lines[code] ?? "").replace(PH, (_, k: string) => v[k] ?? ""));
  v["booking.payLine"] = line(due > 0 ? "line_pay_none" : "line_pay_done");
  v["booking.dueLine"] = line(due > 0 ? "line_due_open" : "line_due_paid");
  v["booking.transferLine"] = line(b.transferNeeded ? "line_transfer_yes" : "line_transfer_no");
  v["booking.returnLine"] = line(b.transferNeeded ? "line_return_yes" : "line_return_no");
  v["booking.contractLine"] = b.contractNumber ? line("line_contract") : "";
  return v;
}
```

- **src/server/lib/dates.ts** — Добавить fmtDayTime (дата брони + время-строка) и fmtMoscow (фактическая отметка по Москве). Существующие fmtDate/fmtRange/fmtDateTime не трогать — на них висят тесты и вся CRM.

```
// «1 октября, 12:00». ru-Intl с month:"long" и временем даёт «1 октября в 14:32», поэтому склеиваем сами
export function fmtDayTime(d: Date | string, time?: string | null): string {
  const hhmm = time && /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_TIME;
  return `${fmtDate(d, { day: "numeric", month: "long" })}, ${hhmm}`;
}

export function fmtMoscow(d: Date): string {
  const tz = { timeZone: "Europe/Moscow" } as const;
  const day = new Intl.DateTimeFormat("ru-RU", { ...tz, day: "numeric", month: "long" }).format(d);
  const time = new Intl.DateTimeFormat("ru-RU", { ...tz, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day}, ${time}`;
}
```

- **src/server/services/settings.ts** — Добавить строковые настройки links.route и links.review: SETTINGS пополнить, завести хелпер str(), расширить setSetting до `number | boolean | string`. Значения по умолчанию — якоря собственного сайта, пока заказчик не дал ссылки.

```
linkRoute: { key: "links.route", def: "", label: "Ссылка «как добраться»" },
linkReview: { key: "links.review", def: "", label: "Ссылка на отзывы" },

function str(value: unknown, def: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : def;
}

export async function setSetting(key: string, value: number | boolean | string) { /* без изменений по телу */ }
```

- **prisma/seed.ts** — 1) Заменить тексты шаблонов на утверждённые, добавить недостающие шаблоны и снипеты line_*. 2) Заменить флаг sync на механизм seedBody (см. решение 6). 3) КРИТИЧНО: в upsert правил добавить trigger и triggerParams в ветку обновления — сейчас строка 115 их не обновляет, и dedupGroup на stage не появится. 4) isActive у правил ставить только при создании, разовое выключение before_checkout_2d/after_checkout_7d — под маркером в Setting.

```
// было: update: sync ? { name: r.name, templateId: r.templateId, isActive: true } : {}
// стало: структуру правила всегда ведёт код, включённость — администратор
await prisma.automationRule.upsert({
  where: { code: r.code },
  update: { name: r.name, trigger: r.trigger, triggerParams: r.triggerParams, templateId: r.templateId },
  create: { code: r.code, name: r.name, trigger: r.trigger, triggerParams: r.triggerParams, templateId: r.templateId, isActive: true },
});

// разовое выключение правил вне ТЗ: администратор сможет вернуть их, seed не переспорит
if (!(await prisma.setting.findUnique({ where: { key: "seed.rulesOutOfScopeDisabled" } }))) {
  await prisma.automationRule.updateMany({ where: { code: { in: ["before_checkout_2d", "after_checkout_7d"] } }, data: { isActive: false } });
  await prisma.setting.create({ data: { key: "seed.rulesOutOfScopeDisabled", value: true } });
}
```

- **prisma/schema.prisma** — Добавляющие изменения: MessageTemplate.seedBody String? (чтобы seed отличал свой текст от правок заказчика); Booking.contractNumber Int? @unique; AutomationTrigger + BOOKING_CHANGED, AFTER_PLANNED_CHECKIN (отдельной миграцией, значения enum нельзя использовать в той же транзакции). Плюс последовательность booking_contract_seq для номера договора.
- **src/server/automations/dispatcher.ts** — Контракт к соседней задаче (не моя тема, но render без этого не заработает): enqueue должен один раз загрузить снипеты (`code: { startsWith: "line_" }`) и настройки ссылок и передать их в renderTemplate; dedupKey собирать из dedupGroup; оживлять записи со статусом CANCELLED; ловить P2002 на create; разбирать rejectKind в фильтре правил.
- **src/app/admin/(app)/bookings/[id]/page.tsx** — Строка 186: `{o.renderedText}` выводится в <li> без сохранения переносов — как только сообщения станут многострочными, администратор увидит в карточке брони одну кашу, хотя клиенту уйдёт правильный текст. Добавить класс whitespace-pre-line на контейнер текста.
- **src/app/admin/(app)/clients/[id]/page.tsx** — Строка 194: та же проблема в карточке клиента — `<div className="mt-1 text-ink">{o.renderedText}</div>`. Добавить whitespace-pre-line.
- **docs/MESSAGE_TEMPLATES_2026-09-22.md** — Строка 29: убрать «сут.» после {{booking.days}} — переменная теперь отдаёт «8 суток», иначе выйдет «за 8 суток сут.». Строка 23 и 45: заменить «Здравствуйте, {{client.name}}!» и «{{client.name}}, напоминаем» на {{client.hello}} и {{client.dear}}. Строка 63: номер договора вынести отдельной строкой {{booking.contractLine}}. Добавить {{booking.payLine}} в сообщение 1 (текст про предоплату врёт для уже оплаченной брони) и зафиксировать список снипетов line_*.
- **src/app/admin/(app)/settings/templates** — Каталога нет, хотя ссылка на /admin/settings/templates стоит в settings/page.tsx:10 — сегодня это 404. Без этой страницы формулировка «заказчик правит тексты в CRM» не выполняется. Минимум: список шаблонов (отдельной группой «Строки внутри сообщений» для кодов line_*), textarea, палитра доступных переменных с пояснениями и предпросмотр на демо-брони.
- **tests/unit/render.test.ts** — Оба существующих теста проходят с новой реализацией без правок (проверено на прототипе). Правка понадобится одна и только если принимаем разрядку сумм: ожидание «1050 ₽» станет «1 050 ₽» (разделитель — неразрывный пробел U+00A0).

### Риски

- **Риск:** seed не обновляет triggerParams существующих правил (prisma/seed.ts:115 — в ветке обновления только name/templateId/isActive). На stage правила on_awaiting_payment и on_confirmed уже созданы, поэтому dedupGroup туда не попадёт, и первый же клиент, оплативший на въезде, получит второе «бронь подтверждена, до встречи» у ворот. Ошибка молчаливая: код правильный, база старая.
  **Что делаем:** Внести trigger и triggerParams в ветку обновления upsert. После деплоя на stage проверить фактическое состояние: SELECT code, trigger, "triggerParams" FROM "AutomationRule" ORDER BY code — и только потом включать автоподтверждение.
- **Риск:** renderedText выводится в CRM в обычном div без whitespace-pre-line (bookings/[id]/page.tsx:186, clients/[id]/page.tsx:194). Многострочные сообщения схлопнутся в глазах администратора, и он решит, что перенос строк сломан, хотя в Outbox текст правильный. Это ровно тот же симптом, который мы сейчас чиним в renderTemplate, только этажом выше.
  **Что делаем:** Добавить whitespace-pre-line обоим контейнерам в той же правке, что и render.ts, и проверить глазами на stage до показа заказчику.
- **Риск:** renderedText фиксируется в момент постановки в очередь (dispatcher.ts:28). Если после постановки поменяются даты, цена или оплата, клиенту уйдёт устаревший текст: «К оплате на месте: 2 800 ₽» после полной оплаты, старая дата заезда после переноса.
  **Что делаем:** В updateBooking при смене дат, суммы или оплаты пере-рендерить PENDING-записи Outbox (шаблон доступен через ruleId → rule.template.body), а не только отменять их. Либо рендерить в момент отправки — но тогда пропадает предпросмотр в карточке.
- **Риск:** Условные строки живут отдельными записями MessageTemplate: если заказчик удалит или выключит снипет line_due_open, переменная отрисуется пустой и строка молча исчезнет из сообщения.
  **Что делаем:** В админке снипеты показывать отдельной группой без кнопки удаления, а при пустом теле снипета писать AdminNotice. В юнит-тесте проверять, что при отсутствии снипета сообщение остаётся связным, а не рвётся на полуслове.
- **Риск:** booking.contract будет пустым, если номер договора присваивается после вызова onStatusChanged: в transition (bookings.ts:135-149) объект updated формируется до отправки, и если contractNumber добавят отдельным update, в сообщении окажется «Договор №».
  **Что делаем:** Присваивать contractNumber в том же prisma.booking.update, что и статус CHECKED_IN, до onStatusChanged. Плюс страховка в шаблоне: отдельная строка {{booking.contractLine}}, которая при пустом номере исчезает целиком, а не оставляет хвост.
- **Риск:** Ключ дедупликации занят записью со статусом CANCELLED (cancelPendingOutbox, bookings.ts:195-197, не удаляет строку). После цепочки «Отклонена» → «Ожидает оплаты» (переход разрешён) подтверждение клиенту больше не уйдёт никогда, и это никак не видно.
  **Что делаем:** В enqueue оживлять запись, если найденная имеет статус CANCELLED (обновить renderedText, scheduledAt, обнулить attempts), и только её — FAILED не трогать. Отдельный тест на сценарий отклонение → подтверждение из резерва.
- **Риск:** Ссылки links.route и links.review от заказчика ещё не получены (docs/MESSAGE_TEMPLATES_2026-09-22.md:100). При пустой настройке строка «Маршрут:» уйдёт с голым двоеточием — tidy её не уберёт, потому что в строке есть собственный текст.
  **Что делаем:** Значения по умолчанию на якоря своего сайта (/#directions и /#reviews — оба существуют в src/app/page.tsx). На странице настроек показывать предупреждение «ссылка не задана, используется временная». Не отправлять сообщение 4, если ссылка на отзывы так и осталась временной, — иначе просьба об отзыве ведёт в никуда.
- **Риск:** Разрядка сумм даёт неразрывный пробел U+00A0 («2 800 ₽»). Если кто-нибудь позже вернёт в tidy класс \s вместо [ \t], разрядка схлопнется и сумма склеится.
  **Что делаем:** Комментарий в коде прямо у регулярки и юнит-тест, который проверяет, что U+00A0 в отрисованной сумме уцелел.
- **Риск:** Текст сообщения 1 обещает «Предоплата не нужна», и при общей группе дедупликации он же уйдёт брони, созданной сразу оплаченной (CONFIRMED). Клиент, который только что заплатил, получит предложение заплатить на месте.
  **Что делаем:** Условная строка {{booking.payLine}} по признаку amount − paidAmount. Тест на бронь с paidAmount = amount.
- **Риск:** Правило on_booking_changed использует новые даты в ключе дедупликации: если клиент передвинул даты и вернул обратно, второе сообщение об изменении не уйдёт.
  **Что делаем:** Добавлять в суффикс ключа счётчик изменений или момент правки с точностью до минуты. Случай редкий — зафиксировать решение в плане, чтобы потом не искать причину.

### Что покрыть тестами

- renderTemplate: многострочный шаблон сообщения 1 отрисован дословно — совпадает структура абзацев (проверять через split("\n"), а не через match), пустых строк ровно по одной между абзацами, нет ведущих и хвостовых пробелов в строках
- renderTemplate: строка, состоящая из одной переменной, исчезает целиком, если переменная пустая ({{booking.transferLine}} в сообщении 1 и {{booking.dueLine}} в сообщении 2), а пустая строка, которая была в шаблоне, сохраняется
- renderTemplate: три и более переноса подряд схлопываются в два — отдельный кейс, когда исчезнувшая строка стояла между двумя пустыми
- renderTemplate: несколько пробелов и табуляция внутри строки схлопываются в один пробел, а неразрывный пробел в разрядке суммы («2 800 ₽») уцелел
- client.hello и client.dear без имени: «Здравствуйте! Это парковка…» и «Здравствуйте, напоминаем: …» — ни «Здравствуйте, !», ни ведущей запятой, ни строчной буквы в начале предложения
- Страховка на висячие знаки: шаблон «Здравствуйте, {{client.name}}!» с пустым именем даёт «Здравствуйте!» (на случай, если заказчик напишет client.name руками)
- booking.arrival и booking.departure: «1 октября, 12:00»; без timeFrom подставляется 12:00; проверить отдельно, что в строке нет предлога «в» (ru-Intl подставляет его при month:"long" с временем)
- booking.checkedInAt по московскому времени: 2026-10-01T21:40:00Z даёт «2 октября, 00:40» — граница суток, на которой ловится подмена часового пояса
- booking.days: 1 → «1 сутки», 3 → «3 суток», 21 → «21 сутки»; после выезда берётся actualDays, а не плановые days
- booking.dueLine: amount 2800 / paidAmount 0 → «К оплате на месте: 2 800 ₽, наличными или картой.»; paidAmount = amount → «Бронь оплачена.»; paidAmount больше amount → не отрицательная сумма
- booking.transferLine и booking.returnLine переключаются по transferNeeded, оба варианта непустые; отсутствие снипета в словаре lines не рвёт сообщение
- booking.contract: 1 → «001», 42 → «042», 1234 → «1234»; при contractNumber = null строка {{booking.contractLine}} исчезает и «Договор №» в сообщении не остаётся
- links.route и links.review: заданная настройка побеждает значение по умолчанию; при пустой настройке подставляется якорь сайта, а не пустая строка
- Регрессия: оба существующих теста tests/unit/render.test.ts проходят без правок (однострочные шаблоны, неизвестная переменная пустая)
- Длина отрисованного сообщения 1 при максимальных значениях (длинное имя, длинная ссылка, ветка с платным трансфером) меньше 1024 символов — лимит Telegram из docs/WAZZUP_INTEGRATION.md:39
- seed идемпотентен: два прогона подряд не меняют тексты; правка body в базе переживает третий прогон, а seedBody обновляется и появляется уведомление о расхождении
- seed: после прогона у on_awaiting_payment и on_confirmed в triggerParams есть dedupGroup "confirmation" (тест именно на обновление СУЩЕСТВУЮЩЕЙ строки, а не на создание с нуля — это та самая дыра в seed.ts:115)
- seed: before_checkout_2d и after_checkout_7d выключены после первого прогона; включённые обратно вручную остаются включёнными после следующего прогона
- Дедупликация: AWAITING_PAYMENT затем CONFIRMED по одной брони дают ровно одну запись в Outbox; REJECTED после автоотклонения и затем AWAITING_PAYMENT из резерва дают подтверждение (оживление CANCELLED)
- e2e на stage: заявка с сайта с автоподтверждением → в карточке брони видно сообщение с сохранёнными переносами; бронь без имени клиента → «Здравствуйте!» без висячих знаков


## Номер договора: выдача, формат, уникальность

Номер договора: отдельное поле `Booking.contractNumber Int? @unique`, значение выдаётся как MAX+1 под `pg_advisory_xact_lock` внутри той же транзакции, что и переход в «Заехал» — тогда откат транзакции забирает номер обратно (пропусков нет), а двум одновременным заездам один номер не достанется; формат 001 делает чистая `formatContract(n) = String(n).padStart(3, "0")`. Присваиваем в `transition()` (src/server/services/bookings.ts:110) и в `correctStatus()` (там же:171) только при `contractNumber == null` — при откате статуса назад номер не сбрасывается и при возврате вперёд переиспользуется. Уведомление об изменении брони вешаем на `updateBooking` (bookings.ts:296–328): сравниваем только даты и время, неотправленные сообщения по старым датам либо переписываем на новые (события), либо отменяем (сообщения по расписанию), а новое сообщение ставим в очередь, только если подтверждение клиенту уже реально ушло (Outbox `SENT`); занятость перепроверяем под той же блокировкой, что и автоподтверждение, и администратора не блокируем — резерв сохраняем с пометкой, физический перебор требует подтверждения «всё равно перенести».


### Решения

**1. Как реализовать сквозную нумерацию договоров: автоинкремент-поле, отдельная последовательность или счётчик в Setting?**

Ни один из трёх в чистом виде — берём четвёртый: `contractNumber Int? @unique` + значение `MAX(contractNumber)+1`, вычисленное под `pg_advisory_xact_lock(240922)` внутри той же транзакции, что и смена статуса. Почему не остальные: (а) автоинкремент/SERIAL, как у `Booking.number` (prisma/schema.prisma:290, DDL `"number" SERIAL NOT NULL` в prisma/migrations/20260827134317_init/migration.sql:152), присваивается в момент INSERT — договор же выдаётся позже, при заезде, и отложить колоночный DEFAULT на будущий UPDATE нельзя; (б) отдельная последовательность (`CREATE SEQUENCE` + `nextval` в транзакции) безопасна при конкуренции, но `nextval` не откатывается — любой откат транзакции заезда сжигает номер, то есть даёт ровно тот пропуск, которого просили избежать; (в) счётчик в `Setting` под `UPDATE ... RETURNING` откатывается вместе с транзакцией и потому беспропускной, но это вторая копия правды: она разъедется с данными, как только бухгалтерия проставит номер вручную или на stage удалят тестовые брони (tests/e2e/cleanup.sql удаляет строки `Booking`). MAX+1 самовосстанавливается: правда одна — сами брони; чтобы передать нумерацию бухгалтерии, достаточно один раз проставить нужный номер в брони, дальше счёт пойдёт от него. Уникальный индекс — последний предохранитель: даже если блокировку обойдут, вторая транзакция упадёт на P2002, а не выдаст дубль.

**Почему MAX+1 безопасен при конкуренции и откате**

Блокировка `pg_advisory_xact_lock` держится до конца транзакции (как в autoconfirm.ts:21-23), поэтому пара «прочитать MAX — записать номер» выполняется по одному заезду за раз. Откат транзакции снимает блокировку и откатывает запись — номер не выдан, пропуска нет. На READ COMMITTED (умолчание Postgres; `isolationLevel` в коде нигде не задаётся — grep по src/server пуст) вторая транзакция после получения блокировки читает уже зафиксированную строку первой и видит новый MAX. Если когда-нибудь поднимут уровень изоляции до REPEATABLE READ, снимок будет старым — тогда спасает `@unique` (ошибка вместо дубля), и это надо будет заменить на retry.

**Формат 001, 002 … 999, 1000**

Чистая функция `formatContract(n) = n == null ? "" : String(n).padStart(3, "0")` в новом `src/lib/contract.ts`. Даёт 001 / 042 / 999 / 1000 / 12345 без ветвлений. Держим её в `src/lib` (не в `src/server`), чтобы её видели и `renderTemplate`, и клиентские компоненты, и юнит-тесты: tests/unit импортируют через алиас `@/…` (tests/unit/render.test.ts:4), а модули с `import "server-only"` в тесты не затащить.

**2. Где присваивать номер при переходе в «Заехал»**

В `transition()` (src/server/services/bookings.ts:99-152), внутри существующей ветки `if (to === "CHECKED_IN")` на строке 110 — до `tx.booking.update` на строке 135. Это принципиально: `onStatusChanged(updated, to, tx)` на строке 149 рендерит сообщение «Автомобиль принят» из объекта `updated`, и `{{booking.contract}}` подставится, только если номер попал в тот же `data`, а не в отдельный UPDATE после. Условие — `b.contractNumber == null && b.kind === "PARKING"` (договор хранения — про автомобиль; брони комнат номер не получают).

**Что при исправлении статуса назад и вперёд (correctStatus)**

Номер не сбрасываем никогда, выдаём только при `contractNumber == null`. Конкретно: в `correctStatus` (bookings.ts:156-193) строки 165-166 обнуляют `checkedInAt`/`checkedOutAt` при откате — `contractNumber` в этот список не добавляем (нужен явный комментарий, иначе следующий разработчик «дочистит» по аналогии). И симметрично: на строке 171 (`to === "CHECKED_IN" && !b.checkedInAt`) номер надо выдать, иначе бронь, заехавшая через исправление, останется без договора и шаблон отрендерит «договор №» пустым. Поскольку обе точки проверяют `contractNumber == null`, цикл «Заехал → назад → снова Заехал» переиспользует тот же номер. Побочный эффект принят сознательно: если карточку перетащили по ошибке и откатили, номер остаётся «сожжённым» за этой бронью — в бумажной нумерации это испорченный бланк, он виден в ленте и в журнале. Возвращать верхний номер в оборот технически можно (при MAX+1 достаточно обнулить его у последней брони), но это противоречит решению «номер сохраняется» и ломает след аудита — не делаем.

**3. Где и как слать уведомление об изменении брони (ТЗ п. 1.3)**

В `updateBooking` (bookings.ts:285-329): после `tx.booking.update` (строка 298-315) и рядом с уже существующей сборкой `changes` (строки 319-322) вызвать новую `onBookingChanged(updated, tx)` из dispatcher.ts — но только если изменились даты или время. Сама функция делает три вещи по порядку: (1) разбирает неотправленные записи Outbox по этой брони — сообщения событийных правил (`trigger === "STATUS_CHANGED"`) перерисовывает по новым данным (`renderedText` заморожен на момент постановки в очередь, иначе клиенту уйдёт старая дата), а сообщения по расписанию (BEFORE_CHECKIN и прочие) переводит в `CANCELLED` — их заново создаст сканер этапа 2 уже от новых дат; (2) ставит сообщение «бронь изменена» новым правилом `on_booking_changed`; (3) возвращает счётчики, чтобы дописать их в ленту. Ключ дедупликации обязан отличаться от `правило:бронь` (dispatcher.ts:24), иначе второе изменение по той же брони молча не уйдёт — берём `on_booking_changed:<id>:<даты>:<порядковый номер>`; порядковый номер считается как `outbox.count` по этой брони и правилу и закрывает случай «перенесли на B, вернули на A, снова на B».

**Как отличить смену дат от смены суммы и госномера**

Сравнивать ровно четыре поля и только их, через чистый хелпер `datesChanged` над ISO-строками: `toIso(before.dateFrom) !== input.dateFrom || toIso(before.dateTo) !== input.dateTo || (before.timeFrom ?? "") !== (input.timeFrom ?? "") || (before.timeTo ?? "") !== (input.timeTo ?? "")`. ISO-строки, а не `Date.getTime()`, потому что `dateFrom` — колонка DATE (UTC-полночь) и `toIso` (src/server/lib/dates.ts:7-9) уже приводит её к тому же виду, в каком даты приходят из формы. Нормализация `?? ""` обязательна: `updateBooking` пишет `input.timeFrom || null` (bookings.ts:306), а форма присылает пустую строку — без нормализации «пустое → пустое» считалось бы изменением на каждом сохранении. Сумма (`amount`), имя, госномер, тип ТС, источник, комментарий на отправку не влияют.

**4. Как не слать сообщение при правке на ту же дату и по неподтверждённой брони**

Три условия подряд, все дешёвые: (1) `datesChanged` из предыдущего пункта — правка на ту же дату не проходит даже первый фильтр (и это же гасит двойной сабмит формы: второй раз `before` уже равен новым датам); (2) статус в «обещанных» — AWAITING_PAYMENT, CONFIRMED, CHECKED_IN; для NEW, REJECTED, CANCELLED, NO_SHOW, CHECKED_OUT клиенту ничего не обещали или всё закончилось; (3) главное — подтверждение реально ушло: `outbox.findFirst({ bookingId, templateCode: { in: ["on_awaiting_payment", "on_confirmed"] }, status: "SENT" })`. Третье условие не декоративное: пока отправщик не подключён, все сообщения лежат в очереди PENDING (docs/TZ_2026-09-21_PLAN.md:147 — на stage 7 неотправленных), и клиенту правильнее переписать само подтверждение новыми датами, чем прислать «бронь изменена» до первого сообщения. Ровно это и делает шаг (1) функции `onBookingChanged`. Дополнительно стоит уважать `Client.doNotDisturb` — сейчас его не смотрит никто, включая `enqueue`; лучшее место для проверки — отправщик Wazzup этапа 2а, здесь только отметить.

**5. Что делать, если на новые даты мест нет**

Не запрещать, но не пускать молча — две ступени по тем же двум настройкам, что у автоподтверждения (395 и 405, src/server/services/settings.ts:6-9). Считаем пик занятости пула на новом отрезке, исключив саму бронь. Если пик+1 ≤ 395 — сохраняем молча. Если 395 < пик+1 ≤ 405 — сохраняем, пишем в ленту системную строку «Перенос в резерв: занято N из 405» и возвращаем администратору предупреждение (в ActionResult появляется необязательное поле `warning`). Если пик+1 > 405 — мест физически нет: действие возвращает `{ ok: false, error, confirm: "force" }`, форма показывает «Мест на новые даты нет (занято 405 из 405). Перенести всё равно?», и повторное сохранение с `force: true` проходит, оставляя системную запись в ленте. Администратор при этом никогда не упирается в стену (у него на руках может стоять машина), но перебор сверх физической вместимости требует осознанного второго клика. Считать надо под той же блокировкой `lockOccupancy(tx)` (autoconfirm.ts:21-23), иначе проверка разойдётся с параллельной заявкой с сайта, и по НОВОМУ типу ТС (`input.vehicleType ?? before.vehicleType`): правка CAR→TRUCK переносит бронь в другой пул.

**Нужно ли новое значение AutomationTrigger для правила «бронь изменена»**

Да: `AutomationRule.trigger` — обязательное поле, а правило вызывается кодом напрямую по коду `on_booking_changed`, не через матчинг в `onStatusChanged`. План уже предусматривает `BOOKING_CHANGED` и `AFTER_PLANNED_CHECKIN` (для «вы не приехали»). Оба значения надо добавить ОДНОЙ отдельной миграцией и не использовать в ней же — Postgres не разрешает применять новое значение enum до фиксации транзакции; правило и шаблон заводит `prisma/seed.ts` (по образцу строк 103-118, с `sync: true`, раз текст ведёт разработчик до появления страницы шаблонов).


### Файлы

- **prisma/schema.prisma** — В модель Booking (строки 288-347, рядом с `checkedInAt` на строке 322) добавить необязательное уникальное поле номера договора. В enum AutomationTrigger (строки 116-121) добавить `BOOKING_CHANGED` (и заодно `AFTER_PLANNED_CHECKIN`, который нужен соседней задаче этапа 2, чтобы не делать две миграции enum).

```
model Booking {
  // …
  checkedInAt    DateTime?
  // Сквозной номер договора хранения: выдаётся при заезде, показывается как 001
  contractNumber Int?          @unique
}

enum AutomationTrigger {
  STATUS_CHANGED
  BOOKING_CHANGED
  BEFORE_CHECKIN
  BEFORE_CHECKOUT
  AFTER_CHECKOUT
  AFTER_PLANNED_CHECKIN
}
```

- **prisma/migrations/<дата>_contract_number/migration.sql** — Добавляющая миграция: колонка + уникальный индекс. Значения enum — ОТДЕЛЬНОЙ миграцией, без использования в ней же (правило плана §3).

```
-- миграция 1: значения enum
ALTER TYPE "AutomationTrigger" ADD VALUE 'BOOKING_CHANGED';
ALTER TYPE "AutomationTrigger" ADD VALUE 'AFTER_PLANNED_CHECKIN';

-- миграция 2: колонка
ALTER TABLE "Booking" ADD COLUMN "contractNumber" INTEGER;
CREATE UNIQUE INDEX "Booking_contractNumber_key" ON "Booking"("contractNumber");
```

- **src/lib/contract.ts** — Новый файл: чистое форматирование номера договора. В src/lib, а не в src/server — нужен и в renderTemplate, и в карточке брони, и в юнит-тестах.

```
// Номер договора: ведущие нули до трёх знаков, дальше как есть (001, 042, 999, 1000).
export function formatContract(n: number | null | undefined): string {
  return n == null ? "" : String(n).padStart(3, "0");
}
```

- **src/lib/booking-dates.ts** — Новый файл: чистые хелперы «изменились ли даты» и «отпечаток дат для ключа дедупликации». Вынесены из сервисов, чтобы покрыть юнит-тестами без базы.

```
export type DateFields = { dateFrom: string; dateTo: string; timeFrom?: string | null; timeTo?: string | null };

// Пустая строка из формы и null в базе — одно и то же, иначе каждое сохранение выглядело бы как перенос
const t = (v?: string | null) => v || "";

export function datesChanged(a: DateFields, b: DateFields): boolean {
  return a.dateFrom !== b.dateFrom || a.dateTo !== b.dateTo || t(a.timeFrom) !== t(b.timeFrom) || t(a.timeTo) !== t(b.timeTo);
}

export function dateStamp(d: DateFields): string {
  return `${d.dateFrom}${t(d.timeFrom) && "T" + t(d.timeFrom)}_${d.dateTo}${t(d.timeTo) && "T" + t(d.timeTo)}`;
}
```

- **src/server/services/contracts.ts** — Новый файл: выдача очередного номера договора. Одно правило в одном месте (план §3), по образцу lockOccupancy из autoconfirm.ts:21-23, но со своим ключом блокировки.

```
import "server-only";
import type { Prisma } from "@prisma/client";

export const CONTRACT_LOCK = 24_0922; // свой ключ, чтобы не сцепляться с блокировкой занятости

// Номер выдаётся в той же транзакции, что и переход в «Заехал»: откат забирает номер обратно,
// пропусков в нумерации не возникает. Блокировка держится до конца транзакции — двум
// одновременным заездам один номер не достанется; @unique остаётся последним предохранителем.
export async function nextContractNumber(tx: Prisma.TransactionClient): Promise<number> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CONTRACT_LOCK})`);
  const { _max } = await tx.booking.aggregate({ _max: { contractNumber: true } });
  return (_max.contractNumber ?? 0) + 1;
}
```

- **src/server/services/bookings.ts** — Три точки. (1) transition(), строка 110: выдать номер в тот же объект data, до update на строке 135 — иначе onStatusChanged на строке 149 отрендерит сообщение «Автомобиль принят» без договора. Номер дописать в текст события ленты (строка 142) и в audit (строка 147). (2) correctStatus(), строка 171: выдать номер при исправлении вперёд; на строках 165-166 НЕ добавлять сброс contractNumber (комментарий обязателен). (3) updateBooking(), строки 296-328: перепроверка занятости под блокировкой до update, вызов onBookingChanged после update, только при смене дат.

```
// ── transition(), заменить строку 110 ──────────────────────────────────────
const contract = to === "CHECKED_IN" && b.kind === "PARKING" && b.contractNumber == null ? await nextContractNumber(tx) : null;
if (to === "CHECKED_IN") {
  data.checkedInAt = at;
  if (contract) data.contractNumber = contract; // договор хранения подписывают при сдаче машины
}
// …
const contractLine = contract ? ` · договор №${formatContract(contract)}` : "";
text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL[to]}${factual}${contractLine}${opts.reason ? ` · ${opts.reason}` : ""}`,
// audit на строке 147: { from: b.status, to, at: at.toISOString(), contract }

// ── correctStatus(), строки 165-166 и 171 ──────────────────────────────────
if (rank[to] < 3) data.checkedInAt = null; // contractNumber не сбрасываем: бланк подписан и остаётся за бронью
if (rank[to] < 4) data.checkedOutAt = null;
// …
if (to === "CHECKED_IN" && !b.checkedInAt) data.checkedInAt = new Date();
if (to === "CHECKED_IN" && b.kind === "PARKING" && b.contractNumber == null) data.contractNumber = await nextContractNumber(tx);

// ── updateBooking(), внутри транзакции после строки 297 ────────────────────
export class NoSpaceError extends BookingError {}

const before = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
const moved = datesChanged(
  { dateFrom: toIso(before.dateFrom), dateTo: toIso(before.dateTo), timeFrom: before.timeFrom, timeTo: before.timeTo },
  { dateFrom: input.dateFrom, dateTo: input.dateTo, timeFrom: input.timeFrom, timeTo: input.timeTo },
);
const vt = input.vehicleType ?? before.vehicleType;
let warning: string | null = null;
if (moved && before.kind === "PARKING" && isPoolType(vt)) {
  const s = await parkingSettings();
  await lockOccupancy(tx); // та же блокировка, что у автоподтверждения: иначе разойдёмся с заявкой с сайта
  const { peak } = await poolPeakTx(tx, "POOL", input.dateFrom, input.dateTo, before.id);
  if (peak + 1 > s.capacityTotal && !input.force) {
    throw new NoSpaceError(`На новые даты мест нет: занято ${peak} из ${s.capacityTotal}`);
  }
  if (peak + 1 > s.autoConfirmLimit) warning = `Перенос в резерв: занято ${peak} из ${s.capacityTotal}`;
}
const updated = await tx.booking.update({ /* как сейчас, строки 299-315 */ });
// …
if (moved) changes.push(`даты ${fmtRange(before.dateFrom, before.dateTo)} → ${fmtRange(updated.dateFrom, updated.dateTo)}`);
if (warning) {
  await tx.interaction.create({ data: { bookingId: updated.id, clientId: updated.clientId, type: "SYSTEM", text: warning, userId: actor.id } });
}
if (moved) {
  const res = await onBookingChanged(updated, tx);
  if (res.cancelled || res.rewritten) {
    await tx.interaction.create({ data: { bookingId: updated.id, clientId: updated.clientId, type: "SYSTEM", text: `Сообщения по старым датам: переписано ${res.rewritten}, отменено ${res.cancelled}`, userId: actor.id } });
  }
}
return { booking: updated, warning };
```

- **src/server/automations/dispatcher.ts** — (1) enqueue (строки 23-41): добавить необязательный параметр ключа дедупликации, сохранив нынешнее поведение по умолчанию. (2) Новая onBookingChanged: переписать неотправленные событийные сообщения, отменить сообщения по расписанию, поставить «бронь изменена», если подтверждение уже ушло.

```
export async function enqueue(booking: Booking, ruleId: string | null, ruleCode: string, templateBody: string, tx: Tx = prisma, scheduledAt = new Date(), key: string = booking.id) {
  const dedupKey = `${ruleCode}:${key}`;
  // … без изменений
}

const CONFIRMATION_CODES = ["on_awaiting_payment", "on_confirmed"]; // общая группа подтверждения (план §2 п.3)
const PROMISED: BookingStatus[] = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"];

// Изменение дат брони (ТЗ 21.09, п. 1.3). renderedText заморожен на момент постановки в очередь,
// поэтому неотправленное надо переписать, а привязанное к времени — отменить: сканер создаст заново.
export async function onBookingChanged(booking: Booking, tx: Tx = prisma) {
  const client = booking.clientId ? await tx.client.findUnique({ where: { id: booking.clientId } }) : null;
  const pending = await tx.outbox.findMany({ where: { bookingId: booking.id, status: "PENDING" }, include: { rule: { include: { template: true } } } });
  let rewritten = 0, cancelled = 0;
  for (const row of pending) {
    const body = row.rule?.trigger === "STATUS_CHANGED" ? row.rule.template?.body : null;
    if (body) {
      await tx.outbox.update({ where: { id: row.id }, data: { renderedText: renderTemplate(body, { booking, client }) } });
      rewritten++;
    } else {
      await tx.outbox.update({ where: { id: row.id }, data: { status: "CANCELLED", lastError: "даты брони изменены" } });
      cancelled++;
    }
  }
  if (!PROMISED.includes(booking.status)) return { rewritten, cancelled, queued: false };
  // если подтверждение ещё в очереди, оно уже переписано новыми датами — второе сообщение ни к чему
  const sent = await tx.outbox.findFirst({ where: { bookingId: booking.id, templateCode: { in: CONFIRMATION_CODES }, status: "SENT" } });
  if (!sent) return { rewritten, cancelled, queued: false };
  const rule = await tx.automationRule.findUnique({ where: { code: "on_booking_changed" }, include: { template: true } });
  if (!rule?.isActive || !rule.template?.isActive) return { rewritten, cancelled, queued: false };
  const n = await tx.outbox.count({ where: { bookingId: booking.id, templateCode: rule.code } });
  const stamp = dateStamp({ dateFrom: toIso(booking.dateFrom), dateTo: toIso(booking.dateTo), timeFrom: booking.timeFrom, timeTo: booking.timeTo });
  await enqueue(booking, rule.id, rule.code, rule.template.body, tx, new Date(), `${booking.id}:${stamp}:${n + 1}`);
  return { rewritten, cancelled, queued: true };
}
```

- **src/server/automations/render.ts** — Добавить переменную `booking.contract` (строки 7-17). Правка `\\s{2,}` → пробелы и табы (строка 18) — задача соседнего пункта этапа 2, но её надо сделать до многострочных шаблонов, иначе договор и даты слипнутся в один абзац.

```
"booking.contract": formatContract(booking.contractNumber),
```

- **src/server/services/occupancy.ts** — Экспортировать вариант расчёта пика пула, работающий под переданной транзакцией: сейчас poolSpans/poolLoad (строки 64-89) ходят в глобальный prisma и внутри транзакции покажут состояние без учёта блокировки, а в autoconfirm.ts:26-39 лежит её приватная копия. Свести к одной функции, autoconfirm перевести на неё (план §3: «одно правило в одном месте»).

```
export async function poolPeakTx(tx: Prisma.TransactionClient, pool: PoolKind, from: string, to: string, excludeBookingId?: string) {
  const rows = await tx.booking.findMany({ where: { kind: "PARKING", status: { in: [...ACTIVE] }, dateFrom: { lte: toDate(to) }, dateTo: { gte: toDate(from) }, ...poolWhere(pool), ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}) }, select: { dateFrom: true, dateTo: true } });
  const spans = rows.map((b) => ({ dateFrom: toIso(b.dateFrom), dateTo: toIso(b.dateTo) }));
  return { spans, peak: peakLoad(spans, from, to) };
}
```

- **src/app/admin/actions/bookings.ts** — (1) ActionResult (строка 14): добавить необязательные `warning` в успех и `confirm` в отказ — поля необязательные, прочие вызовы не трогаются. (2) updateBookingAction (строки 116-135): пробросить `force`, вернуть предупреждение и признак «нужно подтверждение». (3) quoteAction (строки 139-153) сейчас считает свободные места по категориям через occupancySummary → CapacityConfig (60/30/10/5), а перенос проверяется по общему пулу 405 — форма правки будет показывать «свободно 29/30» против «занято 400 из 405». Перевести на poolLoad (план §2 п.6).

```
export type ActionResult<T = undefined> =
  | { ok: true; data: T; warning?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; confirm?: "force" };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof NoSpaceError) return { ok: false, error: e.message, confirm: "force" };
  // … как сейчас
}
```

- **src/components/admin/booking/EditBooking.tsx** — В submit (строки 29-37) обработать `confirm: "force"`: показать вопрос «Мест на новые даты нет. Перенести всё равно?» и по подтверждению повторить вызов с `force: true`; успешный ответ с `warning` показать полоской. Поле `force` добавить в updateBookingSchema (src/server/validation/booking.ts:54-68) как `z.coerce.boolean().default(false)`.

```
const res = await updateBookingAction({ bookingId: booking.id, ...f, vehicleType: f.vehicleType ?? undefined, force });
if (!res.ok && res.confirm === "force") return setConfirm(res.error); // кнопка «Перенести всё равно»
if (!res.ok) return setErrors(res.fieldErrors ?? { _: res.error });
```

- **src/app/admin/(app)/bookings/[id]/page.tsx** — Рядом с крупным «№{b.number}» (строки 71-74) показать номер договора, когда он выдан — администратору он нужен при выдаче машины и при звонке клиента.

```
{b.contractNumber != null && (
  <div>
    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Договор</div>
    <div className="font-mono text-3xl font-bold leading-none">№{formatContract(b.contractNumber)}</div>
  </div>
)}
```

- **prisma/seed.ts** — В policyAndTemplates (строки 85-118) добавить шаблон `booking_changed` и правило `on_booking_changed` с `sync: true` (текст ведёт разработчик до появления страницы шаблонов). Текст — по формулировке заказчика из ТЗ п. 1.3, дополненный деталями; финальную редакцию утверждает Влад. Переменные booking.arrival / booking.departure / booking.days приходят из соседней задачи этапа 2 — до неё шаблон подставит пустые строки.

```
{ code: "booking_changed", name: "Бронь изменена", sync: true, body: "{{client.name}}, ваша бронь №{{booking.number}} изменена.\n\nНовый заезд: {{booking.arrival}}\nНовый выезд: {{booking.departure}}\nСтоимость: {{booking.amount}} ₽ за {{booking.days}} сут.\n\nЕсли это не то, о чём договаривались, ответьте на это сообщение или позвоните: +7 905 525-06-60." },
// правило
{ code: "on_booking_changed", name: "Даты изменены → «бронь изменена»", trigger: "BOOKING_CHANGED", triggerParams: {}, templateId: ids.booking_changed, sync: true },
```

- **docs/TZ_2026-09-21_PLAN.md** — После реализации отметить в этапе 2 (строки 92-93) фактические решения: номер договора = MAX+1 под блокировкой (а не счётчик), сообщение об изменении уходит только после реально отправленного подтверждения, перебор мест при переносе требует подтверждения администратора. В §4 (строка 61) `rejectKind String?` уже разошёлся с реальностью — в схеме это enum RejectKind; заодно поправить.

### Риски

- **Риск:** Номер договора выдаётся в `data` перед `tx.booking.update`, но если кто-то позже перенесёт его в отдельный UPDATE после `onStatusChanged` (bookings.ts:149), сообщение «Автомобиль принят» уйдёт с пустым «договор №». Ошибка тихая: тест на текст сообщения поймает, тест на поле в базе — нет.
  **Что делаем:** Юнит-тест на renderTemplate с booking.contractNumber = null должен падать при пустом договоре в шаблоне 3, плюс комментарий в коде о порядке. В шаблоне использовать строку целиком («Бронь №{{booking.number}}, договор №{{booking.contract}}») и проверять её в e2e-прогоне заезда.
- **Риск:** MAX+1 переиспользует номер, если бронь с максимальным номером удалили. На stage это происходит регулярно: tests/e2e/cleanup.sql и cleanup.mjs удаляют брони по признакам Т000/+7999, а crm-pipeline.mjs доводит бронь до «Заехал». В проде брони не удаляются ничем, кроме ручного SQL.
  **Что делаем:** Зафиксировать в HANDOFF и в комментарии функции: брони не удалять, для отмены есть статусы. На stage переиспользование номера безвредно и даже удобно. Если заказчик захочет гарантий — добавить таблицу-журнал выданных номеров, но это уже вторая копия правды.
- **Риск:** Advisory-блокировка удерживается до конца транзакции, а у интерактивных транзакций Prisma умолчание timeout 5 с (в src/server/db/prisma.ts опции не заданы). Длинная транзакция заезда под нагрузкой может упереться в таймаут и вернуть администратору непонятную ошибку.
  **Что делаем:** Брать блокировку последним действием перед update (как в наброске), держать в транзакции только работу с базой. Проверить в тесте на параллельные заезды время выполнения. При необходимости поднять timeout точечно: prisma.$transaction(fn, { timeout: 15000 }).
- **Риск:** Перерисовка PENDING-сообщений меняет текст, который администратор уже видел в карточке (блок «Сообщения клиенту», bookings/[id]/page.tsx:173-192). Выглядит как подмена истории.
  **Что делаем:** Писать в ленту системную строку «Сообщения по старым датам: переписано N, отменено M» (есть в наброске) — история изменений остаётся в ленте, а в очереди лежит актуальный текст.
- **Риск:** Условие «подтверждение ушло» опирается на Outbox.status = SENT, которого пока не бывает: отправщик не подключён (план §6, строка 147). До этапа 2а сообщение «бронь изменена» не появится ни разу, и функцию легко посчитать сломанной при приёмке.
  **Что делаем:** Явно проговорить в отчёте пользователю и в тесте: на stage проверяется ветка «подтверждение ещё в очереди → переписали», а ветка «уже ушло» проверяется подстановкой status = SENT руками в тесте.
- **Риск:** Ключ дедупликации `правило:бронь:даты:N` считает N через `outbox.count` внутри транзакции: два одновременных сохранения одной брони дадут одинаковый N и второе упадёт на уникальном индексе Outbox.dedupKey (schema.prisma:454) с общей ошибкой «Ошибка сервера».
  **Что делаем:** Практически невозможно (администратор один, и повтор той же правки отсекается проверкой datesChanged). Для аккуратности ловить P2002 в onBookingChanged и считать это успешной дедупликацией.
- **Риск:** Перепроверка занятости при переносе считает по общему пулу (405), а форма правки рядом показывает «свободно N/M» по категориям через quoteAction → occupancySummary → CapacityConfig (60/30/10/5). Администратор увидит два противоречащих числа и не поймёт, почему «свободно 29/30», но перенос требует подтверждения.
  **Что делаем:** Перевести quoteAction на poolLoad в той же правке (план §2 п.6). Это формально хвост этапа 1, но без него поведение из п. 5 выглядит сломанным.
- **Риск:** Перенос брони мимо проверки: даты меняются не только через updateBooking. decideRecalc (bookings.ts:261-278) правит days и amount, но не даты — там всё в порядке; а вот если позже появится перетаскивание по календарю или продление из сообщения, проверка занятости и уведомление окажутся продублированы или забыты.
  **Что делаем:** Держать всю логику в onBookingChanged и в одном месте перепроверки занятости, любые новые пути смены дат звать через updateBooking.
- **Риск:** Правка типа ТС CAR ↔ TRUCK переносит бронь между пулами (405 и 10 мест), а проверка считает по одному пулу. Если взять пул по before.vehicleType, машина проверится не там.
  **Что делаем:** Считать по `input.vehicleType ?? before.vehicleType` (в наброске), а смену типа ТС при занятых датах тоже считать поводом перепроверить занятость — добавить её в условие наравне с датами.
- **Риск:** Правило `on_booking_changed` нельзя завести в той же миграции, что и значение enum BOOKING_CHANGED (Postgres не даёт использовать новое значение до фиксации транзакции). Если забыть — деплой на stage упадёт.
  **Что делаем:** Значения enum — отдельной миграцией, правило и шаблон — через prisma/seed.ts после неё (правило плана §3, строка 50). Перед миграцией бэкап базы docker/backup.sh.

### Что покрыть тестами

- tests/unit/contract.test.ts — formatContract: 1 → «001», 42 → «042», 999 → «999», 1000 → «1000», 12345 → «12345», null и undefined → пустая строка.
- tests/unit/booking-dates.test.ts — datesChanged: одинаковые даты и время → false; null против пустой строки во времени → false; сдвиг dateFrom → true; сдвиг только timeTo → true; изменение суммы и госномера в сравнение не входит (проверяется тем, что функция их не принимает). dateStamp: стабилен для одного набора дат и различается при сдвиге времени.
- tests/unit/render.test.ts — дополнить: {{booking.contract}} подставляется как «001» при contractNumber = 1 и пустой строкой при null; многострочный шаблон (сообщение 3 из MESSAGE_TEMPLATES) сохраняет переносы строк после правки схлопывания пробелов.
- tests/e2e/contract.mjs (новый, по образцу autoconfirm.mjs с прямым доступом к prisma) — два параллельных заезда (Promise.all двух transition) получают разные номера и без пропуска между ними.
- tests/e2e/contract.mjs — откат не сжигает номер: транзакция, которая вызывает nextContractNumber и затем бросает ошибку, оставляет MAX(contractNumber) прежним; следующий настоящий заезд получает тот же номер.
- tests/e2e/contract.mjs — исправление статуса: «Заехал» (получил 001) → correctStatus назад в «Ожидает оплаты» (checkedInAt обнулён, contractNumber = 1 на месте) → correctStatus вперёд в «Заехал» → номер остался 001, новый не выдан и MAX не вырос.
- tests/e2e/contract.mjs — бронь комнаты (kind = ROOM) при заезде номер договора не получает.
- tests/e2e/booking-changed.mjs (новый) — изменение только суммы и госномера не создаёт записей в Outbox; сохранение с теми же датами и пустым временем не создаёт; сдвиг dateFrom на день при статусе AWAITING_PAYMENT и подтверждении в статусе PENDING → подтверждение переписано новыми датами, новой записи нет; то же при подтверждении, проставленном в SENT руками → появилась запись on_booking_changed с новыми датами; повторный перенос A → B → A → B даёт четыре разных dedupKey и четыре сообщения.
- tests/e2e/booking-changed.mjs — сообщение по расписанию (правило before_checkin_24h в PENDING) при переносе дат переходит в CANCELLED, а не переписывается.
- tests/e2e/booking-changed.mjs — бронь в статусе NEW: перенос дат не ставит сообщение об изменении (клиенту ничего не обещали), но неотправленный on_new_lead переписан новыми датами.
- tests/e2e/booking-changed.mjs — занятость: при parking.capacityTotal, временно выставленном в 1, перенос второй брони на занятые даты возвращает ok:false с confirm:"force"; повтор с force:true сохраняет и пишет системную строку в ленту; перенос в зону резерва (между autoConfirmLimit и capacityTotal) сохраняется сразу и возвращает warning.
- Ручная проверка на stage после деплоя: провести бронь по пути заявка → «Ожидает оплаты» → «Заехал», убедиться, что в карточке появился «Договор №001», в ленте — строка «… → Заехал · договор №001», а в очереди сообщений — текст с номером брони и номером договора.


## Безопасность выкатки: чтобы старые брони не получили шквал сообщений

Этап 2 опасен не кодом сканера, а тем, что он впервые применит уже включённые правила и уже выставленный RUN_SCHEDULER=1 ко всей истории броней на stage. Три главные угрозы: массовый автоперевод старых оплаченных броней в «Не приехал» (на локальной базе это 3 полностью оплаченные брони от 27–28.08, на stage — те же демо плюс реальные заказчика), лавина Outbox-сообщений по правилам before_checkin_24h/before_checkout_2d/after_checkout_7d, которые в seed созданы isActive: true и никогда не исполнялись, и невозможность «выкатить выключенным», потому что выключателя в базе нет, а env на stage уже =1. Защита держится на трёх вещах: мастер-выключатель и холостой ход в Setting (не в env), дата холодного старта automation.startFrom (всё, что раньше, сканер не видит вообще) и потолок действий за проход с уведомлением администратору.


### Решения

**1. Что произойдёт при первом запуске планировщика на stage с реальными данными**

Четыре сценария вреда. (а) Массовый автопереход в «Не приехал»: сканер ищет AWAITING_PAYMENT/CONFIRMED с плановым заездом раньше now−48ч — под это подходит ВСЯ история. На локальной базе это брони №1, №2, №6 от 27–28.08, все три с paidAmount == amount. На stage к ним добавятся реальные брони заказчика. Каждая порождает Interaction + AuditLog + cancelPendingOutbox + onStatusChanged. (б) Лавина сообщений: правила before_checkin_24h, before_checkout_2d, after_checkout_7d лежат в базе isActive: true (prisma/seed.ts:105–107) и ни разу не исполнялись, потому что кода сканера нет. Наивное условие «плановый заезд − 24ч <= now» совпадёт со всей историей, а after_checkout_7d разошлёт «скидка 10 %» всем, кто когда-либо выехал. Отправки нет, поэтому в этапе 2 этого никто не заметит — рванёт в этапе 2а, когда включится отправщик Wazzup. (в) Порча статусов без пути назад: TRANSITIONS.NO_SHOW = [] (src/lib/crm/labels.ts:61), вернуть бронь можно только через correctStatus (OWNER/ADMIN + причина), а отменённые Outbox-строки correctStatus не восстанавливает (src/server/services/bookings.ts:187–190). (г) Гонка на enqueue: dispatcher.ts:25–29 делает findUnique, потом create — тик и действие администратора одновременно дают P2002 внутри транзакции transition(), и у администратора на воротах кнопка «Заехал» падает в «Ошибка сервера».

Защита по каждому: (а) automation.startFrom — дата холодного старта, всё с плановым заездом раньше сканер игнорирует; automation.autoNoShowSkipPaid = true (не трогать брони с paidAmount > 0); automation.maxPerTick — проход, который хочет тронуть больше N броней, не делает ничего и ставит AdminNotice. (б) тот же startFrom плюс выключить before_checkout_2d и after_checkout_7d в базе ДО деплоя (план, этап 2: «скидку заказчик не утверждал»), новые правила создавать isActive: false. (в) добавить переход NO_SHOW → AWAITING_PAYMENT и восстанавливать отменённые сообщения при возврате. (г) заменить findUnique+create на upsert по dedupKey.

**2. Какие существующие тесты сломаются от изменений этапа 2**

tests/unit/render.test.ts — два места. Строки 13 и 18 вызывают renderTemplate(body, { booking, client }): любое НОВОЕ ОБЯЗАТЕЛЬНОЕ поле контекста (links.route/links.review, contract) сломает компиляцию обоих тестов — новые поля делать необязательными. Строка 19 утверждает, что {{unknown.var}} превращается в пустую строку и результат равен «Иван +79055250660»: если для неизвестных переменных ввести заглушку «—» или бросать ошибку, тест падает. Смена схлопывания пробелов (/\s{2,}/ → /[ \t]{2,}/, MESSAGE_TEMPLATES строка 113) этот тест переживёт: хвостовой пробел снимет trim, переносов в теле теста нет. Мок брони (строки 6–9) не содержит days, paidAmount, transferNeeded, contractNumber — если новые переменные считать без запасных значений, в тексте появятся «undefined» и «NaN», и это надо закрывать НОВЫМ тестом, старый это не ловит.

tests/e2e/site-lead.mjs — три проверки. Строка 60 check(«статус „Новая заявка“») падает, если этап 2 меняет стартовый статус заявки с сайта или кто-то включит автоподтверждение на stage. Строки 65–66 читают блок «Сообщения клиенту» и требуют /TELEGRAM/ и /запланировано/i: разметка печатает «запланировано» только при status === "PENDING" (src/app/admin/(app)/bookings/[id]/page.tsx:183). Если этап 2 введёт «отправки нет → SKIPPED_NO_PROVIDER», карточка покажет «канал не подключён» и обе проверки упадут. Если переход на общий dedupGroup "confirmation" отключит on_new_lead, у новой заявки Outbox будет пуст, блок не отрисуется вовсе (условие b.outbox.length > 0, строка 173) — упадут те же две проверки.

tests/e2e/crm-pipeline.mjs — строка 54 check(«после полной оплаты статус „Подтверждена“») опирается на автоперевод в addPayment (bookings.ts:232–238), который вызывает onStatusChanged. Любая ошибка в новом правиле подтверждения (например P2002 на смене схемы dedupKey) откатит транзакцию платежа целиком, и упадёт не только эта проверка, но и возврат на строке 81.

tests/e2e/autoconfirm.mjs не сломается (даты +60…+210 дней), но оставляет живые брони, которые через два месяца станут кормом для авто-NO_SHOW без startFrom.

tests/unit/dates.test.ts, periods.test.ts, occupancy-math.test.ts, phone.test.ts, plural.test.ts (последний ещё не в git) ломаются только если трогать fmtDate/parkingDays/stamp. Плановое время считать НОВОЙ функцией, старые не менять.

**3. Где в коде есть места, которые молча проглотят ошибку и скроют поломку планировщика**

Одиннадцать мест по убыванию опасности. (1) docker/entrypoint.sh:7 — `|| echo "[entrypoint] seed failed (continuing)"`: если seed с новыми шаблонами упадёт, контейнер стартует с неполным набором правил, сканер каждую минуту находит ноль правил и молчит. Самое опасное, потому что seed выполняется при КАЖДОМ старте. (2) src/server/automations/dispatcher.ts:18 — `if (!rule.template || !rule.template.isActive) continue`: правило без шаблона или с выключенным шаблоном тихо не отправляет ничего. (3) dispatcher.ts:25–26 — `if (exists) return null`: дедуп молча глотает сообщение, а если строка уже в статусе CANCELLED (bookings.ts:195–197), сообщение не встанет в очередь НИКОГДА. (4) src/server/automations/render.ts:18 — `vars[k] ?? ""`: опечатка в {{booking.contract}} даёт дыру в тексте без единого признака ошибки. (5) src/server/services/audit.ts:15–17 — `catch {}` вокруг headers(): в фоновом проходе контекста запроса нет, headers() бросит, ошибка съедена; безвредно само по себе, но журнал не станет сигналом о поломке. (6) src/app/admin/actions/bookings.ts:150 — quoteAction возвращает null на любой ошибке: если этап 2 добавит туда повторную проверку мест и она упадёт, администратор увидит просто отсутствие цены. (7) bookings.ts:163 — searchClientsAction возвращает []. (8) src/app/admin/actions/settings.ts:51 — markNoticesReadAction глотает всё. (9) src/app/api/public/lead/route.ts:42 — антибот отвечает {ok:true} без создания заявки. (10) src/components/BookingCalculator.tsx:61 — catch {} на utm. (11) Будущий тик: setInterval с обёрткой catch(console.error) внутри Docker — логи никто не читает; плюс интерактивная транзакция Prisma по умолчанию обрывается через 5 секунд, откатывается и повторяется каждую минуту без следа.

Защита: правило «планировщик обязан оставлять след в базе» — ключи Setting automation.lastRunAt, automation.lastError, automation.lastCounts, обновляемые КАЖДЫЙ проход, и плашка в шапке CRM «планировщик молчит N минут». Плюс убрать `|| echo` из entrypoint и заменить глухой catch в тике на запись ошибки в Setting и AdminNotice.

**4. Что должно быть выключено по умолчанию и включаться настройкой**

Ключевой факт: на stage в .env уже RUN_SCHEDULER=1, поэтому «выкатить выключенным» через env НЕЛЬЗЯ — тик стартует в момент деплоя. Мастер-выключатель обязан жить в таблице Setting со значением по умолчанию false, а RUN_SCHEDULER остаётся только признаком «в этом процессе вообще есть таймер».

Новые ключи рядом с SETTINGS (src/server/services/settings.ts:5–10), все по умолчанию «ничего не делать»: automation.enabled = false (мастер); automation.dryRun = true (проход считает и записывает, что СДЕЛАЛ БЫ, но не трогает ни Booking, ни Outbox); automation.startFrom = ISO-дата холодного старта, по умолчанию дата деплоя; automation.maxPerTick = 20; automation.remind24h = false; automation.noShowNotice = false; automation.autoNoShow = false (отдельно от сообщения: сообщение безобиднее перевода статуса); automation.autoNoShowSkipPaid = true; automation.changedNotice = false; links.route = ""; links.review = ""; admin.notifyPhone = "".

Отдельно: шаблон с пустой обязательной ссылкой НЕ ставить в очередь — иначе клиент получит «Маршрут: » (ссылки от Влада и Яши ещё не пришли, docs/TZ_2026-09-21_PLAN.md:30). Новые AutomationRule создавать isActive: false. Правила вне ТЗ before_checkout_2d и after_checkout_7d выключить в базе до деплоя. И ловушка: seed для «синхронизируемых» правил делает `update: { ..., isActive: true }` (prisma/seed.ts:115) — если новые правила пометить sync, каждый рестарт контейнера будет включать их обратно поверх ручного выключения.

**5. Какой минимальный набор проверок докажет, что этап 2 ничего не сломал**

Четырнадцать проверок, первые четыре — до включения чего-либо. 1) npm test зелёный на всех шести файлах tests/unit, включая неотслеживаемый plural.test.ts. 2) Новые юнит-тесты на чистые функции расписания: плановое время из DATE + «06:30» по Москве = 03:30 UTC, без времени = 09:00 UTC (12:00 МСК); окно напоминания срабатывает ровно один раз и не срабатывает, если бронь создана позже момента «за сутки»; решение для брони раньше startFrom = «пропустить»; два прогона на одних данных дают одинаковый набор решений. 3) Мастер выключен: на копии дампа stage снять SQL-снимок (count по Booking.status, Outbox.status, AdminNotice), прогнать проход пять раз, снять снова — совпадает. 4) Холостой ход на копии дампа stage: отчёт перечисляет брони поимённо, глазами убедиться, что трёх оплаченных броней от 27–28.08 в списке нет и что при startFrom = сегодня список пуст. 5) Синтетика: четыре брони с плановым заездом −49ч оплаченная, −49ч неоплаченная, −25ч неоплаченная, +23ч; ожидается ровно NO_SHOW у одной, «вы не приехали» у двух, напоминание у одной, оплаченная не тронута. 6) Повторный проход — ноль новых строк и переходов. 7) Два прохода параллельно — нет 500, нет дублей, нет P2002 в логах. 8) Администратор жмёт «Заехал» в момент прохода — переход проходит. 9) npm run test:e2e зелёный локально и на stage, затем чистка tests/e2e/cleanup.sql. 10) Время в строке «запланировано» на карточке равно Outbox.scheduledAt плюс 3 часа. 11) Текст в Outbox.renderedText для брони без имени, договора и суток: нет «undefined», «NaN», висящей запятой, переносы сохранены (смотреть значение в базе, не вёрстку). 12) /api/cron/automations на stage: без заголовка 401, с неверным секретом 401, с верным и Basic Auth 200. 13) Рестарт контейнера: automation.lastRunAt растёт раз в минуту, а не дважды; выключенные правила остались выключенными после seed. 14) Откат: выключить automation.enabled — следующий проход ничего не делает.

**6. Чем опасен автопереход в «Не приехал» для денег и для занятости**

Для денег. Предоплаты по решению заказчика нет, но paidAmount > 0 бывает: перевод заранее и оплата на въезде, после которой addPayment сам переводит бронь в CONFIRMED (bookings.ts:232–238). На локальной базе ВСЕ три кандидата на авто-NO_SHOW оплачены полностью (2450, 1200, 400 ₽). Автоперевод такой брони означает: деньги остались в Payment, бронь ушла в терминальный статус, recalcDecidedAt пуст, возврата никто не оформил — у заказчика на руках чужие деньги без следа обязательства. Ухудшает то, что CancellationPolicy на stage стоит по умолчанию (noShowRule = NONE, holdAmount = 0): система не спишет и не вернёт ничего сама, решение повиснет на администраторе, который об этом не узнает. Плюс KPI: дашборд считает «отмены за месяц» как CANCELLED+NO_SHOW по updatedAt >= начала месяца (src/app/admin/(app)/dashboard/page.tsx:17) — массовый перевод разом задерёт эту цифру, и отчёт заказчику станет неверным.

Для занятости. NO_SHOW не входит в ACTIVE (autoconfirm.ts:18, occupancy.ts:8), поэтому перевод МГНОВЕННО освобождает место в общем пуле. Три следствия: (1) клиент задержался на сутки (рейс перенесли, администратор не двигал карточку) — место уже продано другому автоподтверждением, и при появлении машины стоянка в овербукинге; (2) вернуть бронь обычным путём нельзя — TRANSITIONS.NO_SHOW = [] (labels.ts:61), только correctStatus с причиной от OWNER/ADMIN, а отменённые при переходе сообщения (bookings.ts:148) correctStatus не воскрешает, то есть подтверждение клиенту потеряно навсегда; (3) прошлая занятость пересчитывается задним числом — сетка и occupancyToday (occupancy.ts:127) перестанут сходиться с тем, что заказчик видел вчера.

Защита: automation.autoNoShowSkipPaid = true по умолчанию (бронь с paidAmount > 0 никогда не переводится автоматически, вместо этого AdminNotice «бронь №N оплачена и не заехала — решите вручную»); startFrom отсекает историю; automation.maxPerTick ограничивает проход; добавить обратный переход NO_SHOW → AWAITING_PAYMENT и восстанавливать отменённые PENDING при возврате; системный перевод писать с userId = null и подписью «автоматически» (план, раздел 3).

**Можно ли системный переход сделать через существующий transition()**

Нет, и обход через подставного актора даст падающий каждую минуту проход. transition(bookingId, to, actor: SessionUser) обязательно пишет userId: actor.id в Interaction (строка 143) и вызывает audit(actor.id, …) (строка 147). Если подставить { id: "system" }, обе записи получат несуществующий User.id, Postgres вернёт ошибку внешнего ключа, транзакция откатится — и так каждую минуту. Нужна отдельная systemTransition с userId = null (Interaction.userId и AuditLog.userId уже необязательные), повторяющая ту же последовательность: canTransition, update, Interaction, audit, cancelPendingOutbox, onStatusChanged.

**Какие технические мины лежат вне логики сканера**

Четыре, каждая ломает этап 2 целиком. (1) instrumentation: в документации Next 16 (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md, раздел «Importing runtime-specific code») сказано прямо, что register вызывается ВО ВСЕХ окружениях — без проверки process.env.NEXT_RUNTIME === "nodejs" тик либо задвоится, либо упадёт в edge-рантайме, где нет Prisma. Там же: register «must complete before the server is ready» — внутри нельзя дожидаться самого прохода, только завести таймер. (2) src/proxy.ts:42–43: matcher ловит всё, кроме статики, значит /api/cron/automations на stage уйдёт под Basic Auth и внешний cron получит 401 вместо работы. Нужен явный пропуск пути, секрет проверяется в самом обработчике. (3) Prisma: интерактивная транзакция по умолчанию обрывается через 5 секунд — скан сотен броней одной транзакцией будет молча откатываться каждую минуту. Резать на пачки, каждую бронь своей короткой транзакцией. (4) Advisory-блокировка pg_advisory_xact_lock(240921) из autoconfirm.ts:11,21: если сканер (или повторная проверка мест в updateBooking) возьмёт её на долгий проход, каждая заявка с сайта будет ждать на /api/public/lead. Сканеру эту блокировку брать нельзя, а повторную проверку мест при правке дат делать предупреждением, а не запретом — иначе администратор перестанет продлевать брони на полной стоянке, а это работает сегодня.

**Что делать с неотправленными сообщениями, которые уже лежат в Outbox на stage**

Не трогать их автоматически в этапе 2 и не создать условий, при которых они уедут клиентам в этапе 2а. Конкретно: (а) при переходе на общую группу дедупликации подтверждения (dedupGroup: "confirmation", план раздел 2 п. 3) старые ключи вида on_awaiting_payment:<id> перестанут блокировать новый ключ confirmation:<id>, и у одной брони окажется ДВА подтверждения — при включении отправки клиент получит оба. Нужна разовая добавляющая миграция данных: переписать dedupKey у существующих PENDING либо проверять в enqueue оба ключа. (б) Отмену «устаревших сообщений по старым датам» при правке брони ограничить шаблонами, привязанными к датам, иначе первая же правка погасит неотправленное подтверждение. (в) Разовую чистку очереди (отменить всё старше N дней) делать отдельным осознанным действием с записью в журнал, а не побочным эффектом прохода.


### Файлы

- **src/server/services/settings.ts** — Добавить блок ключей автоматизации, все по умолчанию «ничего не делать». Мастер-выключатель именно здесь, а не в env: на stage RUN_SCHEDULER уже =1, и тик стартует в момент деплоя. Понадобятся строковый и датовый геттеры — сейчас есть только num() и сравнение с true.

```
export const AUTOMATION = {
  enabled: { key: "automation.enabled", def: false, label: "Планировщик сообщений" },
  dryRun: { key: "automation.dryRun", def: true, label: "Холостой ход: считать, но не менять" },
  // всё с плановым заездом раньше этой даты сканер не видит: на stage лежит вся история заказчика
  startFrom: { key: "automation.startFrom", def: "", label: "Считать брони начиная с" },
  maxPerTick: { key: "automation.maxPerTick", def: 20, label: "Потолок действий за один проход" },
  remind24h: { key: "automation.remind24h", def: false, label: "Напоминание за 24 часа" },
  noShowNotice: { key: "automation.noShowNotice", def: false, label: "Сообщение «вы не приехали»" },
  autoNoShow: { key: "automation.autoNoShow", def: false, label: "Автоперевод в «Не приехал» через 48 ч" },
  skipPaid: { key: "automation.autoNoShowSkipPaid", def: true, label: "Оплаченные не переводить автоматически" },
  lastRunAt: { key: "automation.lastRunAt", def: "", label: "Последний проход" },
  lastError: { key: "automation.lastError", def: "", label: "Последняя ошибка" },
} as const;
```

- **src/server/automations/schedule.ts** — НОВЫЙ файл: чистые функции расписания без базы, их и покрывать тестами. Плановое время считать здесь, НЕ переиспользуя stamp() из src/lib/periods.ts:15 — там Date.UTC, то есть «12:00» трактуется как UTC, и всё расписание уедет на 3 часа.

```
import { DEFAULT_TIME } from "@/lib/periods";
const MSK_OFFSET_MS = 3 * 3_600_000; // Москва с 2014 года без перевода часов

// dateFrom приходит из DATE как полночь UTC; время брони — московское
export function plannedAt(date: Date, time: string | null): Date {
  const [hh, mm] = (time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : DEFAULT_TIME).split(":").map(Number);
  return new Date(date.getTime() + (hh * 60 + mm) * 60_000 - MSK_OFFSET_MS);
}

export type Job = "remind24h" | "noShowNotice" | "autoNoShow" | null;

export function decide(b: { plannedAt: Date; createdAt: Date; paidAmount: number }, now: Date,
                       cfg: { startFrom: Date | null; skipPaid: boolean; window: number }): Job {
  if (cfg.startFrom && b.plannedAt < cfg.startFrom) return null; // холодный старт: историю не трогаем
  const d = now.getTime() - b.plannedAt.getTime();
  if (d >= 48 * 3_600_000) return cfg.skipPaid && b.paidAmount > 0 ? null : "autoNoShow";
  if (d >= 24 * 3_600_000) return "noShowNotice";
  const remindAt = b.plannedAt.getTime() - 24 * 3_600_000;
  // напоминание не ставим, если бронь создана позже момента «за сутки»
  if (now.getTime() >= remindAt && now.getTime() < remindAt + cfg.window && b.createdAt.getTime() < remindAt) return "remind24h";
  return null;
}
```

- **src/server/automations/dispatcher.ts** — Строки 25–29: заменить findUnique+create на upsert. Сейчас между проверкой и вставкой есть окно, и одновременный проход планировщика с действием администратора даёт P2002 внутри транзакции transition() — падение кнопки «Заехал» на воротах. Заодно поддержать общий ключ группы для подтверждения и будущий scheduledAt.

```
export async function enqueue(booking: Booking, ruleId: string | null, ruleCode: string, templateBody: string, tx: Tx = prisma, scheduledAt = new Date(), dedupGroup?: string) {
  const dedupKey = `${dedupGroup ?? ruleCode}:${booking.id}`;
  const client = booking.clientId ? await tx.client.findUnique({ where: { id: booking.clientId } }) : null;
  const renderedText = renderTemplate(templateBody, { booking, client });
  // upsert вместо findUnique+create: проход планировщика и действие администратора приходят одновременно
  return tx.outbox.upsert({
    where: { dedupKey },
    update: {},
    create: { ruleId, bookingId: booking.id, clientId: booking.clientId, channel: client?.messenger ?? "WHATSAPP", templateCode: ruleCode, renderedText, scheduledAt, dedupKey },
  });
}
```

- **src/server/automations/render.ts** — Строка 18: схлопывать только пробелы и табуляцию, переносы строк сохранять — иначе все четыре новых сообщения превратятся в один абзац. Каждой новой переменной дать явное запасное значение: мок в tests/unit/render.test.ts:6–9 не содержит days, paidAmount и contractNumber, и старый тест «undefined»/«NaN» не поймает. Новое поле контекста делать необязательным, иначе tests/unit/render.test.ts:13,18 не соберутся.

```
export function renderTemplate(body: string, ctx: { booking: Booking; client: Client | null; links?: { route?: string; review?: string } }): string {
  // ...
  "booking.contract": booking.contractNumber ? String(booking.contractNumber).padStart(3, "0") : "",
  "booking.days": String(booking.days ?? ""),
  return body
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/[ \t]{2,}/g, " ")   // переносы сохраняем: сообщение многострочное
    .replace(/ ,/g, ",")
    .replace(/,\s*!/g, "!")       // «Здравствуйте, !» при пустом имени
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
```

- **src/server/services/bookings.ts** — Добавить systemTransition с userId = null: через существующий transition() системный переход сделать нельзя — строки 143 и 147 пишут actor.id в Interaction.userId и AuditLog.userId, подставной id даст ошибку внешнего ключа на каждом проходе. Номер договора присваивать в том же data ДО tx.booking.update на строке 135, чтобы onStatusChanged на строке 149 получил бронь уже с номером; номер брать из последовательности Postgres, а не max()+1 — две одновременные регистрации на воротах дадут уникальное нарушение и отказ заезда.

```
// Системное действие: без пользователя, в ленте «автоматически» (план, раздел 3)
export async function systemTransition(bookingId: string, to: BookingStatus, why: string) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (!TRANSITIONS[b.status].includes(to)) return null;
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: to, noShowAt: to === "NO_SHOW" ? new Date() : undefined } });
    await tx.interaction.create({ data: { bookingId, clientId: b.clientId, type: "STATUS_CHANGE", text: `${STATUS_LABEL[b.status]} → ${STATUS_LABEL[to]} · автоматически: ${why}`, userId: null, meta: { from: b.status, to, system: true } } });
    await audit(null, "STATUS_CHANGE", "Booking", bookingId, { from: b.status, to, system: true, why }, tx);
    await cancelPendingOutbox(bookingId, tx);
    await onStatusChanged(updated, to, tx);
    return updated;
  });
}

// в transition(), внутри data, до строки 135:
if (to === "CHECKED_IN" && !b.contractNumber) {
  const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('contract_number_seq')`;
  data.contractNumber = Number(nextval);
}
```

- **src/lib/crm/labels.ts** — Строка 61: открыть обратный переход из «Не приехал». Сейчас NO_SHOW: [] — после автоперевода бронь нельзя вернуть ничем, кроме correctStatus, а он не восстанавливает отменённые сообщения. Это делает автоперевод необратимым для администратора на смене.

```
// Автоперевод в «Не приехал» обратим: клиент мог задержаться, место надо вернуть
  NO_SHOW: ["AWAITING_PAYMENT"],
```

- **src/instrumentation.ts** — НОВЫЙ файл. Обязательна проверка NEXT_RUNTIME: по документации Next 16 register вызывается во всех окружениях, включая edge, где нет Prisma. Внутри register нельзя дожидаться самого прохода — сервер не станет готов, пока register не завершится. Защита от повторной регистрации таймера через globalThis.

```
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // register вызывается и в edge — там нет Prisma
  if (process.env.RUN_SCHEDULER !== "1") return;
  const g = globalThis as { __p24tick?: NodeJS.Timeout };
  if (g.__p24tick) return;
  const { tick } = await import("@/server/automations/tick");
  g.__p24tick = setInterval(() => { void tick(); }, 60_000); // tick не бросает наружу
}
```

- **src/server/automations/tick.ts** — НОВЫЙ файл. Каждый проход обязан оставлять след в базе, иначе поломка невидима (логи контейнера никто не читает). Одна бронь — одна короткая транзакция: интерактивная транзакция Prisma обрывается по умолчанию через 5 секунд, и большой скан одной транзакцией будет молча откатываться каждую минуту. Advisory-блокировку занятости здесь брать нельзя — заявки с сайта встанут в очередь.

```
export async function tick() {
  const cfg = await automationSettings();
  await setSetting(AUTOMATION.lastRunAt.key, new Date().toISOString()); // след есть всегда, даже когда выключено
  if (!cfg.enabled) return;
  try {
    const rows = await candidates(cfg); // один SELECT с отсечкой по startFrom, kind: "PARKING"
    if (rows.length > cfg.maxPerTick) {
      await notify("CHANNEL_DOWN", `Планировщик остановлен: к обработке ${rows.length} броней при потолке ${cfg.maxPerTick}`);
      return;
    }
    for (const r of rows) {
      const job = decide(r, new Date(), cfg);
      if (!job || cfg.dryRun) continue; // холостой ход только считает
      await run(job, r); // своя короткая транзакция на каждую бронь
    }
    await setSetting(AUTOMATION.lastError.key, "");
  } catch (e) {
    await setSetting(AUTOMATION.lastError.key, String(e).slice(0, 500));
  }
}
```

- **src/proxy.ts** — Строки 8–23: исключить /api/cron из Basic Auth. Matcher на строке 43 ловит всё, кроме статики, поэтому внешний cron на stage (где заданы BASIC_AUTH_USER/PASS) получит 401 вместо запуска. Секрет проверяется в самом обработчике по заголовку X-Cron-Secret.

```
const { pathname } = req.nextUrl;
  // cron ходит без браузера: свой секрет в заголовке, Basic Auth ему не нужен
  const isCron = pathname.startsWith("/api/cron");
  if (user && pass && !isCron) {
    // ... существующая проверка
  }
```

- **prisma/seed.ts** — Строки 103–118: новые правила этапа 2 создавать isActive: false; before_checkout_2d и after_checkout_7d выключить разово (план, этап 2 — скидку заказчик не утверждал). Осторожно со строкой 115: для «синхронизируемых» правил update принудительно ставит isActive: true, то есть каждый рестарт контейнера возвращает включённое состояние поверх ручного выключения. Тексты синхронизировать, флаг активности — нет.

```
// тексты ведёт seed, включение — только руками через настройки
  await prisma.automationRule.upsert({
    where: { code: r.code },
    update: sync ? { name: r.name, templateId: r.templateId } : {}, // isActive не трогаем
    create: { code: r.code, name: r.name, trigger: r.trigger, triggerParams: r.triggerParams, templateId: r.templateId, isActive: false },
  });
  await prisma.automationRule.updateMany({ where: { code: { in: ["before_checkout_2d", "after_checkout_7d"] } }, data: { isActive: false } });
```

- **docker/entrypoint.sh** — Строка 7: убрать `|| echo "[entrypoint] seed failed (continuing)"`. Сейчас падение seed проглатывается, контейнер стартует с неполным набором шаблонов и правил, и планировщик каждую минуту молча находит ноль правил. Это главное место, которое скроет поломку этапа 2.

```
if [ "${SEED_ON_START:-1}" = "1" ]; then
  echo "[entrypoint] seed (idempotent)"
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts   # падение seed должно валить старт: иначе правила молча отсутствуют
fi
```

- **src/app/admin/(app)/bookings/[id]/page.tsx** — Строка 183: время в строке «запланировано» печатается через fmtDate, у которого жёстко timeZone: "UTC" (src/server/lib/dates.ts:39), тогда как вся лента идёт через fmtDateTime по Москве. Администратор увидит напоминание на 09:00 вместо 12:00 и решит, что планировщик считает неправильно.

```
{o.status === "PENDING" ? `запланировано ${fmtDateTime(o.scheduledAt)}` : o.status}
```

- **prisma/schema.prisma** — Только добавляющие правки: Booking.contractNumber Int? @unique; AutomationTrigger + BOOKING_CHANGED, AFTER_PLANNED_CHECKIN. Новые значения enum — ОТДЕЛЬНОЙ миграцией, без использования в ней же (предыдущая миграция 20260921183724 сделана именно так). Последовательность номера договора завести CREATE SEQUENCE в миграции, а не считать max()+1 в коде.

```
-- миграция 1: только значения enum
ALTER TYPE "AutomationTrigger" ADD VALUE 'BOOKING_CHANGED';
ALTER TYPE "AutomationTrigger" ADD VALUE 'AFTER_PLANNED_CHECKIN';
-- миграция 2: поля и последовательность
ALTER TABLE "Booking" ADD COLUMN "contractNumber" INTEGER;
CREATE UNIQUE INDEX "Booking_contractNumber_key" ON "Booking"("contractNumber");
CREATE SEQUENCE IF NOT EXISTS contract_number_seq START 1;
```

- **tests/unit/schedule.test.ts** — НОВЫЙ файл: покрыть чистые функции расписания до того, как что-либо включится — московское плановое время, окно напоминания, отсечка по startFrom, пропуск оплаченных, идемпотентность решения.

```
test("плановое время: дата DATE плюс московское время брони", () => {
  assert.equal(plannedAt(new Date("2026-10-01T00:00:00Z"), "06:30").toISOString(), "2026-10-01T03:30:00.000Z");
  assert.equal(plannedAt(new Date("2026-10-01T00:00:00Z"), null).toISOString(), "2026-10-01T09:00:00.000Z"); // 12:00 МСК
});

test("холодный старт: брони раньше startFrom не трогаются", () => {
  const old = { plannedAt: new Date("2026-08-27T03:30:00Z"), createdAt: new Date("2026-08-20T00:00:00Z"), paidAmount: 2450 };
  assert.equal(decide(old, new Date("2026-09-22T10:00:00Z"), { startFrom: new Date("2026-09-22T00:00:00Z"), skipPaid: true, window: 60_000 }), null);
});
```

- **tests/e2e/scheduler-safety.mjs** — НОВЫЙ сценарий: доказать, что с выключенным мастером и в холостом ходу проход не меняет ни одной строки — снимок count по Booking.status, Outbox.status и AdminNotice до и после пяти проходов совпадает.
- **tests/e2e/site-lead.mjs** — Строки 60 и 65–66 — самые хрупкие места под этап 2. Если меняется стартовый статус заявки или статус строки Outbox (например появится SKIPPED_NO_PROVIDER вместо PENDING), проверки «статус „Новая заявка“», /TELEGRAM/ и /запланировано/i упадут. Либо сохранить поведение, либо править тест осознанно вместе с кодом, а не подгонять после падения.

### Риски

- **Риск:** Первый проход переводит в «Не приехал» все старые брони в AWAITING_PAYMENT/CONFIRMED, включая полностью оплаченные. На локальной базе под это подходят брони №1, №2, №6 от 27–28.08 с paidAmount == amount (2450, 1200, 400 ₽); на stage к ним добавляются реальные брони заказчика. Деньги остаются у заказчика без оформленного обязательства, бронь уходит в тупиковый статус, KPI «отмены за месяц» на дашборде взлетает.
  **Что делаем:** automation.autoNoShow = false по умолчанию; automation.startFrom — дата холодного старта, брони с более ранним плановым заездом сканер не видит вообще; automation.autoNoShowSkipPaid = true (оплаченная бронь не переводится автоматически, вместо этого AdminNotice); automation.maxPerTick — проход, который хочет тронуть больше N броней, не делает НИЧЕГО и зовёт администратора; обязательный прогон в холостом ходу на копии дампа stage со сверкой списка глазами.
- **Риск:** Лавина сообщений по правилам, которые уже включены и никогда не исполнялись: before_checkin_24h, before_checkout_2d, after_checkout_7d лежат в базе с isActive: true (prisma/seed.ts:105–107). Наивный сканер («плановый заезд − 24ч <= now») совпадёт со всей историей, а after_checkout_7d предложит скидку 10 % каждому, кто когда-либо выехал. В этапе 2 это невидимо — отправки нет; рванёт в этапе 2а при включении Wazzup.
  **Что делаем:** Сканер сравнивает не «раньше момента», а попадание в окно [момент, момент + длительность прохода); отсечка по startFrom; before_checkout_2d и after_checkout_7d выключить в базе ДО деплоя (план прямо требует: скидку заказчик не утверждал); новые правила создавать isActive: false; счётчик очереди в CRM, чтобы массовое наполнение Outbox было видно до включения отправки.
- **Риск:** «Выкатить выключенным» невозможно: на stage в .env уже RUN_SCHEDULER=1, а выключателя в базе нет — проход начнёт работать в секунду деплоя. Вдобавок docker/entrypoint.sh запускает seed при каждом старте, а для «синхронизируемых» правил seed принудительно ставит isActive: true (prisma/seed.ts:115), то есть ручное выключение переживёт не каждый рестарт.
  **Что делаем:** Мастер-выключатель automation.enabled в таблице Setting со значением false по умолчанию, проверяется внутри самого прохода; RUN_SCHEDULER оставить только признаком «в этом процессе есть таймер»; новые правила не помечать sync или убрать isActive из ветки update в seed; перед деплоем бэкап базы stage (docker/backup.sh), как требует раздел 3 плана.
- **Риск:** Автоперевод в «Не приехал» необратим для администратора: TRANSITIONS.NO_SHOW = [] (src/lib/crm/labels.ts:61). Вернуть бронь можно только через correctStatus (OWNER/ADMIN, причина обязательна), а отменённые при переходе сообщения (bookings.ts:148 → cancelPendingOutbox) correctStatus не восстанавливает (bookings.ts:187–190) — подтверждение клиенту теряется навсегда.
  **Что делаем:** Открыть переход NO_SHOW → AWAITING_PAYMENT; при возврате из NO_SHOW восстанавливать CANCELLED-строки Outbox, у которых момент отправки ещё не прошёл; системный переход писать с userId = null и подписью «автоматически», чтобы в ленте было видно, что это сделала система.
- **Риск:** Гонка на постановке сообщения: dispatcher.ts:25–29 делает findUnique, затем create. Проход планировщика и действие администратора, пришедшие одновременно на одну бронь, дают P2002 внутри транзакции transition() или addPayment() — кнопка «Заехал» или проведение оплаты падают в «Ошибка сервера», вся транзакция откатывается.
  **Что делаем:** Заменить на tx.outbox.upsert по dedupKey (update: {}); проверить сценарием: два параллельных прохода плюс действие администратора — ни одного 500, ни одного дубля, ни одного P2002 в логах.
- **Риск:** Номер договора через max(contractNumber)+1 внутри транзакции заезда: две одновременные регистрации дают уникальное нарушение, и заезд не проходит. Это худшее место для отказа — клиент стоит у шлагбаума.
  **Что делаем:** CREATE SEQUENCE contract_number_seq отдельной добавляющей миграцией, номер брать через nextval внутри того же data, что и смена статуса (до tx.booking.update на bookings.ts:135), чтобы onStatusChanged на строке 149 получил бронь уже с номером и {{booking.contract}} не отрендерился пустым.
- **Риск:** Плановое время посчитано не по Москве. Готовая функция stamp() в src/lib/periods.ts:15 использует Date.UTC, то есть «12:00» трактует как UTC. Переиспользование даст напоминание в 15:00 МСК вместо 12:00, а авто-NO_SHOW сработает на 3 часа позже — для брони это лишние часы удержания места.
  **Что делаем:** Отдельная функция plannedAt в новом src/server/automations/schedule.ts с явным вычетом 3 часов (Москва с 2014 года без перевода часов); юнит-тест на «06:30» → 03:30Z и на отсутствие времени → 09:00Z; stamp() и parkingDays не трогать, иначе поедут цены и упадёт tests/unit/periods.test.ts.
- **Риск:** Внешний cron на stage получит 401: matcher в src/proxy.ts:42–43 покрывает всё, кроме статики, и на stage с заданными BASIC_AUTH_USER/PASS запрос к /api/cron/automations будет отбит Basic Auth до обработчика. Выглядит как «планировщик не работает», причина неочевидна.
  **Что делаем:** Явный пропуск /api/cron в proxy до проверки Basic Auth; секрет проверять в самом обработчике по X-Cron-Secret; проверка на stage: без секрета 401, с неверным 401, с верным 200.
- **Риск:** Проход задваивается или падает из-за рантайма: по документации Next 16 (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md, раздел «Importing runtime-specific code») register вызывается во всех окружениях, включая edge, где Prisma не работает. Там же сказано, что register должен завершиться до готовности сервера — длинная работа внутри задержит старт контейнера.
  **Что делаем:** Проверка process.env.NEXT_RUNTIME === "nodejs" в начале register; защита от повторной регистрации таймера через globalThis; внутри register только setInterval, без await самого прохода; после рестарта проверить, что automation.lastRunAt растёт раз в минуту, а не дважды.
- **Риск:** Скан всей истории одной интерактивной транзакцией Prisma упирается в стандартный таймаут 5 секунд, откатывается целиком и повторяется каждую минуту без единого следа — планировщик «работает» и не делает ничего.
  **Что делаем:** Один SELECT кандидатов вне транзакции, затем на каждую бронь своя короткая транзакция; потолок maxPerTick; запись automation.lastRunAt/lastError/lastCounts каждый проход и плашка в шапке CRM «планировщик молчит N минут».
- **Риск:** Переход на общий ключ дедупликации подтверждения (dedupGroup: "confirmation", план раздел 2 п. 3) оставит существующие PENDING-строки на stage со старыми ключами вида on_awaiting_payment:<id>. Они перестанут блокировать новый ключ confirmation:<id>, и у брони окажется два подтверждения — при включении Wazzup в этапе 2а клиент получит оба.
  **Что делаем:** Разовая добавляющая миграция данных: переписать dedupKey у существующих PENDING под новую схему либо проверять в enqueue оба ключа; после миграции сверить, что у каждой брони не больше одной PENDING-строки группы «подтверждение».
- **Риск:** Повторная проверка мест и отмена устаревших сообщений в updateBooking (план, этап 2) ломают работающий сегодня сценарий: если проверка мест станет запретом, администратор перестанет продлевать брони на полной стоянке; если отмену PENDING сделать через updateMany по bookingId (как уже написано в correctStatus, bookings.ts:187), первая же правка одной из лежащих на stage броней погасит её неотправленное подтверждение.
  **Что делаем:** Проверку мест при правке дат делать предупреждением с подтверждением, а не отказом; отмену ограничить шаблонами, привязанными к датам (напоминание, «к оплате»), подтверждение не трогать; advisory-блокировку pg_advisory_xact_lock(240921) из autoconfirm.ts:11 в сканере НЕ брать — иначе заявки с сайта будут ждать окончания прохода.
- **Риск:** Тексты сообщений разваливаются на старых данных: renderTemplate схлопывает переносы строк (render.ts:18), новые переменные без запасных значений дадут пустой «договор №», «undefined сут.» и «NaN ₽» — мок в tests/unit/render.test.ts:6–9 не содержит days, paidAmount и contractNumber, то есть существующий тест эту дыру не ловит. Плюс пустое имя даёт «Здравствуйте, !».
  **Что делаем:** Схлопывать только пробелы и табуляцию; каждой новой переменной явное запасное значение; правило «шаблон с пустой обязательной ссылкой (links.route, links.review ещё не получены от Влада и Яши) в очередь не ставится»; новый юнит-тест на бронь без имени, договора и суток.
- **Риск:** Сканер захватит брони комнат: onStatusChanged подбирает правила с kind = null для любого вида ресурса (dispatcher.ts:11), а у комнат сутки считаются 24-часовыми периодами, и условия «за 24 часа» и «через 48 часов» к ним неприменимы в том же виде.
  **Что делаем:** Все запросы сканера с kind: "PARKING"; в новых правилах явно указывать kind; тест: бронь ROOM с плановым заездом −49ч не попадает ни под одно решение.
- **Риск:** Время в очереди на карточке брони показывается по UTC: строка 183 в src/app/admin/(app)/bookings/[id]/page.tsx печатает scheduledAt через fmtDate с жёстким timeZone: "UTC" (dates.ts:39), тогда как лента событий идёт через fmtDateTime по Москве. Администратор увидит напоминание на 09:00 вместо 12:00 и решит, что планировщик считает неправильно.
  **Что делаем:** Заменить на fmtDateTime; проверка: время в карточке равно значению Outbox.scheduledAt плюс 3 часа.
- **Риск:** Массовое срабатывание засыпает колокольчик сотнями AdminNotice и забивает ленту брони и журнал аудита: каждый системный переход пишет Interaction и AuditLog, а notify() вызывается на каждую бронь.
  **Что делаем:** Одно сводное уведомление на проход («автоматически переведено N броней»), а не по одному на бронь; потолок maxPerTick; при превышении — уведомление вместо действия.
- **Риск:** Занятость и отчёты меняются задним числом: NO_SHOW не входит в ACTIVE (autoconfirm.ts:18, occupancy.ts:8), поэтому массовый перевод пересчитает прошлую занятость в сетке и в occupancyToday (occupancy.ts:127), а дашборд задерёт «отмены за месяц» (dashboard/page.tsx:17). Заказчик увидит не те цифры, что вчера.
  **Что делаем:** Отсечка startFrom не даёт трогать прошлое вообще; снимок count по статусам до и после первого включения как доказательство; предупредить заказчика перед включением автоперевода.
- **Риск:** Сообщение, однажды попавшее под отмену, больше не встанет в очередь никогда: enqueue считает существование строки по dedupKey независимо от статуса (dispatcher.ts:25–26), а переходы в CANCELLED/NO_SHOW/REJECTED переводят PENDING в CANCELLED (bookings.ts:148,195–197). После возврата брони из «Отклонена» в «Ожидает оплаты» часть цепочки молча пропадает.
  **Что делаем:** При возврате брони из терминального статуса возвращать CANCELLED-строки в PENDING, если момент отправки ещё не прошёл; для напоминаний использовать ключ с датой (план, раздел 2 п. 8), чтобы смена дат сама порождала новую строку.

### Что покрыть тестами

- npm test — все шесть файлов tests/unit зелёные, включая неотслеживаемый plural.test.ts; ни один существующий assert не правился «под новый код»
- Новый tests/unit/schedule.test.ts: plannedAt(DATE, "06:30") = 03:30Z и plannedAt(DATE, null) = 09:00Z (12:00 МСК); напоминание срабатывает ровно один раз и не срабатывает, если createdAt позже момента «за сутки»; decide возвращает null для брони раньше startFrom; decide возвращает null при paidAmount > 0 и skipPaid; два прогона на одних данных дают одинаковый набор решений
- Новый тест рендера: бронь без имени, без contractNumber, без days — в тексте нет «undefined», «NaN» и «Здравствуйте, !», переносы строк сохранены (проверять строку, а не вёрстку)
- Мастер выключен: на копии дампа stage снять SQL-снимок (count по Booking.status, Outbox.status, AdminNotice), прогнать проход пять раз, снять снова — совпадает
- Холостой ход на копии дампа stage: отчёт перечисляет брони поимённо; глазами убедиться, что трёх оплаченных броней от 27–28.08 в списке нет и что при startFrom = сегодня список пуст
- Синтетика на локальной базе: четыре брони с плановым заездом −49ч оплаченная, −49ч неоплаченная, −25ч неоплаченная, +23ч. Ожидается ровно: NO_SHOW только у −49ч неоплаченной, «вы не приехали» у двух, напоминание у одной, оплаченная не тронута
- Идемпотентность: второй проход сразу после первого — ноль новых строк Outbox, ноль новых переходов
- Гонка: два прохода параллельно (два curl по /api/cron/automations плюс встроенный таймер) — ни одного 500, ни одного дубля в Outbox, ни одного P2002 в логах
- Конфликт с человеком: администратор жмёт «Заехал» и проводит оплату в момент прохода — переход и платёж проходят, «Ошибка сервера» не появляется
- npm run test:e2e зелёный локально и на stage (site-lead, crm-pipeline, autoconfirm), затем обязательная чистка tests/e2e/cleanup.sql — тестовые брони иначе займут места в сетке и попадут в сканер
- Карточка брони: время в строке «запланировано» равно Outbox.scheduledAt плюс 3 часа (проверка перехода с fmtDate на fmtDateTime)
- Заезд и номер договора: два одновременных перехода в «Заехал» дают два разных номера, оба заезда проходят, в тексте сообщения номер вида 003, а не пустое место
- /api/cron/automations на stage: без заголовка 401, с неверным секретом 401, с верным секретом и включённым Basic Auth 200 (то есть путь исключён из proxy)
- Рестарт контейнера: automation.lastRunAt растёт раз в минуту, а не дважды; выключенные правила before_checkout_2d и after_checkout_7d остались выключенными после прогона seed
- Откат: выключить automation.enabled — следующий проход не меняет ни статусов, ни очереди, при этом automation.lastRunAt продолжает расти (планировщик жив, но бездействует)


## Экран администратора: очередь сообщений в карточке брони

Блок «Сообщения клиенту» в карточке брони (bookings/[id]/page.tsx:173–191) надо превратить из дампа Outbox в две группы — «Уйдут» (будущие события + очередь) и «Ушли» (история), с человеческим названием сообщения, мессенджером и временем по Москве, и с честной полосой «отправка пока не подключена», потому что статус SKIPPED_NO_PROVIDER в коде не проставляется нигде и PENDING сейчас врёт «запланировано». Будущие автособытия (напоминание, «не приехали», автоосвобождение места) считает один модуль src/server/automations/schedule.ts, который читают и сканер этапа 2, и карточка — иначе прогноз в карточке разойдётся с поведением планировщика. Страница настроек нужна одна — /admin/settings/messages (сейчас /templates и /automations оба 404): выключатель правила, текст с предпросмотром и «вернуть по умолчанию», а сверху блок ссылок links.route / links.review; в колокольчик из этапа 2 пускаем только два вида событий — «сообщение не ушло окончательно» и «бронь освобождена автоматически».


### Решения

**1. Как показать очередь сообщений понятнее, чем технический код шаблона и латинский статус**

Разбить блок на две группы: «Уйдут» (прогноз будущих сообщений + записи PENDING) и «Ушли» (SENT/FAILED/CANCELLED, новые сверху). Строка = человеческое название («Бронь подтверждена», «Напоминание за сутки», «Автомобиль принят», «Спасибо и отзыв») + «в WhatsApp на +7 905 525-06-60» + время по Москве словами («уйдёт завтра в 12:00», «ушло 1 окт в 12:03», «не ушло 1 окт в 12:03 · номер не в списке разрешённых»). Текст сообщения — свёрнут до двух строк с «показать полностью», с whitespace-pre-line. Над списком — честная полоса состояния: «Отправка сообщений ещё не подключена. Сообщения копятся в очереди и уйдут, когда подключим WhatsApp» (признак считается на сервере по наличию ключа провайдера). Блок показывать всегда, даже когда очередь пуста.

**Откуда карточка узнаёт, что отправки нет**

Серверный признак messagingEnabled() в src/server/services/settings.ts (`!!process.env.WAZZUP_API_KEY`), плюс признак планировщика `process.env.RUN_SCHEDULER === "1"`. Оба передаются в компонент пропсами, в браузер ключ не попадает.

**2. Что показать про будущие автоматические события и где**

Два разных места. (а) Сообщения-по-времени («напоминание уйдёт 1 октября в 12:00», «спасибо и отзыв — через 2 часа после выезда») — строками группы «Уйдут» в том же блоке «Сообщения клиенту», визуально бледнее очереди, с пометкой «по расписанию». (б) Событие, меняющее статус («если не приедет, освободим место 3 октября в 12:00»), — отдельной строкой сразу под StageBar, тоном warning, рядом с полосой этапов: это не сообщение, а действие над бронью, и админ должен видеть его без прокрутки. Когда условие не выполняется — пишем почему: «напоминание не уйдёт: бронь создана позже, чем за сутки до заезда», «планировщик выключен — автоматические события не сработают».

**Как не развести прогноз в карточке и поведение сканера**

Один модуль src/server/automations/schedule.ts: plannedCheckIn(booking) (дата + время по Москве, без времени 12:00) и plannedEvents(booking, policy) → [{code, at, skip?}]. Сканер этапа 2 ставит сообщения по этому же списку, карточка его же рисует.

**3. Нужна ли страница настроек шаблонов и автоматизаций**

Нужна, но одна: /admin/settings/messages вместо двух битых ссылок. Правило и шаблон в seed связаны один к одному, заказчику нужно ровно две вещи — включить/выключить и поправить текст. Устройство сверху вниз: 1) карточка «Ссылки в сообщениях» (маршрут, отзывы, телефон администратора для уведомлений); 2) полоса состояния «отправка подключена / не подключена», «планировщик работает»; 3) список сообщений тремя группами — «Основная цепочка» (подтверждение, напоминание, заезд, спасибо), «Особые случаи» (отклонение, не приехали, бронь изменена), «Выключено» (before_checkout_2d, after_checkout_7d со скидкой, которую заказчик не утверждал); в строке — название, когда уходит словами, переключатель, канал, две строки текста и «Изменить»; 4) редактор: textarea, палитра переменных кликом, живой предпросмотр на последней реальной брони, «Вернуть текст по умолчанию», проверка неизвестных переменных; 5) только OWNER, каждое изменение в audit. Оба старых адреса /settings/templates и /settings/automations ведут на неё.

**Откуда берутся тексты по умолчанию и что с seed**

Каталог шаблонов и правил переезжает из prisma/seed.ts в src/server/automations/defaults.ts; seed импортирует его, страница настроек — тоже (для «вернуть по умолчанию» и для значка «текст изменён вручную»). Механизм sync:true отключается для кодов, редактируемых через CRM; вместо него — поле-признак ручной правки (или сравнение с defaults).

**4. Где в CRM задавать маршрут проезда и ссылку на отзывы**

Блоком «Ссылки в сообщениях» вверху /admin/settings/messages, ключи links.route, links.review (и admin.notifyPhone рядом). Читает отдельная функция linkSettings() в settings.ts (строки, не числа), в шаблон попадают через ctx у renderTemplate. Пока ссылка пустая — на странице настроек красный значок у сообщений, которые её используют, и подсказка «сообщение уйдёт без ссылки». Дублировать ссылки в карточку брони не нужно.

**5. Что из этапа 2 попадает в колокольчик**

Только два новых вида: MESSAGE_FAILED — «Сообщение клиенту по брони №N не отправлено» (после последней попытки, не чаще одного непрочитанного на бронь) и AUTO_NO_SHOW — «Бронь №N: клиент не приехал, место освобождено автоматически». Плюс уже существующие BOOKING_REJECTED и CHANNEL_DOWN (канал отвалился). НЕ попадает: каждое успешно отправленное сообщение, постановка в очередь, каждое напоминание, промежуточные повторы до финальной ошибки, отмена устаревших сообщений при смене дат, сообщение «вы не приехали» само по себе, пустая необязательная переменная (это значок на странице настроек), статусы «доставлено/прочитано» из вебхука.

**Должен ли колокольчик обновляться сам**

Да, лёгким опросом счётчика раз в минуту при видимой вкладке, router.refresh() только при изменении числа.


### Файлы

- **src/app/admin/(app)/bookings/[id]/page.tsx** — Заменить блок строк 173–191 вызовом <MessageQueue …>, собрав строки на сервере; перенести блок выше <EditBooking> (сейчас он под формой редактирования, строка 166). Под <StageBar> (строка 88) добавить строку авто-освобождения. Починить время: fmtDate на строке 183 печатает UTC.

```
const links = await linkSettings();
const planned = plannedEvents(b, policy); // прогноз и очередь считаются из одного модуля

{/* Сообщения клиенту: что уйдёт и что уже ушло */}
<MessageQueue
  sending={messagingEnabled()}
  scheduler={process.env.RUN_SCHEDULER === "1"}
  to={formatPhone(b.contactPhone)}
  channel={b.client?.messenger ?? "WHATSAPP"}
  planned={planned.map((p) => ({ code: p.code, when: fmtWhen(p.at), skip: p.skip }))}
  rows={b.outbox.map((o) => ({
    id: o.id, code: o.templateCode, channel: o.channel, status: o.status,
    when: fmtWhen(o.sentAt ?? o.scheduledAt), error: o.lastError, text: o.renderedText,
  }))}
/>
```

- **src/components/admin/booking/MessageQueue.tsx** — Новый компонент. Полоса состояния отправки, группа «Уйдут» (прогноз бледнее очереди), группа «Ушли». Текст сообщения — whitespace-pre-line и line-clamp-2 с раскрытием по <details>.

```
{!sending && (
  <p className="mb-3 flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-[#8a5a00]">
    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
    Отправка сообщений ещё не подключена: они копятся в очереди и уйдут, когда подключим WhatsApp.
  </p>
)}
<div className="text-sm font-semibold">{MESSAGE_LABEL[r.code] ?? r.code}</div>
<div className="font-mono text-[11px] text-ink-muted">
  {WHEN[r.status]} {r.when} · {CHANNEL_LABEL[r.channel]} {to}
  {r.status === "FAILED" && r.error && ` · ${outboxErrorLabel(r.error)}`}
</div>
<details className="mt-1"><summary className="cursor-pointer text-xs text-ink-muted">Текст сообщения</summary>
  <div className="mt-1 whitespace-pre-line text-sm">{r.text}</div>
</details>
```

- **src/components/admin/booking/NextSteps.tsx** — Новая строка под StageBar: автоосвобождение места и выключенный планировщик. Показывать только для статусов AWAITING_PAYMENT и CONFIRMED до заезда.

```
// Место держится, пока клиент не приехал; через 48 ч после планового заезда бронь освобождается сама
<p className="flex items-center gap-2 border-b border-line px-5 py-2 text-sm text-[#8a5a00]">
  <Clock size={15} /> Если клиент не приедет, освободим место {fmtWhen(autoNoShowAt)}
  {!scheduler && <span className="font-semibold">· планировщик выключен, автоматически не сработает</span>}
</p>
```

- **src/server/automations/schedule.ts** — Новый модуль: плановое время заезда по Москве и список будущих автособытий. Читают и сканер этапа 2, и карточка брони.

```
// Плановый заезд: дата брони + время по Москве; времени нет — 12:00 (DEFAULT_TIME из periods.ts)
export function plannedCheckIn(b: Pick<Booking, "dateFrom" | "timeFrom">): Date { /* … */ }

export type Planned = { code: string; at: Date; skip?: string };

// Что ещё должно произойти по брони. skip — почему событие не состоится
export function plannedEvents(b: Booking, policy: { autoNoShowAfterHours: number }): Planned[] {
  const checkIn = plannedCheckIn(b);
  const out: Planned[] = [];
  if (["AWAITING_PAYMENT", "CONFIRMED"].includes(b.status)) {
    out.push({ code: "before_checkin_24h", at: addHours(checkIn, -24),
      skip: b.createdAt > addHours(checkIn, -24) ? "бронь создана позже, чем за сутки до заезда" : undefined });
    out.push({ code: "on_no_show", at: addHours(checkIn, policy.autoNoShowAfterHours) });
    out.push({ code: "auto_no_show", at: addHours(checkIn, policy.autoNoShowAfterHours * 2) });
  }
  if (b.status === "CHECKED_OUT" && b.checkedOutAt) out.push({ code: "after_checkout_2h", at: addHours(b.checkedOutAt, 2) });
  return out;
}
```

- **src/lib/crm/labels.ts** — Добавить MESSAGE_LABEL (код правила → название сообщения), OUTBOX_STATUS_LABEL и WHEN-префиксы. Держать рядом с остальными картами подписей.

```
// Названия сообщений клиенту. Ключ — код правила (Outbox.templateCode)
export const MESSAGE_LABEL: Record<string, string> = {
  on_new_lead: "Заявка принята", on_awaiting_payment: "Бронь подтверждена", on_confirmed: "Бронь подтверждена",
  before_checkin_24h: "Напоминание за сутки", on_checked_in: "Автомобиль принят", after_checkout_2h: "Спасибо и отзыв",
  on_rejected: "Заявка отклонена", on_no_show: "Вы не приехали", on_changed: "Бронь изменена",
};

export const OUTBOX_STATUS_LABEL: Record<OutboxStatus, string> = {
  PENDING: "уйдёт", SENT: "ушло", FAILED: "не ушло", CANCELLED: "отменено", SKIPPED_NO_PROVIDER: "отправка не подключена",
};
```

- **src/server/lib/dates.ts** — Добавить fmtWhen(d): «сегодня в 14:30», «завтра в 12:00», «1 октября в 12:00» — по Москве. Нужна и очереди, и прогнозу, и колокольчику.

```
// Время события словами, по Москве: очередь сообщений и прогноз автособытий
export function fmtWhen(d: Date, now = new Date()): string {
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(d);
  const diff = daysBetweenIso(day(now), day(d));
  if (diff === 0) return `сегодня в ${time}`;
  if (diff === 1) return `завтра в ${time}`;
  if (diff === -1) return `вчера в ${time}`;
  return `${fmtDate(d, { day: "numeric", month: "long", timeZone: "Europe/Moscow" })} в ${time}`;
}
```

- **src/components/admin/booking/ActivityFeed.tsx** — Строка 64: канал печатается латиницей (i.channel → «WHATSAPP»), подставить CHANNEL_LABEL. Там же подписывать системные записи: когда user пуст и тип SYSTEM/STATUS_CHANGE — «· автоматически». В ICON/TONE строки 11–17 при добавлении новых типов держать Record полным.

```
{i.at}{i.user ? ` · ${i.user}` : i.system ? " · автоматически" : ""}{i.channel && ` · ${CHANNEL_LABEL[i.channel]}`}
```

- **src/components/admin/NoticeBell.tsx** — Добавить вид уведомления (иконка и тон по kind), тихий опрос счётчика раз в минуту, дату группой. Поле kind протащить через AdminShell.tsx:10 и тип Notice (строка 8).

```
// События этапа 2 приходят без действий администратора — проверяем счётчик, перерисовываем только при изменении
useEffect(() => {
  const t = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    fetch("/api/admin/notices/count").then((r) => r.json()).then(({ n }) => { if (n !== notices.length) router.refresh(); }).catch(() => {});
  }, 60_000);
  return () => clearInterval(t);
}, [notices.length, router]);
```

- **src/server/services/notices.ts** — Добавить notifyOnce() с дедупликацией по (kind, bookingId) среди непрочитанных — чтобы повторные ошибки отправки по одной брони не забивали колокольчик. unreadNotices(take=20) оставить, но в выпадашке показывать «и ещё N».

```
// Одно непрочитанное уведомление на бронь и вид: повторы отправки не должны множить строки
export async function notifyOnce(kind: NoticeKind, text: string, bookingId: string, tx: Prisma.TransactionClient = prisma) {
  const dup = await tx.adminNotice.findFirst({ where: { kind, bookingId, readAt: null }, select: { id: true } });
  if (dup) return null;
  return tx.adminNotice.create({ data: { kind, text, bookingId } });
}
```

- **prisma/schema.prisma** — NoticeKind (строки 53–58): добавить MESSAGE_FAILED и AUTO_NO_SHOW. Отдельной миграцией, без использования в той же миграции (PLAN §3). Заодно поля этапа 2а для Outbox (lockedUntil, providerMessageId, deliveredAt, readAt) — необязательные.
- **src/app/admin/(app)/settings/messages/page.tsx** — Новая страница (server, requireUser(["OWNER"]), dynamic = force-dynamic) по образцу settings/capacity/page.tsx: грузит правила с шаблонами, ссылки, состояние отправки и последнюю бронь для предпросмотра, отдаёт в клиентские компоненты.
- **src/components/admin/settings/MessageRules.tsx** — Новый компонент: список правил тремя группами, переключатель на строку, две строки текста, кнопка «Изменить». При выключении правила предупреждать, что уже поставленные в очередь сообщения останутся — их отменяет отдельная кнопка.
- **src/components/admin/settings/TemplateEditor.tsx** — Новый компонент: textarea, палитра переменных кликом, предпросмотр на реальной брони, «Вернуть текст по умолчанию», проверка неизвестных переменных до сохранения.
- **src/app/admin/actions/settings.ts** — Добавить toggleRuleAction(code, on), saveTemplateAction(code, body), resetTemplateAction(code), saveLinksAction({route, review, notifyPhone}). По образцу saveCapacityAction (строки 11–43): requireActor(OWNER), валидация, audit, revalidatePath.

```
export async function saveTemplateAction(code: string, body: string): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const unknown = unknownVars(body); // пустая подстановка молча испортит сообщение клиенту
    if (unknown.length) return { ok: false, error: `Неизвестные переменные: ${unknown.join(", ")}` };
    const before = await prisma.messageTemplate.findUnique({ where: { code } });
    const after = await prisma.messageTemplate.update({ where: { code }, data: { body } });
    await audit(actor.id, "UPDATE", "MessageTemplate", code, { before: before?.body, after: after.body });
    revalidatePath("/admin/settings/messages");
    return { ok: true };
  } catch (e) { /* … */ }
}
```

- **src/server/automations/defaults.ts** — Новый модуль: каталог шаблонов и правил (код, название, когда уходит, текст по умолчанию). Импортируют seed, страница настроек (кнопка «вернуть по умолчанию», значок «текст изменён вручную») и тест полноты MESSAGE_LABEL.
- **prisma/seed.ts** — Строки 87–118: перевести на defaults.ts и убрать sync:true для кодов, редактируемых через CRM — иначе seed на деплое затрёт правку заказчика.
- **src/server/services/settings.ts** — Добавить LINKS и linkSettings(): строки, отдельно от parkingSettings() (num() на строке 19 строку испортит). Добавить messagingEnabled() и признак планировщика.

```
export const LINKS = {
  route: { key: "links.route", label: "Маршрут проезда" },
  review: { key: "links.review", label: "Ссылка на отзывы" },
  notifyPhone: { key: "admin.notifyPhone", label: "Телефон администратора для уведомлений" },
} as const;

// Отправка включается только с ключом провайдера (этап 2а); до этого очередь копится
export function messagingEnabled(): boolean { return !!process.env.WAZZUP_API_KEY; }
```

- **src/server/automations/render.ts** — Ссылки передавать третьим полем ctx, функцию оставить чистой (её покрывает tests/unit/render.test.ts, вызовы с двумя полями не должны сломаться). Заодно строка 18: .replace(/\s{2,}/g, " ") схлопнет переносы многострочных текстов этапа 2.

```
export function renderTemplate(body: string, ctx: { booking: Booking; client: Client | null; links?: { route?: string; review?: string } }): string {
  // схлопываем только пробелы и табуляцию: в текстах этапа 2 переносы строк значимы
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "").replace(/[ \t]{2,}/g, " ").replace(/ ,/g, ",").trim();
}
```

- **src/app/admin/(app)/settings/page.tsx** — Строки 5–12: две записи templates/automations свести в одну «Сообщения клиентам» → /admin/settings/messages. Нереализованные разделы (users, tariffs, policy) пометить soon и не делать ссылками — сейчас 5 плиток из 6 ведут в 404.

```
const ITEMS = [
  { href: "/admin/settings/capacity", label: "Ёмкость стоянки", icon: LayoutGrid, desc: "Места, порог автоподтверждения" },
  { href: "/admin/settings/messages", label: "Сообщения клиентам", icon: MessageSquareText, desc: "Тексты, автоматические правила, ссылки" },
  { href: "/admin/settings/users", label: "Пользователи и роли", icon: Users, desc: "Владелец, администраторы, охрана", soon: true },
  // …
];
```

- **src/app/admin/(app)/clients/[id]/page.tsx** — Строки 186–196: тот же блок сообщений в карточке клиента — перевести на MESSAGE_LABEL/OUTBOX_STATUS_LABEL и whitespace-pre-line, иначе две карточки будут описывать одну очередь по-разному.
- **src/app/api/admin/notices/count/route.ts** — Новый route handler: возвращает { n: unreadCount() } для опроса колокольчика. Защищён тем же requireUser, что и админка.
- **tests/e2e/site-lead.mjs** — Строки 64–66: проверки завязаны на /TELEGRAM/ и /запланировано/ внутри блока «Сообщения клиенту». После переписывания блока обновить на «Telegram» и «уйдёт», иначе зелёный сценарий этапа 0 сломается.

### Риски

- **Риск:** Очередь сейчас врёт администратору: status PENDING показывается как «запланировано <дата>», хотя отправщика нет и SKIPPED_NO_PROVIDER не записывается нигде (grep по src даёт только вывод в bookings/[id]/page.tsx:183). На stage так лежат 7 сообщений с 08–21.09. Если не показать полосу «отправка не подключена», администратор будет уверен, что клиент всё получил.
  **Что делаем:** Полоса состояния по messagingEnabled() над списком + формулировка «уйдёт, когда подключим WhatsApp» вместо даты, пока отправки нет. Блок показывать и при пустой очереди.
- **Риск:** Редактор шаблонов плюс seed с sync:true (prisma/seed.ts:98–101, 111–118) молча откатывают правку заказчика на каждом деплое: seed перезаписывает name/body и включает правило обратно.
  **Что делаем:** Каталог по умолчанию в src/server/automations/defaults.ts, seed создаёт запись только если её нет, признак ручной правки на шаблоне, «вернуть по умолчанию» — явная кнопка. Тест: прогнать seed поверх изменённого текста и убедиться, что текст остался.
- **Риск:** Редактирование текста без проверки переменных: renderTemplate (render.ts:18) на неизвестную переменную подставляет пустую строку, ошибка уйдёт клиенту и нигде не всплывёт.
  **Что делаем:** Список допустимых переменных рядом с renderTemplate, проверка в saveTemplateAction до сохранения, живой предпросмотр на реальной брони, unit-тест на валидатор.
- **Риск:** Время очереди в карточке брони показывается в UTC: fmtDate (dates.ts:37–40) жёстко ставит timeZone "UTC", а bookings/[id]/page.tsx:183 передаёт только hour/minute. Та же запись в карточке клиента (clients/[id]/page.tsx:191) печатается через fmtDateTime по Москве — два разных времени на одно сообщение, расхождение 3 часа.
  **Что делаем:** Перевести обе карточки на fmtWhen/fmtDateTime, в dates.test.ts добавить проверку, что время очереди московское (взять момент 21:30 UTC — он же 00:30 следующего дня в Москве).
- **Риск:** Тексты этапа 2 многострочные (MESSAGE_TEMPLATES_2026-09-22.md, сообщение 1 — 15 строк), а карточка выводит {o.renderedText} без whitespace-pre-line и без свёртки. Четыре таких сообщения превращают карточку в простыню, и администратор видит не то, что увидит клиент.
  **Что делаем:** whitespace-pre-line + свёртка до двух строк, раскрытие по клику. Вместе с правкой схлопывания переносов в render.ts:18.
- **Риск:** Прогноз в карточке и логика сканера могут разойтись (например, про напоминание «не ставим, если бронь создана позже T−24ч»), и карточка будет обещать сообщение, которого не будет.
  **Что делаем:** Единый src/server/automations/schedule.ts для сканера и карточки; unit-тесты на plannedEvents, включая случай skip.
- **Риск:** Колокольчик обновляется только при переходе по CRM (AdminShell.tsx:9 читает уведомления при рендере layout). События этапа 2 рождает планировщик — авто-освобождение места администратор может не увидеть час.
  **Что делаем:** Опрос /api/admin/notices/count раз в минуту при видимой вкладке, router.refresh() только при изменении счётчика. Не опрашивать layout целиком — страницы force-dynamic.
- **Риск:** Шум и потеря уведомлений: AdminNotice без уникальности, unreadNotices берёт 20 (notices.ts:10–17), значок показывает «9+» (NoticeBell.tsx:35). Ошибки отправки при отвалившемся канале создадут десятки записей и вытеснят важное.
  **Что делаем:** notifyOnce с дедупликацией по (kind, bookingId) среди непрочитанных; ошибки отправки — только после последней попытки; «и ещё N» в конце списка; один CHANNEL_DOWN на канал.
- **Риск:** Новые значения NoticeKind требуют миграции enum; применить значение в той же миграции Postgres не даст (PLAN §3).
  **Что делаем:** Отдельная миграция только с ALTER TYPE, код с новыми значениями — следующей.
- **Риск:** E2E-сценарий этапа 0 завязан на текущий вид блока: tests/e2e/site-lead.mjs:64–66 ищет /TELEGRAM/ и /запланировано/. Переписывание блока сломает зелёный сценарий, и это спишут на регресс функциональности.
  **Что делаем:** Правку теста делать тем же коммитом, ассерты формулировать по смыслу («Telegram», «уйдёт»), а не по латинскому enum.
- **Риск:** markNoticesReadAction (settings.ts:45–54) помечает прочитанными все уведомления и для всех: один администратор скрывает событие у другого. Для кассы решено, что смена всегда одна, но владелец работает параллельно.
  **Что делаем:** NoticeBell передаёт ids видимых уведомлений (параметр уже поддержан), кнопка «прочитано» на отдельной строке; позже — фильтр по роли (кассовые виды только владельцу).
- **Риск:** Страница настроек рекламирует разделы, которых нет: из шести плиток (settings/page.tsx:5–12) работает только capacity. Заказчик, зайдя за текстами, попадёт в 404 ещё четыре раза.
  **Что делаем:** Нереализованные плитки пометить «скоро» и сделать некликабельными, две плитки про сообщения свести в одну рабочую.

### Что покрыть тестами

- unit: fmtWhen — «сегодня»/«завтра»/«вчера» и дальняя дата по Москве; граница суток (21:30 UTC = 00:30 следующего дня в Москве) не должна давать «сегодня»
- unit: plannedCheckIn — без timeFrom плановый заезд 12:00 по Москве, с timeFrom берётся указанное время; дата хранится как UTC-полночь
- unit: plannedEvents — напоминание помечено skip, если бронь создана позже T−24ч; авто-освобождение есть только для AWAITING_PAYMENT и CONFIRMED и исчезает после заезда; после выезда остаётся только «спасибо и отзыв» на +2 часа
- unit: MESSAGE_LABEL покрывает все коды правил из defaults.ts (тест на полноту карты — чтобы новое правило не всплыло в интерфейсе латиницей)
- unit: валидатор шаблона — {{booking.foo}} отклоняется со списком неизвестных переменных, все переменные из MESSAGE_TEMPLATES_2026-09-22.md проходят
- unit: renderTemplate с пустым links.review — текст не ломается и не оставляет висящих двоеточий; переносы строк сохраняются (после правки схлопывания)
- unit: notifyOnce — второе уведомление того же вида по той же брони при непрочитанном первом не создаётся, после прочтения создаётся
- e2e: карточка брони без единого сообщения показывает блок «Сообщения клиенту» с полосой «Отправка ещё не подключена», а не пустоту
- e2e (обновить site-lead.mjs:64–66): в блоке очереди видно «Бронь подтверждена», «Telegram» и «уйдёт», без латинских кодов и статусов
- e2e: /admin/settings/messages — выключение правила, создание новой заявки, проверка, что сообщение в очередь не встало; включение обратно — встало
- e2e: правка текста шаблона сохраняется, видна в предпросмотре и в новой брони; «вернуть по умолчанию» возвращает текст из defaults.ts
- e2e: сохранение ссылок links.route и links.review, подстановка их в текст нового сообщения; при пустой ссылке на странице настроек виден значок предупреждения
- e2e: авто-освобождение брони планировщиком → уведомление в колокольчике со ссылкой на бронь, запись в ленте с подписью «автоматически», статус «Не приехал»
- регресс: прогнать prisma db seed поверх отредактированного шаблона и убедиться, что текст и состояние переключателя не изменились
- регресс: npm test и оба прежних сценария (site-lead, crm-pipeline) зелёные до и после правок блока сообщений
