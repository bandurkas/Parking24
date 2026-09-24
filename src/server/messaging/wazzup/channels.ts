import "server-only";
import { api } from "./client";
import type { ApiFailure } from "./errors";
import { apiConfig, readSetting, writeSetting, WZ_KEYS } from "./config";
import { channelTransitions, normState, parseSnapshot, type ChannelSnapshot, type WzChannel } from "./rules";
import { notifyOnce } from "./notify";

const CACHE_MS = 5 * 60_000;
const SENT_MEMORY_MS = 10 * 60_000;

// Модуль в одном процессе исполняется дважды (бандлы instrumentation и маршрутов) — состояние в globalThis, как в scheduler.ts
type WzState = { channels: { at: number; list: WzChannel[] } | null; sent: Map<string, number> };
function g(): WzState {
  const root = globalThis as typeof globalThis & { __p24Wazzup?: WzState };
  root.__p24Wazzup ??= { channels: null, sent: new Map() };
  return root.__p24Wazzup;
}

export function resetChannelCache() {
  g().channels = null;
}

// Наш же messageId, ещё не записанный отправщиком в Outbox: эхо может прийти раньше, чем Ф4 запишет providerMessageId
export function rememberSent(messageId: string | null) {
  if (!messageId) return;
  const s = g().sent;
  const now = Date.now();
  s.set(messageId, now);
  if (s.size > 500) for (const [k, t] of s) if (now - t > SENT_MEMORY_MS) s.delete(k);
}
export function sentRecently(messageId: string): boolean {
  const t = g().sent.get(messageId);
  return t !== undefined && Date.now() - t < SENT_MEMORY_MS;
}

function parseList(json: unknown): WzChannel[] {
  return (Array.isArray(json) ? json : [])
    .map((c) => c as Record<string, unknown>)
    .filter((c) => typeof c?.channelId === "string" && typeof c?.transport === "string" && typeof c?.state === "string")
    .map((c) => ({ channelId: c.channelId as string, transport: c.transport as string, state: normState(c.state as string), plainId: typeof c.plainId === "string" ? c.plainId : null }));
}

// Каналы ищутся по транспорту при каждой работе, channelId в настройки не пишется: при переезде на аккаунт заказчика меняется только ключ
export async function loadChannels(o: { force?: boolean; signal?: AbortSignal } = {}): Promise<{ ok: true; list: WzChannel[] } | { ok: false; failure: ApiFailure }> {
  const c = g().channels;
  if (!o.force && c && Date.now() - c.at < CACHE_MS) return { ok: true, list: c.list };
  const r = await api<unknown>(apiConfig(), "GET", "/channels", undefined, { timeoutMs: 5_000, signal: o.signal });
  if (!r.ok) return { ok: false, failure: r };
  const list = parseList(r.json);
  g().channels = { at: Date.now(), list };
  await saveSnapshot(list).catch((e) => console.error("[wazzup] снимок каналов не записан", e));
  return { ok: true, list };
}

export async function readSnapshot(): Promise<ChannelSnapshot | null> {
  return parseSnapshot(await readSetting(WZ_KEYS.channels));
}

// Снимок для карточки и сайта; смена состояния → уведомление (одно на переход)
export async function saveSnapshot(list: WzChannel[]) {
  const prev = await readSnapshot();
  await writeSetting(WZ_KEYS.channels, { at: new Date().toISOString(), list });
  for (const n of channelTransitions(prev?.list ?? null, list)) await notifyOnce("CHANNEL_DOWN", n.text, { key: n.key, match: n.text });
}

// Вебхук channelsUpdates несёт только channelId и состояние: транспорт берём из снимка, незнакомый канал — перечитать список
export async function applyChannelUpdates(updates: { channelId: string; state: string }[]) {
  if (!updates.length) return;
  resetChannelCache();
  const prev = await readSnapshot();
  const known = prev?.list ?? [];
  if (updates.some((u) => !known.some((c) => c.channelId === u.channelId))) {
    const r = await loadChannels({ force: true });
    if (!r.ok) console.error("[wazzup] каналы не перечитаны после channelsUpdates", r.failure.kind);
    return;
  }
  await saveSnapshot(known.map((c) => ({ ...c, state: updates.findLast((u) => u.channelId === c.channelId)?.state ?? c.state })));
}
