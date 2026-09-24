// Чистые правила отправщика (Ф4 шаг 0, docs/phases/PHASE_04_SENDER.md): канал клиента, предохранители,
// план прохода, раскладка ответа адаптера, подписи очереди. Без базы и без server-only — как tick-core.ts:
// логика под юнит-тестами, Prisma живёт в sender.ts.
import type { Channel, OutboxStatus } from "@prisma/client";
import { normalizePhone } from "@/lib/phone";
import type { ScanMode } from "./tick-core";
import type { SendResult } from "@/server/messaging/types";

export const SENDER_CODE = "sender";

// Строки в Setting. Здесь, а не в settings.ts: отправщик работает клиентом планировщика (решение 18)
export const SENDER_KEYS = {
  maxAgeHours: "sender.maxAgeHours",
  allowlistOnly: "sender.allowlistOnly",
  allowlist: "sender.allowlist",
  sendWhenChannelUnknown: "sender.sendWhenChannelUnknown",
  maxPerTick: "sender.maxPerTick",
  maxPerHour: "sender.maxPerHour",
  maxPerClient: "sender.maxPerClient",
  maxAttempts: "sender.maxAttempts",
  leaseMinutes: "sender.leaseMinutes",
  timeoutMs: "sender.timeoutMs",
  budgetMs: "sender.budgetMs",
  stopAfterFails: "sender.stopAfterFails",
  failStreak: "sender.failStreak",
  dryPreview: "sender.dryPreview",
} as const;

export const MESSAGING_KEYS = {
  provider: "messaging.provider", // "none" | "fake" (только разработка) | Ф14: "wazzup"
  // true — отправщик «вкл», провайдер отвечает и список разрешённых не ограничивает: реальному клиенту дойдёт (читает МФ-1)
  senderEnabled: "messaging.senderEnabled",
  fakeMode: "messaging.fakeMode",
} as const;

// Мессенджеры, в которые умеет писать провайдер. PHONE, SITE, SMS, EMAIL — не каналы отправки
export const MESSENGER_CHANNELS: readonly Channel[] = ["WHATSAPP", "TELEGRAM", "MAX"];
export const DEFAULT_CHANNEL: Channel = "WHATSAPP";

// Реклама, а не исполнение договора: «не беспокоить» режет только их (DECISIONS 24.09 §2)
export const MARKETING_RULES: ReadonlySet<string> = new Set(["before_checkout_2d", "after_checkout_7d"]);

export type SenderConfig = {
  maxAgeHours: number;
  allowlistOnly: boolean;
  allowlist: string[];
  envAllowlist: string[]; // OUTBOX_ALLOWLIST на сервере: пока задан, пишем только на эти номера
  sendWhenChannelUnknown: boolean;
  maxPerTick: number;
  maxPerHour: number;
  maxPerClient: number;
  maxAttempts: number;
  leaseMinutes: number;
  timeoutMs: number;
  budgetMs: number;
  stopAfterFails: number; // 0 — не отключаться
};

export const SENDER_DEFAULTS: Omit<SenderConfig, "allowlist" | "envAllowlist"> = {
  maxAgeHours: 6,
  allowlistOnly: true,
  sendWhenChannelUnknown: true,
  maxPerTick: 10,
  maxPerHour: 30,
  maxPerClient: 1,
  maxAttempts: 3,
  leaseMinutes: 5,
  timeoutMs: 10_000,
  budgetMs: 30_000,
  stopAfterFails: 5,
};

// Номера — по одному правилу с карточкой клиента (normalizePhone): «8 999 …» и «+7 (999) …» — один номер
export function parseAllowlist(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[\n,;]+/) : [];
  const out = raw.map((s) => s.trim()).filter(Boolean).map((s) => normalizePhone(s)).filter((p): p is string => !!p);
  return Array.from(new Set(out));
}

function int(value: unknown, def: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
}

