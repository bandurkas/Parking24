import "server-only";
import { Prisma, type Channel, type PrismaClient } from "@prisma/client";
import { CHANNEL_LABEL } from "@/lib/crm/labels";
import { normalizePhone } from "@/lib/phone";
import { SCHEDULER_KEYS, mergeMode, type Step } from "./tick-core";
import {
  MESSAGING_KEYS, RECHECK_MS, SENDER_CODE, SENDER_KEYS,
  channelForClient, decide, leaseUntil, parseSenderConfig, planPass, resultPlan, senderEnabledFrom,
  type Decision, type Provider, type SenderConfig,
} from "./sender-core";
import { PROVIDER_SETTING_KEYS, adapterFrom } from "@/server/messaging/registry";
import type { MessengerAdapter, SendResult } from "@/server/messaging/types";

// Отправщик Outbox (docs/phases/PHASE_04_SENDER.md, раздел «Код»). Шаг минутного тика: короткая транзакция
// аренды → отправка по одной ВНЕ транзакции → результат отдельной записью. Работает клиентом планировщика.

type Tx = Prisma.TransactionClient;

// Отличается от блокировок планировщика (24_0922) и занятости (24_0921)
export const SENDER_LOCK = 24_0924;
// Сколько записей за проход разбирается предохранителями; отправляется из них не больше maxPerTick
const CLAIM_LIMIT = 50;
const TX_OPTS = { timeout: 10_000, maxWait: 5_000 };
const PREVIEW_MAX = 20;
export const UNKNOWN_RESULT = "статус отправки неизвестен: сбой во время отправки, проверьте переписку с клиентом";

type Candidate = {
  id: string;
  bookingId: string | null;
  clientId: string | null;
  channel: Channel;
  templateCode: string;
  renderedText: string;
  scheduledAt: Date;
  attempts: number;
  phone: string | null;
  doNotDisturb: boolean | null;
  messenger: Channel | null;
  channels: Channel[] | null;
  bookingNumber: number | null;
};

export type PreviewItem = { number: number | null; code: string; channel: Channel; phone: string | null; outcome: string };

class DryRun {
  constructor(readonly preview: PreviewItem[], readonly wouldSend: number) {}
}

export function senderStep(db: () => PrismaClient): Step {
  return { code: SENDER_CODE, run: (now, mode) => runSenderPass(db(), now, mode) };
}

