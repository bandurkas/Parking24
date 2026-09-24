// Чистые правила Wazzup: каналы по транспорту, тело сообщения, разбор вебхука, статусы «только вперёд»,
// смена состояния канала, счётчик диалогов. Без базы и сети — под юнит-тестами, как tick-core.ts.
import type { Channel } from "@prisma/client";

export type WzChannel = { channelId: string; transport: string; state: string; plainId: string | null };
export type ChannelSnapshot = { at: string; list: WzChannel[] };
export type SiteChannel = "WHATSAPP" | "TELEGRAM" | "MAX";

// Транспорты, которыми можно написать первым по номеру, в порядке приоритета.
// telegram и maxbot — боты: первыми не пишут никогда (причина отмены своего бота 23.09)
const SEND_TRANSPORTS: Record<SiteChannel, string[]> = {
  WHATSAPP: ["whatsapp", "wapi"],
  TELEGRAM: ["tgapi"],
  MAX: ["max"],
};
const ORDER: SiteChannel[] = ["WHATSAPP", "TELEGRAM", "MAX"];

// Лимит длины текста по мессенджеру (справка Wazzup, «Отправка сообщений»): для decide() отправщика
export const TEXT_LIMIT: Record<SiteChannel, number> = { WHATSAPP: 10_000, TELEGRAM: 4_096, MAX: 4_096 };

export function transportChannel(transport: string): SiteChannel | null {
  if (transport === "whatsapp" || transport === "wapi") return "WHATSAPP";
  if (transport === "tgapi" || transport === "telegram") return "TELEGRAM";
  if (transport === "max" || transport === "maxbot") return "MAX";
  return null;
}

export function chatTypeChannel(chatType: string): SiteChannel | null {
  return chatType === "whatsapp" ? "WHATSAPP" : chatType === "telegram" ? "TELEGRAM" : chatType === "max" ? "MAX" : null;
}

export function canWriteFirst(transport: string): boolean {
  return Object.values(SEND_TRANSPORTS).some((t) => t.includes(transport));
}

export type ChannelPick =
  | { ok: true; channel: WzChannel }
  | { ok: false; reason: "down"; state: string }
  | { ok: false; reason: "absent" };

// Только выбранный клиентом мессенджер: подмена на другой — бизнес-вопрос пользователю (критика Ф14, вопрос 7 QUESTIONS)
export function pickChannel(list: WzChannel[], channel: Channel): ChannelPick {
  const transports = SEND_TRANSPORTS[channel as SiteChannel];
  if (!transports) return { ok: false, reason: "absent" };
  const own = transports.flatMap((t) => list.filter((c) => c.transport === t));
  const active = own.find((c) => c.state === "active");
  if (active) return { ok: true, channel: active };
  if (own.length) return { ok: false, reason: "down", state: own[0].state };
  return { ok: false, reason: "absent" };
}

// E.164 → цифры для Wazzup; null — номер не похож на международный
export function phoneDigits(e164: string): string | null {
  const d = e164.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

// chatId WhatsApp и contact.phone — международный номер цифрами, без «8» и без кода по умолчанию
export function chatIdToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}

export type MessageBody = {
  channelId: string;
  chatType: "whatsapp" | "telegram" | "max";
  chatId?: string;
  phone?: string;
  text: string;
  crmMessageId: string;
};

// WhatsApp адресуется chatId (номер цифрами), Telegram и MAX — phone: идентификатора чата у нас нет
export function messageBody(ch: WzChannel, digits: string, text: string, outboxId: string): MessageBody {
  const kind = transportChannel(ch.transport);
  if (kind === "WHATSAPP") return { channelId: ch.channelId, chatType: "whatsapp", chatId: digits, text, crmMessageId: outboxId };
  return { channelId: ch.channelId, chatType: kind === "MAX" ? "max" : "telegram", phone: digits, text, crmMessageId: outboxId };
}

// ─── Вебхук ────────────────────────────────────────────────────────────────