export function parseSenderConfig(rows: { key: string; value: unknown }[], env: { OUTBOX_ALLOWLIST?: string } = {}): SenderConfig {
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const bool = (key: string, def: boolean) => (typeof get(key) === "boolean" ? (get(key) as boolean) : def);
  const d = SENDER_DEFAULTS;
  return {
    maxAgeHours: int(get(SENDER_KEYS.maxAgeHours), d.maxAgeHours, 1, 168),
    allowlistOnly: bool(SENDER_KEYS.allowlistOnly, d.allowlistOnly),
    allowlist: parseAllowlist(get(SENDER_KEYS.allowlist)),
    envAllowlist: parseAllowlist(env.OUTBOX_ALLOWLIST ?? ""),
    sendWhenChannelUnknown: bool(SENDER_KEYS.sendWhenChannelUnknown, d.sendWhenChannelUnknown),
    maxPerTick: int(get(SENDER_KEYS.maxPerTick), d.maxPerTick, 1, 100),
    maxPerHour: int(get(SENDER_KEYS.maxPerHour), d.maxPerHour, 1, 10_000),
    maxPerClient: int(get(SENDER_KEYS.maxPerClient), d.maxPerClient, 1, 100),
    maxAttempts: int(get(SENDER_KEYS.maxAttempts), d.maxAttempts, 1, 10),
    ...timing(get),
    stopAfterFails: int(get(SENDER_KEYS.stopAfterFails), d.stopAfterFails, 0, 1_000),
  };
}

// Аренда обязана пережить весь проход (бюджет + таймаут последней отправки + запас), иначе второй процесс
// объявит «статус неизвестен» посреди живой отправки
function timing(get: (key: string) => unknown): Pick<SenderConfig, "leaseMinutes" | "timeoutMs" | "budgetMs"> {
  const d = SENDER_DEFAULTS;
  const timeoutMs = int(get(SENDER_KEYS.timeoutMs), d.timeoutMs, 1_000, 30_000);
  const budgetMs = int(get(SENDER_KEYS.budgetMs), d.budgetMs, 1_000, 50_000);
  const minLease = Math.ceil((budgetMs + timeoutMs + 60_000) / 60_000);
  return { timeoutMs, budgetMs, leaseMinutes: Math.max(minLease, int(get(SENDER_KEYS.leaseMinutes), d.leaseMinutes, 1, 60)) };
}

// Список разрешённых ограничивает, если его требует карточка или задан OUTBOX_ALLOWLIST на сервере
export function allowlistRestricts(cfg: SenderConfig): boolean {
  return cfg.allowlistOnly || cfg.envAllowlist.length > 0;
}

export function allowed(phone: string | null, cfg: SenderConfig): boolean {
  const p = phone ? normalizePhone(phone) : null;
  if (cfg.envAllowlist.length && (!p || !cfg.envAllowlist.includes(p))) return false;
  if (cfg.allowlistOnly && (!p || !cfg.allowlist.includes(p))) return false;
  return true;
}

// Канал клиента — одно правило на всю систему: постановка в очередь, отправщик, карточка клиента.
// known = клиент сам выбрал мессенджер; иначе канал по умолчанию
export function channelForClient(c: { messenger: Channel | null; channels: Channel[] } | null | undefined, def: Channel = DEFAULT_CHANNEL): { channel: Channel; known: boolean } {
  const isMessenger = (x: Channel | null | undefined): x is Channel => !!x && MESSENGER_CHANNELS.includes(x);
  const picked = (isMessenger(c?.messenger) ? c.messenger : null) ?? c?.channels.find(isMessenger) ?? null;
  return { channel: picked ?? def, known: picked !== null };
}

export type OutboxRow = {
  id: string;
  templateCode: string;
  channel: Channel;
  renderedText: string;
  scheduledAt: Date;
  attempts: number;
  clientId: string | null;
};

export type Recipient = { phone: string | null; doNotDisturb: boolean; channelKnown: boolean };

// Провайдер на этот проход: нет вовсе, есть и отвечает, есть и не отвечает
export type Provider = { kind: "none" } | { kind: "ready"; textLimit: (ch: Channel) => number | null } | { kind: "down"; reason: string };