function short(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => (timer = setTimeout(() => resolve(onTimeout()), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

// До любой транзакции: у настоящего провайдера check() ходит в сеть
async function probe(adapter: MessengerAdapter | null, cfg: SenderConfig): Promise<Provider> {
  if (!adapter) return { kind: "none" };
  try {
    const h = await withTimeout(adapter.check(), cfg.timeoutMs, () => ({ ok: false, message: "нет ответа" }));
    if (!h.ok) return { kind: "down", reason: `провайдер недоступен: ${h.message}`.slice(0, 200) };
  } catch (e) {
    return { kind: "down", reason: `провайдер недоступен: ${short(e)}` };
  }
  return { kind: "ready", textLimit: (ch) => adapter.textLimit?.(ch) ?? null };
}

// Адаптер, который не слушает signal, всё равно прерывается по времени: проход не переезжает минуту
function sendOnce(adapter: MessengerAdapter, req: Parameters<MessengerAdapter["send"]>[0], ms: number): Promise<SendResult> {
  const call = adapter.send(req, AbortSignal.timeout(ms)).catch((e): SendResult => ({ ok: false, retry: true, code: "EXCEPTION", message: short(e) }));
  return withTimeout(call, ms + 500, (): SendResult => ({ ok: false, retry: true, code: "TIMEOUT", message: `нет ответа за ${Math.round(ms / 1000)} с` }));
}

async function setSetting(db: PrismaClient | Tx, key: string, value: Prisma.InputJsonValue) {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

function failedText(number: number | null, why: string): string {
  return `Сообщение клиенту${number ? ` по брони №${number}` : ""} не доставлено: ${why}. Позвоните клиенту.`;
}

// notify() из notices.ts не зовём: он тянет основной клиент базы в бандл планировщика (решение 8 Ф1)
async function noticeFailed(db: PrismaClient | Tx, bookingId: string | null, number: number | null, why: string) {
  await db.adminNotice.create({ data: { kind: "MESSAGE_FAILED", bookingId, text: failedText(number, why) } });
}

function outcomeOf(d: Decision): string {
  if (d.kind === "send") return "ушло бы";
  if (d.kind === "wait") return `ждёт: ${d.reason}`;
  if (d.status === "FAILED") return `не доставлено: ${d.reason}`;
  if (d.status === "SKIPPED") return `пропущено: ${d.reason}`;
  return d.reason;
}

type Claimed = { lease: Date; rows: Candidate[] };

async function claim(tx: Tx, now: Date, cfg: SenderConfig, provider: Provider, mode: "dry" | "on"): Promise<Claimed | null> {
  const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SENDER_LOCK}) AS locked`;
  if (!lock?.locked) return null;
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '8s'`);
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
  const preview: PreviewItem[] = [];
  const counts = { expired: 0, skipped: 0, failed: 0, waiting: 0 };

  // Аренда не снята — процесс упал между отправкой и записью результата. Второй раз не шлём:
  // окно защиты провайдера от дублей (60 с у Wazzup) короче аренды
  const stale = await tx.outbox.findMany({ where: { status: "PENDING", lockedUntil: { lt: now } }, select: { id: true, bookingId: true, booking: { select: { number: true } } } });
  if (stale.length) {
    await tx.outbox.updateMany({ where: { id: { in: stale.map((s) => s.id) }, status: "PENDING", lockedUntil: { lt: now } }, data: { status: "FAILED", lockedUntil: null, lastError: UNKNOWN_RESULT } });
    for (const s of stale) await noticeFailed(tx, s.bookingId, s.booking?.number ?? null, UNKNOWN_RESULT);
    counts.failed += stale.length;
  }

  const hourAgo = new Date(now.getTime() - 3_600_000);
  const sentLastHour = await tx.outbox.count({ where: { OR: [{ status: "SENT", sentAt: { gte: hourAgo } }, { status: "PENDING", lockedUntil: { gt: now } }] } });

  // Колонки — timestamp без пояса в UTC, а Date в сыром запросе уходит как timestamptz и сравнивается
  // по поясу сессии (у локального Postgres — Asia/Jakarta): приводим явно
  const at = Prisma.sql`(${now}::timestamptz AT TIME ZONE 'UTC')`;
  const rows = await tx.$queryRaw<Candidate[]>`
    SELECT o.id, o."bookingId", o."clientId", o.channel::text AS channel, o."templateCode", o."renderedText", o."scheduledAt", o.attempts,
           c.phone, c."doNotDisturb", c.messenger::text AS messenger, c.channels::text[] AS channels, b.number AS "bookingNumber"
    FROM "Outbox" o
    LEFT JOIN "Client" c ON c.id = o."clientId"
    LEFT JOIN "Booking" b ON b.id = o."bookingId"
    WHERE o.status = 'PENDING' AND o."scheduledAt" <= ${at}
      AND (o."nextAttemptAt" IS NULL OR o."nextAttemptAt" <= ${at})
      AND o."lockedUntil" IS NULL
    ORDER BY o."scheduledAt" ASC
    LIMIT ${CLAIM_LIMIT}
    FOR UPDATE OF o SKIP LOCKED`;

  const sendable: Candidate[] = [];
  for (const r of rows) {
    const known = channelForClient(r.clientId ? { messenger: r.messenger, channels: r.channels ?? [] } : null).known;
    const d = decide(r, { phone: r.phone, doNotDisturb: !!r.doNotDisturb, channelKnown: known }, cfg, now, provider);
    if (d.kind === "send") {
      sendable.push(r);
      continue;
    }
    if (d.kind === "skip") {
      await tx.outbox.update({ where: { id: r.id }, data: { status: d.status, lastError: d.reason, nextAttemptAt: null } });
      if (d.status === "FAILED") await noticeFailed(tx, r.bookingId, r.bookingNumber, d.reason);
      if (d.status === "EXPIRED") counts.expired++;
      else if (d.status === "FAILED") counts.failed++;
      else counts.skipped++;
    } else {
      await tx.outbox.update({ where: { id: r.id }, data: { lastError: d.reason, nextAttemptAt: new Date(now.getTime() + RECHECK_MS) } });
      counts.waiting++;
    }
    preview.push({ number: r.bookingNumber, code: r.templateCode, channel: r.channel, phone: r.phone, outcome: outcomeOf(d) });
  }

  const { send, hold } = planPass(sendable, cfg, sentLastHour);
  const lease = leaseUntil(now, cfg);
  // attempts растёт только у тех, кто реально идёт к адаптеру, и до сетевого вызова: упавшая отправка не крутится вечно
  if (send.length) await tx.outbox.updateMany({ where: { id: { in: send.map((s) => s.id) } }, data: { lockedUntil: lease, attempts: { increment: 1 } } });
  for (const s of send) preview.push({ number: s.bookingNumber, code: s.templateCode, channel: s.channel, phone: s.phone, outcome: "ушло бы" });
  for (const h of hold) preview.push({ number: h.bookingNumber, code: h.templateCode, channel: h.channel, phone: h.phone, outcome: "ждёт следующего тика (потолок частоты)" });

  const line = `устарело ${counts.expired}, пропущено ${counts.skipped}, не доставлено ${counts.failed}, ждут ${counts.waiting}`;
  if (mode === "dry") {
    if (preview.length) console.log(`[sender] пробно: ушло бы ${send.length}, ${line}`);
    throw new DryRun(preview.slice(0, PREVIEW_MAX), send.length);
  }
  if (counts.expired + counts.skipped + counts.failed) console.log(`[sender] разобрано без отправки: ${line}`);
  return { lease, rows: send.map((s) => ({ ...s, attempts: s.attempts + 1 })) };
}

// Счётчик сбоев канала — атомарно в базе: два процесса не теряют приращения
async function bumpFailStreak(db: PrismaClient): Promise<number> {
  const [row] = await db.$queryRaw<{ n: number }[]>`
    INSERT INTO "Setting" (key, value, "updatedAt") VALUES (${SENDER_KEYS.failStreak}, '1'::jsonb, now() AT TIME ZONE 'UTC')
    ON CONFLICT (key) DO UPDATE SET "updatedAt" = now() AT TIME ZONE 'UTC',
      value = to_jsonb(CASE WHEN jsonb_typeof("Setting".value) = 'number' THEN ("Setting".value #>> '{}')::numeric::int ELSE 0 END + 1)
    RETURNING (value #>> '{}')::int AS n`;
  return row?.n ?? 1;
}

async function resetFailStreak(db: PrismaClient) {
  await db.$executeRaw`UPDATE "Setting" SET value = '0'::jsonb, "updatedAt" = now() AT TIME ZONE 'UTC' WHERE key = ${SENDER_KEYS.failStreak} AND value <> '0'::jsonb`;
}

// Режим пишется слиянием под блокировкой строки: чужие режимы сканов в той же карте не затираются
async function selfDisable(db: PrismaClient, fails: number, lastError: string) {
  await db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ value: unknown }[]>`SELECT value FROM "Setting" WHERE key = ${SCHEDULER_KEYS.scans} FOR UPDATE`;
    await setSetting(tx, SCHEDULER_KEYS.scans, mergeMode(row?.value, SENDER_CODE, "off"));
    await setSetting(tx, MESSAGING_KEYS.senderEnabled, false);
    await setSetting(tx, SENDER_KEYS.failStreak, 0);
    await tx.adminNotice.create({
      data: { kind: "CHANNEL_DOWN", text: `Отправка сообщений клиентам остановлена: ${fails} ошибок канала подряд (последняя — ${lastError}). Проверьте подключение и включите отправку в «Настройках».` },
    });
  });
  console.error(`[sender] остановлен после ${fails} ошибок канала подряд: ${lastError}`);
}

