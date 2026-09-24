"use server";
import { revalidatePath } from "next/cache";
import { requireActor, Forbidden, OWNER, STAFF } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { prisma } from "@/server/db/prisma";
import { chatsEnabled, hasKey, writeSetting, WZ_KEYS } from "@/server/messaging/wazzup/config";
import { wazzupAdapter } from "@/server/messaging/wazzup/adapter";
import { registerWebhook, syncUsers } from "@/server/messaging/wazzup/setup";
import { chatFrameUrl, type ChatTarget } from "@/server/messaging/wazzup/iframe";

type Result = { ok: true; message?: string } | { ok: false; error: string };

function denied(e: unknown, what: string): Result {
  if (e instanceof Forbidden) return { ok: false, error: `${what} — только владелец` };
  console.error(`messaging: ${what}`, e);
  return { ok: false, error: "Ошибка сервера" };
}

// Выключатель отправки через Wazzup: включение канала — настройка, а не выкатка (PHASE_14 §4.4)
export async function setProviderAction(on: boolean): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    if (on && !hasKey()) return { ok: false, error: "Сначала нужен ключ Wazzup в .env сервера (WAZZUP_API_KEY)" };
    await writeSetting(WZ_KEYS.provider, on ? "wazzup" : "none");
    await audit(actor.id, "UPDATE", "Setting", WZ_KEYS.provider, { value: on ? "wazzup" : "none" });
    if (on) await wazzupAdapter.check().catch(() => null); // снимок каналов для карточки и сайта
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return denied(e, "Отправку включает");
  }
}

export async function setChatsAction(on: boolean): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    if (on && !hasKey()) return { ok: false, error: "Сначала нужен ключ Wazzup в .env сервера (WAZZUP_API_KEY)" };
    await writeSetting(WZ_KEYS.chats, !!on);
    await audit(actor.id, "UPDATE", "Setting", WZ_KEYS.chats, { value: !!on });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return denied(e, "Окно чатов включает");
  }
}

export async function checkConnectionAction(): Promise<Result> {
  try {
    await requireActor(OWNER);
    const h = await wazzupAdapter.check();
    revalidatePath("/admin/settings");
    return h.ok ? { ok: true, message: h.message } : { ok: false, error: h.message };
  } catch (e) {
    return denied(e, "Проверяет связь");
  }
}

// Регистрация вебхука и пользователей — только вручную, не на старте (адрес вебхука один на весь аккаунт Wazzup)
export async function setupWazzupAction(): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const hook = await registerWebhook();
    const users = await syncUsers(true);
    await audit(actor.id, "UPDATE", "Setting", WZ_KEYS.setup, { webhook: hook.ok, users: users.ok });
    revalidatePath("/admin/settings");
    const message = `${hook.message}. ${users.message}.`;
    return hook.ok && users.ok ? { ok: true, message } : { ok: false, error: message };
  } catch (e) {
    return denied(e, "Подключает Wazzup");
  }
}

// Ссылка на окно чатов. Номера клиента берём на сервере по id — из браузера телефоны не принимаем
export async function chatFrameAction(target: { bookingId?: string; clientId?: string } | null): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const actor = await requireActor(STAFF);
    if (!(await chatsEnabled())) return { ok: false, error: "Окно чатов выключено в настройках" };
    let chat: ChatTarget = { scope: "global" };
    if (target?.clientId || target?.bookingId) {
      const b = target.bookingId ? await prisma.booking.findUnique({ where: { id: target.bookingId }, select: { clientId: true, contactPhone: true, contactName: true } }) : null;
      const clientId = target.clientId ?? b?.clientId ?? null;
      const c = clientId ? await prisma.client.findUnique({ where: { id: clientId }, select: { phone: true, extraPhones: true, name: true } }) : null;
      const phones = c ? [c.phone, ...c.extraPhones] : b?.contactPhone ? [b.contactPhone] : [];
      if (!phones.length) return { ok: false, error: "У клиента нет номера телефона" };
      chat = { scope: "card", phones, name: c?.name ?? b?.contactName ?? null };
    }
    const r = await chatFrameUrl({ id: actor.id, name: actor.name }, chat);
    return r.ok ? { ok: true, url: r.url } : { ok: false, error: r.message };
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: "Окно чатов — для владельца и администраторов" };
    console.error("chatFrame:", e);
    return { ok: false, error: "Ошибка сервера" };
  }
}
