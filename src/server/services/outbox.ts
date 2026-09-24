import "server-only";
import type { Channel, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { SCHEDULER_KEYS, parseHeartbeat, parseModes, type ScanMode } from "@/server/automations/tick-core";
import { MESSAGING_KEYS, SENDER_CODE, SENDER_KEYS, parseSenderConfig, type SenderConfig } from "@/server/automations/sender-core";
import { PROVIDER_SETTING_KEYS, providerCode, providerOptions } from "@/server/messaging/registry";
import { parseFakeMode, type FakeMode } from "@/server/messaging/fake";
import type { PreviewItem } from "@/server/automations/sender";

type Db = Prisma.TransactionClient;

// Устаревшее и не отправляемое прямо сейчас. Переданную адаптеру запись (sendingAt) не трогаем — у неё статус
// отправки неизвестен, её разберёт отправщик
function staleWhere(maxAgeHours: number, now: Date): Prisma.OutboxWhereInput {
  return { status: "PENDING", scheduledAt: { lt: new Date(now.getTime() - maxAgeHours * 3_600_000) }, sendingAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] };
}

export async function expireStaleOutbox(maxAgeHours: number, now = new Date()): Promise<number> {
  const r = await prisma.outbox.updateMany({ where: staleWhere(maxAgeHours, now), data: { status: "EXPIRED", lastError: "устарело, убрано из очереди вручную", nextAttemptAt: null, lockedUntil: null } });
  return r.count;
}

// Клиент сменил мессенджер — неотправленное уходит в новый. Текст и ключ дедупликации не пересобираются;
// запись, которую отправляют прямо сейчас, не трогаем — ушла в старый канал, так и останется в карточке
export async function moveClientPendingChannel(clientId: string, channel: Channel, db: Db = prisma): Promise<number> {
  const r = await db.outbox.updateMany({ where: { clientId, status: "PENDING", lockedUntil: null, channel: { not: channel } }, data: { channel } });
  return r.count;
}

// Настройки поменяли — ждущие (список, провайдер) перепроверяются на ближайшем тике, а не через 5 минут.
// Пауза настоящего повтора после сбоя (attempts > 0) остаётся
export async function recheckQueue(db: Db = prisma): Promise<number> {
  const r = await db.outbox.updateMany({ where: { status: "PENDING", lockedUntil: null, attempts: 0, nextAttemptAt: { not: null } }, data: { nextAttemptAt: null } });
  return r.count;
}

export async function senderConfig(): Promise<SenderConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(SENDER_KEYS) } } });
  return parseSenderConfig(rows, { OUTBOX_ALLOWLIST: process.env.OUTBOX_ALLOWLIST });
}

export type SenderOverview = {
  mode: ScanMode;
  cfg: SenderConfig;
  provider: string;
  providerMissing: boolean; // выбранного провайдера на этом сервере нет (заглушка на бою, нет ключа)
  options: { code: string; label: string }[];
  fakeMode: FakeMode | null; // null — заглушка на этом сервере недоступна
  enabled: boolean;
  failStreak: number;
  queue: { pending: number; oldest: Date | null; waiting: number; stale: number };
  day: { sent: number; failed: number; skipped: number; expired: number };
  lastTick: Date | null;
  dry: { at: Date; wouldSend: number; items: PreviewItem[] } | null;
};

export async function senderOverview(now = new Date()): Promise<SenderOverview> {
  const keys = [...Object.values(SENDER_KEYS), ...PROVIDER_SETTING_KEYS, MESSAGING_KEYS.senderEnabled, SCHEDULER_KEYS.scans, SCHEDULER_KEYS.heartbeat];
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const cfg = parseSenderConfig(rows, { OUTBOX_ALLOWLIST: process.env.OUTBOX_ALLOWLIST });
  const options = providerOptions();
  const provider = providerCode(rows);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [pending, oldest, waiting, stale, sent, created] = await Promise.all([
    prisma.outbox.count({ where: { status: "PENDING" } }),
    prisma.outbox.findFirst({ where: { status: "PENDING" }, orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true } }),
    prisma.outbox.count({ where: { status: "PENDING", lastError: { not: null } } }),
    prisma.outbox.count({ where: staleWhere(cfg.maxAgeHours, now) }),
    prisma.outbox.count({ where: { status: "SENT", sentAt: { gte: dayAgo } } }),
    prisma.outbox.groupBy({ by: ["status"], where: { createdAt: { gte: dayAgo }, status: { in: ["FAILED", "SKIPPED", "SKIPPED_NO_PROVIDER", "EXPIRED"] } }, _count: { _all: true } }),
  ]);
  const n = (s: string) => created.filter((g) => g.status === s).reduce((a, g) => a + g._count._all, 0);
  const dryRaw = get(SENDER_KEYS.dryPreview) as { at?: string; wouldSend?: number; items?: PreviewItem[] } | undefined;
  const streak = get(SENDER_KEYS.failStreak);
  return {
    mode: parseModes(get(SCHEDULER_KEYS.scans))[SENDER_CODE] ?? "off",
    cfg,
    provider,
    providerMissing: provider !== "none" && !options.some((o) => o.code === provider),
    options,
    fakeMode: options.some((o) => o.code === "fake") ? parseFakeMode(get(MESSAGING_KEYS.fakeMode)) : null,
    enabled: get(MESSAGING_KEYS.senderEnabled) === true,
    failStreak: typeof streak === "number" ? streak : 0,
    queue: { pending, oldest: oldest?.scheduledAt ?? null, waiting, stale },
    day: { sent, failed: n("FAILED"), skipped: n("SKIPPED") + n("SKIPPED_NO_PROVIDER"), expired: n("EXPIRED") },
    lastTick: parseHeartbeat(get(SCHEDULER_KEYS.heartbeat))?.at ?? null,
    dry: dryRaw?.at ? { at: new Date(dryRaw.at), wouldSend: dryRaw.wouldSend ?? 0, items: Array.isArray(dryRaw.items) ? dryRaw.items : [] } : null,
  };
}