type Row = Claimed["rows"][number];

// Результат — сразу после ответа адаптера, отдельной записью. Успех пишется безусловно (сообщение ушло — это правда,
// даже если бронь отменили во время отправки); остальное — только пока аренда наша и запись не отменена
async function writeResult(db: PrismaClient, r: Row, lease: Date, res: SendResult, cfg: SenderConfig) {
  const at = new Date();
  const plan = resultPlan(res, r.attempts, cfg, at);
  if (plan.status === "SENT") {
    const data = { status: "SENT" as const, sentAt: at, lockedUntil: null, nextAttemptAt: null, lastError: null };
    try {
      await db.outbox.update({ where: { id: r.id }, data: { ...data, providerMessageId: plan.providerMessageId } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      await db.outbox.update({ where: { id: r.id }, data: { ...data, lastError: `id провайдера ${plan.providerMessageId} уже записан у другого сообщения` } });
    }
    // Лента брони: системное действие, автор не человек. Полный текст — в блоке «Сообщения клиенту»
    await db.interaction
      .create({ data: { bookingId: r.bookingId, clientId: r.clientId, type: "MESSAGE", channel: r.channel, direction: "OUT", userId: null, text: `Отправлено клиенту в ${CHANNEL_LABEL[r.channel]}: ${r.templateCode}`, meta: { outboxId: r.id, providerMessageId: plan.providerMessageId } } })
      .catch((e) => console.error("[sender] лента:", short(e)));
    return plan;
  }
  const own = { id: r.id, lockedUntil: lease, status: "PENDING" as const };
  const done =
    plan.status === "PENDING"
      ? await db.outbox.updateMany({ where: own, data: { lockedUntil: null, nextAttemptAt: plan.nextAttemptAt, lastError: plan.lastError } })
      : await db.outbox.updateMany({ where: own, data: { status: "FAILED", lockedUntil: null, nextAttemptAt: null, lastError: plan.lastError } });
  if (done.count === 0) await db.outbox.updateMany({ where: { id: r.id, lockedUntil: lease }, data: { lockedUntil: null } });
  else if (plan.status === "FAILED") await noticeFailed(db, r.bookingId, r.bookingNumber, plan.lastError);
  return plan;
}

async function savePreview(db: PrismaClient, now: Date, items: PreviewItem[], wouldSend: number) {
  await setSetting(db, SENDER_KEYS.dryPreview, { at: now.toISOString(), wouldSend, items });
}

export async function runSenderPass(db: PrismaClient, now: Date, mode: "dry" | "on"): Promise<number> {
  const rows = await db.setting.findMany({ where: { key: { in: [...Object.values(SENDER_KEYS), ...PROVIDER_SETTING_KEYS, MESSAGING_KEYS.senderEnabled] } } });
  const cfg = parseSenderConfig(rows, { OUTBOX_ALLOWLIST: process.env.OUTBOX_ALLOWLIST });
  const adapter = adapterFrom(rows);
  const provider = await probe(adapter, cfg);

  const enabled = senderEnabledFrom(mode, provider.kind === "ready", cfg);
  if (rows.find((r) => r.key === MESSAGING_KEYS.senderEnabled)?.value !== enabled) await setSetting(db, MESSAGING_KEYS.senderEnabled, enabled);

  let claimed: Claimed | null;
  try {
    claimed = await db.$transaction((tx) => claim(tx, now, cfg, provider, mode), TX_OPTS);
  } catch (e) {
    if (e instanceof DryRun) {
      await savePreview(db, now, e.preview, e.wouldSend);
      return e.wouldSend;
    }
    throw e;
  }
  if (!claimed || !claimed.rows.length) return 0;
  if (!adapter) throw new Error("отправщик: записи арендованы без адаптера");

  const started = Date.now();
  const stats = { sent: 0, retry: 0, failed: 0 };
  let i = 0;
  for (; i < claimed.rows.length; i++) {
    if (Date.now() - started > cfg.budgetMs) break;
    const r = claimed.rows[i];
    const res = await sendOnce(adapter, { outboxId: r.id, channel: r.channel, phone: normalizePhone(r.phone ?? "") ?? r.phone ?? "", text: r.renderedText }, cfg.timeoutMs);
    const plan = await writeResult(db, r, claimed.lease, res, cfg);
    if (plan.status === "SENT") {
      stats.sent++;
      await resetFailStreak(db);
      continue;
    }
    stats[plan.status === "PENDING" ? "retry" : "failed"]++;
    if (!plan.countsAsFail) continue;
    const fails = await bumpFailStreak(db);
    if (cfg.stopAfterFails > 0 && fails >= cfg.stopAfterFails) {
      await selfDisable(db, fails, plan.lastError);
      i++;
      break;
    }
  }
  // Не успели за бюджет или отправщик остановлен: аренда снимается, попытка не засчитывается
  const rest = claimed.rows.slice(i).map((r) => r.id);
  if (rest.length) await db.outbox.updateMany({ where: { id: { in: rest }, lockedUntil: claimed.lease }, data: { lockedUntil: null, attempts: { decrement: 1 } } });
  console.log(`[sender] отправлено ${stats.sent}, повтор позже ${stats.retry}, не доставлено ${stats.failed}${rest.length ? `, отложено ${rest.length}` : ""}`);
  return stats.sent;
}