// skip — терминально, запись больше не трогаем; wait — остаётся PENDING с причиной, попытка не тратится
export type Decision =
  | { kind: "send" }
  | { kind: "skip"; status: Exclude<OutboxStatus, "PENDING" | "SENT" | "CANCELLED">; reason: string }
  | { kind: "wait"; reason: string };

export const REASON = {
  expired: "устарело, не отправлено",
  emptyText: "пустой текст",
  noRecipient: "нет получателя",
  dnd: "клиент просил не беспокоить",
  noChannel: "нет мессенджера для отправки",
  channelUnknown: "клиент не выбрал мессенджер",
  notAllowed: "номер не в списке разрешённых (режим теста)",
  noProvider: "канал не подключён",
} as const;

// Сообщение передано провайдеру, а ответа нет (упал процесс, таймаут, исключение адаптера): могло и дойти.
// Повторно не шлём — окно защиты провайдера от дублей (60 с у Wazzup) короче паузы повтора
export const UNKNOWN_CODE = "UNKNOWN";
export const UNKNOWN_RESULT = "статус отправки неизвестен";
export function isUnknown(lastError: string | null | undefined): boolean {
  return !!lastError?.startsWith(UNKNOWN_RESULT);
}

export function isExpired(scheduledAt: Date, now: Date, maxAgeHours: number): boolean {
  return now.getTime() - scheduledAt.getTime() > maxAgeHours * 3_600_000;
}

// Порядок — по возрастанию цены ошибки. Терминально всё, что не исправится само; ждут только
// «номер не в списке» (тест) и «провайдер не отвечает» — их снимет порог по возрасту, если так и не пройдут
export function decide(row: OutboxRow, to: Recipient, cfg: SenderConfig, now: Date, provider: Provider): Decision {
  if (isExpired(row.scheduledAt, now, cfg.maxAgeHours)) return { kind: "skip", status: "EXPIRED", reason: REASON.expired };
  if (!row.renderedText.trim()) return { kind: "skip", status: "FAILED", reason: REASON.emptyText };
  if (!to.phone) return { kind: "skip", status: "SKIPPED", reason: REASON.noRecipient };
  if (to.doNotDisturb && MARKETING_RULES.has(row.templateCode)) return { kind: "skip", status: "SKIPPED", reason: REASON.dnd };
  if (!MESSENGER_CHANNELS.includes(row.channel)) return { kind: "skip", status: "SKIPPED", reason: REASON.noChannel };
  if (!to.channelKnown && !cfg.sendWhenChannelUnknown) return { kind: "skip", status: "SKIPPED", reason: REASON.channelUnknown };
  if (!allowed(to.phone, cfg)) return { kind: "wait", reason: REASON.notAllowed };
  if (provider.kind === "none") return { kind: "skip", status: "SKIPPED_NO_PROVIDER", reason: REASON.noProvider };
  if (provider.kind === "down") return { kind: "wait", reason: provider.reason };
  const limit = provider.textLimit(row.channel);
  if (limit && row.renderedText.length > limit) return { kind: "skip", status: "FAILED", reason: `сообщение длиннее лимита канала (${limit})` };
  return { kind: "send" };
}

// Кого отправляем в этот проход: не больше maxPerTick, остатка часового потолка и maxPerClient одному клиенту.
// Остальные «отправить» остаются в очереди как есть и уходят следующими тиками
export function planPass<T extends { id: string; clientId: string | null; scheduledAt: Date }>(sendable: T[], cfg: SenderConfig, sentLastHour: number): { send: T[]; hold: T[] } {
  const room = Math.max(0, Math.min(cfg.maxPerTick, cfg.maxPerHour - sentLastHour));
  const perClient = new Map<string, number>();
  const send: T[] = [];
  const hold: T[] = [];
  for (const r of [...sendable].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())) {
    const who = r.clientId ?? r.id;
    const n = perClient.get(who) ?? 0;
    if (send.length >= room || n >= cfg.maxPerClient) {
      hold.push(r);
      continue;
    }
    perClient.set(who, n + 1);
    send.push(r);
  }
  return { send, hold };
}

