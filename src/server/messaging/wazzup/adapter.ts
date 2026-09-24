import "server-only";
import type { Channel } from "@prisma/client";
import type { AdapterHealth, MessengerAdapter, SendRequest, SendResult } from "../types";
import { api } from "./client";
import { classify, type ApiFailure, type FailRule } from "./errors";
import { apiConfig, hasKey } from "./config";
import { loadChannels, rememberSent, resetChannelCache } from "./channels";
import { canWriteFirst, messageBody, phoneDigits, pickChannel, stateLabel, TEXT_LIMIT, transportChannel, transportName, type SiteChannel, type WzChannel } from "./rules";
import { notifyOnce } from "./notify";
import { checkDialogLimit } from "@/server/services/dialogs";

export type WazzupHealth = AdapterHealth & { channels: WzChannel[] };

const CHANNEL_NAME: Record<SiteChannel, string> = { WHATSAPP: "WhatsApp", TELEGRAM: "Telegram", MAX: "MAX" };

// Одна отправка одного сообщения. Не повторяет, не спит, не открывает транзакций; зовётся ВНЕ транзакции отправщика.
// signal — таймаут отправщика (необязательный второй аргумент, контракт MessengerAdapter не ломает)
async function send(req: SendRequest, signal?: AbortSignal): Promise<SendResult> {
  if (!hasKey()) return { ok: false, retry: true, code: "NO_KEY", message: "ключ Wazzup не задан на сервере" };
  const digits = phoneDigits(req.phone);
  if (!digits) return { ok: false, retry: false, code: "BAD_PHONE", message: "номер не похож на международный" };
  const kind = req.channel as SiteChannel;
  if (!(kind in TEXT_LIMIT)) return { ok: false, retry: false, code: "CHANNEL_UNSUPPORTED", message: "этот канал не мессенджер Wazzup" };
  if (req.text.length > TEXT_LIMIT[kind]) return { ok: false, retry: false, code: "MESSAGE_TEXT_TOO_LONG", message: `сообщение длиннее ${TEXT_LIMIT[kind]} символов` };

  const ch = await loadChannels({ signal });
  if (!ch.ok) return fail(channelsFailure(ch.failure));
  const pick = pickChannel(ch.list, req.channel);
  if (!pick.ok) {
    // Канал есть, но не работает — ждём, он может подняться; уведомление о состоянии даёт снимок каналов
    if (pick.reason === "down") return { ok: false, retry: true, code: "CHANNEL_DOWN", message: `канал ${CHANNEL_NAME[kind]}: ${stateLabel(pick.state)}` };
    return { ok: false, retry: false, code: "CHANNEL_ABSENT", message: `клиент выбрал ${CHANNEL_NAME[kind]}, а такого канала в Wazzup нет` };
  }

  const r = await api<{ messageId?: string }>(apiConfig(), "POST", "/message", messageBody(pick.channel, digits, req.text, req.outboxId), { timeoutMs: 10_000, signal });
  if (r.ok) {
    const id = typeof r.json?.messageId === "string" ? r.json.messageId : null;
    rememberSent(id);
    await checkDialogLimit().catch((e) => console.error("[wazzup] счётчик диалогов", e));
    return { ok: true, providerMessageId: id };
  }
  // Повтор того же crmMessageId в течение 60 с: первое уже ушло. messageId в ответе нет — доставка по записи не отслеживается
  if (r.kind === "http" && r.code === "REPEATED_CRM_MESSAGE_ID") return { ok: true, providerMessageId: null };
  return fail(classify(r));
}

// Список каналов не получен — до отправки дело не дошло: всегда ждём (не FAILED), исход известен
function channelsFailure(f: ApiFailure): FailRule {
  const r = classify(f);
  const notice =
    f.kind === "http" && f.status === 401
      ? r.notice
      : f.kind === "http" && f.status >= 400 && f.status < 500 && f.status !== 429
        ? { key: `channels:${r.code}`, text: `Wazzup не отдаёт список каналов (${r.code}): проверьте настройки Wazzup на сервере. Сообщения клиентам не уходят.` }
        : null;
  return { ...r, retry: true, uncertain: false, code: `CHANNELS_${r.code}`, message: `список каналов Wazzup не получен: ${r.message}`, notice };
}

async function fail(rule: FailRule): Promise<SendResult> {
  if (rule.dropChannelCache) resetChannelCache();
  // Пока прежнее не прочитано — не повторяем: иначе каждое сообщение очереди дало бы своё уведомление
  if (rule.notice)
    await notifyOnce("CHANNEL_DOWN", rule.notice.text, { key: `${rule.notice.key}:${Date.now()}`, unread: true, match: rule.notice.text }).catch((e) =>
      console.error("[wazzup] уведомление", e),
    );
  return { ok: false, retry: rule.retry, code: rule.code, message: rule.message, ...(rule.uncertain ? { uncertain: true } : {}) };
}

// Мессенджеры, в которые сейчас можно написать первым (активный канал, не бот)
async function availableChannels(): Promise<Channel[]> {
  if (!hasKey()) return [];
  const ch = await loadChannels();
  if (!ch.ok) return [];
  const set = new Set(ch.list.filter((c) => c.state === "active" && canWriteFirst(c.transport)).map((c) => transportChannel(c.transport)));
  return (["WHATSAPP", "TELEGRAM", "MAX"] as const).filter((c) => set.has(c));
}

// Кнопка «Проверить связь»: всегда свежий список каналов (кеш сбрасывается), снимок и уведомления о смене состояния
async function check(): Promise<WazzupHealth> {
  if (!hasKey()) return { ok: false, message: "Ключ Wazzup не задан на сервере (WAZZUP_API_KEY)", channels: [] };
  const ch = await loadChannels({ force: true });
  if (!ch.ok) {
    // Отправщик зовёт check() каждым тиком и до send() при сбое не доходит: 401 и прочие 4xx — уведомление здесь
    await fail(channelsFailure(ch.failure));
    return { ok: false, message: `Нет связи с Wazzup: ${classify(ch.failure).message}`, channels: [] };
  }
  if (!ch.list.length) return { ok: false, message: "В аккаунте Wazzup нет ни одного канала", channels: [] };
  const active = ch.list.filter((c) => c.state === "active");
  if (!active.length) return { ok: false, message: "Связь есть, но ни один канал не работает", channels: ch.list };
  return { ok: true, message: `Связь есть, работают: ${active.map((c) => transportName(c.transport)).join(", ")}`, channels: ch.list };
}

export const wazzupAdapter: MessengerAdapter & { send(req: SendRequest, signal?: AbortSignal): Promise<SendResult>; check(): Promise<WazzupHealth> } = {
  code: "wazzup",
  send,
  availableChannels,
  check,
};
