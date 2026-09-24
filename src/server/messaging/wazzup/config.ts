import "server-only";
import { prisma } from "@/server/db/prisma";
import { MIN_WEBHOOK_SECRET } from "@/server/lib/webhook-auth";
import { DEFAULT_BASE, type ApiConfig } from "./client";

// Ключи Setting фазы Ф14 (PHASE_14 §6). Значения по умолчанию — в коде, seed их не создаёт
export const WZ_KEYS = {
  provider: "messaging.provider", // "none" | "wazzup": выключатель отправки, читает registry Ф4ш0 через wazzupActive()
  channels: "messaging.channels", // снимок каналов для карточки и сайта
  chats: "wazzup.chats", // окно чатов и страница «Чаты»
  dialogLimit: "wazzup.dialogLimit",
  dialogNotice: "wazzup.dialogNotice",
  setup: "wazzup.setup",
} as const;

export const DIALOG_LIMIT_DEFAULT = 500;

// Ключ и адрес читаются при каждом вызове, а не при загрузке модуля: смена .env + рестарт — без правок кода
export function apiConfig(): ApiConfig {
  return { base: process.env.WAZZUP_API_BASE || DEFAULT_BASE, key: process.env.WAZZUP_API_KEY ?? "" };
}

export function hasKey(): boolean {
  return !!process.env.WAZZUP_API_KEY;
}

// Тестовые ручки e2e — только dev-сервер с WAZZUP_TEST_HOOKS=1 и только против локальной заглушки
export function testHooksEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.WAZZUP_TEST_HOOKS === "1";
}

export function isLocalBase(): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(apiConfig().base);
}

export async function readSetting(key: string): Promise<unknown> {
  return (await prisma.setting.findUnique({ where: { key } }))?.value;
}

export async function writeSetting(key: string, value: object | string | number | boolean) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function providerSetting(): Promise<string> {
  const v = await readSetting(WZ_KEYS.provider);
  return typeof v === "string" ? v : "none";
}

// Одна строка в registry Ф4ш0: `if (await wazzupActive()) return wazzupAdapter;`
export async function wazzupActive(): Promise<boolean> {
  return hasKey() && (await providerSetting()) === "wazzup";
}

export async function chatsEnabled(): Promise<boolean> {
  return hasKey() && (await readSetting(WZ_KEYS.chats)) === true;
}

// Адрес вебхука — только явный публичный https: иначе запуск с боевым ключом на машине разработчика
// молча увёл бы вебхук всего аккаунта на localhost (критика Ф14). Секрет в адресе нигде не печатаем
export function webhookUrl(): { ok: true; url: string } | { ok: false; message: string } {
  const secret = process.env.WAZZUP_WEBHOOK_SECRET ?? "";
  if (secret.length < MIN_WEBHOOK_SECRET) return { ok: false, message: `WAZZUP_WEBHOOK_SECRET не задан или короче ${MIN_WEBHOOK_SECRET} символов` };
  const base = (process.env.WAZZUP_WEBHOOK_BASE ?? "").replace(/\/$/, "");
  if (!base) return { ok: false, message: "WAZZUP_WEBHOOK_BASE не задан — адрес вебхука не регистрируем" };
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);
  if (!(base.startsWith("https://") && !local) && !(local && testHooksEnabled() && isLocalBase()))
    return { ok: false, message: "WAZZUP_WEBHOOK_BASE должен быть публичным https-адресом сайта" };
  return { ok: true, url: `${base}/api/webhooks/wazzup/${secret}` };
}