// 1 → 5 → 25 минут, не больше получаса. attempts — номер уже сделанной попытки
export function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 60_000 * 5 ** Math.max(0, attempts - 1));
}

// Пауза перед перепроверкой записи, которая ждёт (номер не в списке, провайдер не отвечает). Попытку не тратит
export const RECHECK_MS = 5 * 60_000;

export function leaseUntil(now: Date, cfg: Pick<SenderConfig, "leaseMinutes">): Date {
  return new Date(now.getTime() + cfg.leaseMinutes * 60_000);
}

export type ResultPlan =
  | { status: "SENT"; providerMessageId: string | null }
  | { status: "PENDING"; nextAttemptAt: Date; lastError: string; countsAsFail: true }
  | { status: "FAILED"; lastError: string; countsAsFail: boolean };

export function errorText(code: string, message: string): string {
  return `${code}: ${message}`.slice(0, 300);
}

// Раскладка ответа адаптера. attempts — уже с учётом этой попытки (растёт при аренде).
// В счётчик самоотключения идут только сбои канала (retry: true): «номера нет в мессенджере» — дело клиента, не канала
export function resultPlan(res: SendResult, attempts: number, cfg: Pick<SenderConfig, "maxAttempts">, now: Date): ResultPlan {
  if (res.ok) return { status: "SENT", providerMessageId: res.providerMessageId };
  const lastError = errorText(res.code, res.message);
  if (res.code === UNKNOWN_CODE) return { status: "FAILED", lastError: `${UNKNOWN_RESULT}: ${res.message}`.slice(0, 300), countsAsFail: true };
  if (res.retry && attempts < cfg.maxAttempts) return { status: "PENDING", nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError, countsAsFail: true };
  return { status: "FAILED", lastError, countsAsFail: res.retry };
}

// messaging.senderEnabled: сообщение реально дойдёт до клиента, а не только «выключатель включён»
export function senderEnabledFrom(mode: ScanMode, providerOk: boolean, cfg: SenderConfig): boolean {
  return mode === "on" && providerOk && !allowlistRestricts(cfg);
}

// Честная строка статуса очереди для карточки брони и клиента. Время приходит уже по Москве (fmt с сервера)
export type OutboxView = {
  status: OutboxStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  sendingAt: Date | null;
  attempts: number;
  lastError: string | null;
};

export function outboxStatusText(o: OutboxView, now: Date, fmt: (d: Date) => string): string {
  switch (o.status) {
    case "SENT":
      return o.sentAt ? `отправлено ${fmt(o.sentAt)}` : "отправлено";
    case "FAILED":
      if (isUnknown(o.lastError)) return `${o.lastError} — проверьте переписку с клиентом`;
      return `не доставлено: ${o.lastError ?? "причина не записана"}${o.attempts > 0 ? `, попыток ${o.attempts}` : ""}`;
    case "CANCELLED":
      return "отменено";
    case "SKIPPED_NO_PROVIDER":
      return "канал не подключён";
    case "EXPIRED":
      return "устарело, не отправлено";
    case "SKIPPED":
      return `пропущено: ${o.lastError ?? "причина не записана"}`;
    case "PENDING": {
      if (o.lockedUntil && o.lockedUntil > now) return "отправляется";
      // аренда истекла посреди отправки, отправщик выключен и ещё не разобрал запись
      if (o.sendingAt && o.lockedUntil) return `${UNKNOWN_RESULT} — проверьте переписку с клиентом`;
      const base = `запланировано ${fmt(o.scheduledAt)}`;
      if (!o.lastError) return base;
      // «повтор» — только после настоящей попытки; ожидание списка или провайдера попытку не тратит
      const next = o.attempts > 0 && o.nextAttemptAt && o.nextAttemptAt > now ? `, повтор ${fmt(o.nextAttemptAt)}` : "";
      return `${base} · не отправлено: ${o.lastError}${o.attempts > 0 ? `, попыток ${o.attempts}` : ""}${next}`;
    }
  }
}
