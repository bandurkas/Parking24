import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { api } from "./client";
import { classify } from "./errors";
import { apiConfig, hasKey, readSetting, webhookUrl, writeSetting, WZ_KEYS } from "./config";

// Настройка аккаунта Wazzup. Вебхук регистрируется ТОЛЬКО кнопкой владельца, не на старте: PATCH /v3/webhooks
// задаёт один адрес на весь аккаунт, и случайный запуск с тем же ключом увёл бы его на себя.
// Пользователи CRM (владелец и администраторы) синхронизируются кнопкой и сами перед открытием окна чатов.

type SetupMark = { at?: string; keyHash?: string; usersHash?: string; webhookAt?: string; webhookHash?: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

async function mark(): Promise<SetupMark> {
  const v = await readSetting(WZ_KEYS.setup);
  return v && typeof v === "object" ? (v as SetupMark) : {};
}

async function crmUsers() {
  return prisma.user.findMany({ where: { isActive: true, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true, name: true }, orderBy: { id: "asc" } });
}

export async function registerWebhook(): Promise<{ ok: boolean; message: string }> {
  if (!hasKey()) return { ok: false, message: "Ключ Wazzup не задан" };
  const w = webhookUrl();
  if (!w.ok) return { ok: false, message: w.message };
  // Wazzup сначала шлёт на адрес {test:true} и ждёт 200 до 30 секунд
  const r = await api(apiConfig(), "PATCH", "/webhooks", { webhooksUri: w.url, subscriptions: { messagesAndStatuses: true, channelsUpdates: true } }, { timeoutMs: 40_000 });
  if (!r.ok) return { ok: false, message: `Вебхук не зарегистрирован: ${classify(r).message}` };
  const m = await mark();
  await writeSetting(WZ_KEYS.setup, { ...m, webhookAt: new Date().toISOString(), webhookHash: sha(apiConfig().key + w.url) });
  return { ok: true, message: "Вебхук зарегистрирован" };
}

// Регистрация привязана к ключу и адресу: после переезда на аккаунт заказчика старая отметка не выдаёт себя за действующую
export async function webhookMark(): Promise<{ at: string | null; current: boolean }> {
  const m = await mark();
  const w = webhookUrl();
  return { at: m.webhookAt ?? null, current: !!m.webhookAt && w.ok && hasKey() && m.webhookHash === sha(apiConfig().key + w.url) };
}

// Идемпотентно: повтор только при смене списка пользователей или ключа
export async function syncUsers(force = false): Promise<{ ok: boolean; message: string }> {
  if (!hasKey()) return { ok: false, message: "Ключ Wazzup не задан" };
  const users = await crmUsers();
  const keyHash = sha(apiConfig().key);
  const usersHash = sha(JSON.stringify(users));
  const m = await mark();
  if (!force && m.keyHash === keyHash && m.usersHash === usersHash) return { ok: true, message: "Пользователи уже в Wazzup" };
  const r = await api(apiConfig(), "POST", "/users", users.slice(0, 100).map((u) => ({ id: u.id, name: u.name.slice(0, 150) })), { timeoutMs: 5_000 });
  if (!r.ok) return { ok: false, message: `Пользователи не переданы: ${classify(r).message}` };
  await writeSetting(WZ_KEYS.setup, { ...m, at: new Date().toISOString(), keyHash, usersHash });
  return { ok: true, message: `Пользователей в Wazzup: ${users.length}` };
}
