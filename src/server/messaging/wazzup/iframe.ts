import "server-only";
import { api } from "./client";
import { classify } from "./errors";
import { apiConfig } from "./config";
import { loadChannels } from "./channels";
import { phoneDigits, transportChannel } from "./rules";
import { syncUsers } from "./setup";

export type ChatTarget = { scope: "global" } | { scope: "card"; phones: string[]; name?: string | null };

const CHAT_TYPE = { WHATSAPP: "whatsapp", TELEGRAM: "telegram", MAX: "max" } as const;

// Ссылка на окно чатов: запрашивается на сервере, ключ в браузер не уходит. Срок жизни ссылки у Wazzup
// не выяснен — страница просит новую при каждом открытии, в панели есть «Обновить окно»
export async function chatFrameUrl(user: { id: string; name: string }, target: ChatTarget): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const users = await syncUsers();
  if (!users.ok) return { ok: false, message: users.message };
  const body: Record<string, unknown> = { user: { id: user.id, name: user.name }, scope: target.scope };
  if (target.scope === "card") {
    const digits = [...new Set(target.phones.map(phoneDigits).filter((d): d is string => !!d))];
    if (!digits.length) return { ok: false, message: "У клиента нет номера телефона" };
    // Фильтр по Telegram и MAX номером телефона не проверен на живом аккаунте (критика Ф14): WhatsApp — всегда
    const ch = await loadChannels();
    const types = new Set<string>(["whatsapp"]);
    if (ch.ok) for (const c of ch.list) {
      const k = transportChannel(c.transport);
      if (k) types.add(CHAT_TYPE[k]);
    }
    body.filter = digits.flatMap((d) => [...types].map((t) => ({ chatType: t, chatId: d, ...(target.name ? { name: target.name } : {}) })));
  }
  const r = await api<{ url?: string }>(apiConfig(), "POST", "/iframe", body, { timeoutMs: 5_000 });
  if (!r.ok) return { ok: false, message: `Окно чатов не открылось: ${classify(r).message}` };
  const url = r.json?.url;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return { ok: false, message: "Wazzup не вернул ссылку на окно чатов" };
  return { ok: true, url };
}

const UNANSWERED_MS = 30_000;
function cache(): Map<string, { at: number; count: number | null }> {
  const root = globalThis as typeof globalThis & { __p24WzUnanswered?: Map<string, { at: number; count: number | null }> };
  root.__p24WzUnanswered ??= new Map();
  return root.__p24WzUnanswered;
}

// Неотвеченные за 7 дней по пользователю CRM; у роли «Менеджер» в кабинете Wazzup — только его чаты
export async function unansweredCount(userId: string): Promise<number | null> {
  const hit = cache().get(userId);
  if (hit && Date.now() - hit.at < UNANSWERED_MS) return hit.count;
  const r = await api<{ counterV2?: number }>(apiConfig(), "GET", `/unanswered/${encodeURIComponent(userId)}`, undefined, { timeoutMs: 5_000 });
  const count = r.ok && typeof r.json?.counterV2 === "number" ? r.json.counterV2 : null;
  cache().set(userId, { at: Date.now(), count });
  return count;
}