export type WzMessage = {
  kind: "message";
  messageId: string;
  channelId: string | null;
  chatType: string;
  chatId: string | null;
  at: Date | null;
  type: string;
  isEcho: boolean;
  text: string | null;
  contentUri: string | null;
  contactName: string | null;
  contactPhone: string | null;
  authorName: string | null;
};
export type WzStatus = { kind: "status"; messageId: string; status: "sent" | "delivered" | "read" | "error"; at: Date | null; errorCode: string | null };
export type WzChannelUpdate = { kind: "channel"; channelId: string; state: string };
export type WzEvent = { kind: "test" } | WzMessage | WzStatus | WzChannelUpdate;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
// dateTime у Wazzup — «yyyy-mm-ddThh:mm:ss.ms» без пояса: читаем как UTC, иначе время зависело бы от TZ контейнера
function date(v: unknown): Date | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(v) ? `${v}Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Любое тело → список событий; мусор и незнакомые поля молча отбрасываются, функция не бросает
export function parseWebhook(body: unknown): WzEvent[] {
  const b = obj(body);
  if (!b) return [];
  if (b.test === true) return [{ kind: "test" }];
  const out: WzEvent[] = [];
  for (const raw of arr(b.messages)) {
    const m = obj(raw);
    const messageId = str(m?.messageId);
    const chatType = str(m?.chatType);
    if (!m || !messageId || !chatType) continue;
    const contact = obj(m.contact);
    out.push({
      kind: "message",
      messageId,
      channelId: str(m.channelId),
      chatType,
      chatId: str(m.chatId),
      at: date(m.dateTime),
      type: str(m.type) ?? "text",
      isEcho: m.isEcho === true,
      text: str(m.text),
      contentUri: str(m.contentUri),
      contactName: str(contact?.name),
      contactPhone: str(contact?.phone),
      authorName: str(m.authorName),
    });
  }
  for (const raw of arr(b.statuses)) {
    const s = obj(raw);
    const messageId = str(s?.messageId);
    const status = str(s?.status);
    if (!s || !messageId || !(status === "sent" || status === "delivered" || status === "read" || status === "error")) continue;
    out.push({ kind: "status", messageId, status, at: date(s.timestamp), errorCode: str(obj(s.error)?.error) });
  }
  for (const raw of arr(b.channelsUpdates)) {
    const c = obj(raw);
    const channelId = str(c?.channelId);
    const state = str(c?.state);
    if (!channelId || !state) continue;
    out.push({ kind: "channel", channelId, state: normState(state) });
  }
  return out;
}

// ─── Статусы доставки: только вперёд ───────────────────────────────────────

export type DeliveryMarks = { deliveredAt: Date | null; readAt: Date | null; failCode: string | null };

// sent < delivered < read; «error» после доставки не пишется. null — ничего не менять (повтор, событие опоздало)
export function statusPatch(cur: DeliveryMarks, ev: { status: WzStatus["status"]; at: Date; errorCode: string | null }): Partial<DeliveryMarks> | null {
  if (ev.status === "delivered") return cur.deliveredAt || cur.readAt ? null : { deliveredAt: ev.at };
  if (ev.status === "read") return cur.readAt ? null : cur.deliveredAt ? { readAt: ev.at } : { readAt: ev.at, deliveredAt: ev.at };
  if (ev.status === "error") return cur.failCode || cur.deliveredAt || cur.readAt ? null : { failCode: ev.errorCode ?? "ERROR" };
  return null;
}

// ─── Состояние каналов ─────────────────────────────────────────────────────

// В вебхуке состояние «qr», в GET /v3/channels — «qridle»: одно и то же
export function normState(state: string): string {
  return state === "qr" ? "qridle" : state;
}

const STATE_LABEL: Record<string, string> = {
  active: "работает",
  init: "запускается",
  qridle: "нужно отсканировать QR-код",
  notEnoughMoney: "не оплачен",
  blocked: "заблокирован",
  phoneUnavailable: "нет связи с телефоном",
  disabled: "отключён",
  unauthorized: "не авторизован",
  openelsewhere: "открыт в другом аккаунте",
  openElsewhere: "открыт в другом аккаунте",
  foreignphone: "QR отсканирован другим номером",
  waitForPassword: "нужен пароль двухфакторной защиты",
  onModeration: "на модерации",
  rejected: "отклонён",
};
export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? `состояние «${state}»`;
}

const TRANSPORT_NAME: Record<string, string> = {
  whatsapp: "WhatsApp",
  wapi: "WhatsApp Business",
  tgapi: "Telegram",
  telegram: "Telegram-бот",
  max: "MAX",
  maxbot: "MAX-бот",
};
export function transportName(transport: string): string {
  return TRANSPORT_NAME[transport] ?? transport;
}

function downText(name: string, state: string): string {
  if (state === "qridle") return `Канал ${name} отключился: нужно заново отсканировать QR-код в кабинете Wazzup. Сообщения клиентам не уходят.`;
  if (state === "notEnoughMoney") return `Канал ${name} остановлен: не оплачен тариф Wazzup. Сообщения клиентам не уходят.`;
  if (state === "blocked") return `Канал ${name} заблокирован. Сообщения клиентам не уходят, позвоните клиентам вручную.`;
  if (state === "phoneUnavailable") return `Канал ${name}: нет связи с телефоном канала. Сообщения клиентам не уходят, проверьте телефон.`;
  return `Канал ${name} не работает (${stateLabel(state)}). Сообщения клиентам не уходят.`;
}

export type ChannelNotice = { key: string; text: string };

// Уведомление — на смену состояния, повтор того же молчит. «init» — запуск, не авария.
// Возврат в active — отдельное уведомление, иначе администратор не узнает, что можно не звонить
export function channelTransitions(prev: WzChannel[] | null, next: WzChannel[]): ChannelNotice[] {
  const out: ChannelNotice[] = [];
  for (const c of next) {
    const before = prev?.find((p) => p.channelId === c.channelId)?.state ?? null;
    if (before === c.state || c.state === "init") continue;
    const name = transportName(c.transport);
    if (c.state === "active") {
      if (before && before !== "init") out.push({ key: `channel-down:${c.transport}:active`, text: `Канал ${name} снова работает, сообщения клиентам уходят.` });
      continue;
    }
    out.push({ key: `channel-down:${c.transport}:${c.state}`, text: downText(name, c.state) });
  }
  return out;
}

// Какие мессенджеры предлагать на сайте. null — не сужать (провайдер выключен или каналов ещё не видели):
// сайт не должен терять выбор из-за пустой базы или аварии канала (критика Ф14, [важно] про пустой снимок).
// Купленный канал в аварии остаётся в списке: убрать его с сайта — решение человека, а не следствие аварии
export function siteChannelsFrom(provider: string, snapshot: ChannelSnapshot | null): SiteChannel[] | null {
  if (provider !== "wazzup" || !snapshot?.list.length) return null;
  const bought = new Set(snapshot.list.filter((c) => canWriteFirst(c.transport) && c.state !== "disabled").map((c) => transportChannel(c.transport)));
  const list = ORDER.filter((c) => bought.has(c));
  return list.length ? list : null;
}

export function parseSnapshot(v: unknown): ChannelSnapshot | null {
  const o = obj(v);
  if (!o || typeof o.at !== "string") return null;
  const list: WzChannel[] = [];
  for (const raw of arr(o.list)) {
    const c = obj(raw);
    const channelId = str(c?.channelId);
    const transport = str(c?.transport);
    const state = str(c?.state);
    if (channelId && transport && state) list.push({ channelId, transport, state, plainId: str(c?.plainId) });
  }
  return { at: o.at, list };
}

// ─── Диалоги месяца ────────────────────────────────────────────────────────

// Календарный месяц по Москве (UTC+3 без перехода на летнее время с 2014 г.)
export function moscowMonth(now: Date): { key: string; from: Date; to: Date } {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01T00:00:00+03:00`;
  return { key: `${y}-${String(m).padStart(2, "0")}`, from: new Date(iso(y, m)), to: new Date(m === 12 ? iso(y + 1, 1) : iso(y, m + 1)) };
}

// Порог, о котором пора сказать: одно уведомление на порог за месяц
export function dialogThreshold(count: number, limit: number, last: { month: string; pct: number } | null, month: string): 80 | 100 | null {
  if (limit <= 0) return null;
  const pct = count >= limit ? 100 : count >= Math.ceil(limit * 0.8) ? 80 : null;
  if (!pct) return null;
  if (last && last.month === month && last.pct >= pct) return null;
  return pct;
}
