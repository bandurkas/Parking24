"use server";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { requireActor, Forbidden, OWNER } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { prisma } from "@/server/db/prisma";
import { SCHEDULER_KEYS, mergeMode, parseModes, type ScanMode } from "@/server/automations/tick-core";
import { MESSAGING_KEYS, SENDER_CODE, SENDER_KEYS } from "@/server/automations/sender-core";
import { providerOptions } from "@/server/messaging/registry";
import { FAKE_MODES, type FakeMode } from "@/server/messaging/fake";
import { expireStaleOutbox, recheckQueue, senderConfig } from "@/server/services/outbox";
import { normalizePhone } from "@/lib/phone";

// Карточка «Отправка сообщений» (Ф4 шаг 0): всё только владельцу и с записью в журнал
type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const MODES: ScanMode[] = ["off", "dry", "on"];

function fail(e: unknown, what: string): { ok: false; error: string } {
  if (e instanceof Forbidden) return { ok: false, error: "Отправку сообщений настраивает только владелец" };
  console.error(`${what}:`, e);
  return { ok: false, error: "Ошибка сервера" };
}

async function put(tx: Prisma.TransactionClient, key: string, value: Prisma.InputJsonValue) {
  await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

// Режим пишется слиянием под блокировкой строки: режимы сканов в той же карте (Ф2б) не затираются
export async function setSenderModeAction(mode: ScanMode): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    if (!MODES.includes(mode)) return { ok: false, error: "Неизвестный режим" };
    const before = await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ value: unknown }[]>`SELECT value FROM "Setting" WHERE key = ${SCHEDULER_KEYS.scans} FOR UPDATE`;
      await put(tx, SCHEDULER_KEYS.scans, mergeMode(row?.value, SENDER_CODE, mode));
      // «Работает» подтверждает только проход отправщика; при «вкл» счётчик сбоев начинается заново
      await put(tx, MESSAGING_KEYS.senderEnabled, false);
      if (mode === "on") await put(tx, SENDER_KEYS.failStreak, 0);
      await recheckQueue(tx);
      return parseModes(row?.value)[SENDER_CODE] ?? "off";
    });
    await audit(actor.id, "UPDATE", "Setting", `${SCHEDULER_KEYS.scans}.${SENDER_CODE}`, { before, after: mode });
    revalidatePath("/admin/settings");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, "setSenderMode");
  }
}

export async function saveSenderAction(input: { allowlistOnly: boolean; allowlist: string; maxAgeHours: number }): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const hours = Math.round(Number(input.maxAgeHours));
    if (!Number.isFinite(hours) || hours < 1 || hours > 72) return { ok: false, error: "Порог по возрасту — от 1 до 72 часов" };
    const lines = String(input.allowlist ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const bad = lines.filter((l) => !normalizePhone(l));
    if (bad.length) return { ok: false, error: `Не похоже на номер: ${bad.slice(0, 3).join(", ")}` };
    const allowlist = Array.from(new Set(lines.map((l) => normalizePhone(l)!)));
    if (allowlist.length > 50) return { ok: false, error: "Не больше 50 номеров" };
    const before = await senderConfig();
    await prisma.$transaction(async (tx) => {
      await put(tx, SENDER_KEYS.allowlistOnly, !!input.allowlistOnly);
      await put(tx, SENDER_KEYS.allowlist, allowlist);
      await put(tx, SENDER_KEYS.maxAgeHours, hours);
      await recheckQueue(tx);
    });
    await audit(actor.id, "UPDATE", "Setting", "sender", {
      before: { allowlistOnly: before.allowlistOnly, allowlist: before.allowlist, maxAgeHours: before.maxAgeHours },
      after: { allowlistOnly: !!input.allowlistOnly, allowlist, maxAgeHours: hours },
    });
    revalidatePath("/admin/settings");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, "saveSender");
  }
}

export async function setProviderAction(code: string): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    if (!providerOptions().some((o) => o.code === code)) return { ok: false, error: "Этот провайдер на сервере недоступен" };
    await prisma.$transaction(async (tx) => {
      await put(tx, MESSAGING_KEYS.provider, code);
      await put(tx, MESSAGING_KEYS.senderEnabled, false);
      await recheckQueue(tx);
    });
    await audit(actor.id, "UPDATE", "Setting", MESSAGING_KEYS.provider, { provider: code });
    revalidatePath("/admin/settings");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, "setProvider");
  }
}

// Ответ заглушки — только там, где заглушка есть (не production)
export async function setFakeModeAction(mode: FakeMode): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    if (!providerOptions().some((o) => o.code === "fake")) return { ok: false, error: "Заглушки на этом сервере нет" };
    if (!FAKE_MODES.includes(mode)) return { ok: false, error: "Неизвестный ответ заглушки" };
    await prisma.$transaction(async (tx) => {
      await put(tx, MESSAGING_KEYS.fakeMode, mode);
      await recheckQueue(tx);
    });
    await audit(actor.id, "UPDATE", "Setting", MESSAGING_KEYS.fakeMode, { fakeMode: mode });
    revalidatePath("/admin/settings");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e, "setFakeMode");
  }
}

export async function expireStaleOutboxAction(): Promise<Result<{ count: number }>> {
  try {
    const actor = await requireActor(OWNER);
    const cfg = await senderConfig();
    const count = await expireStaleOutbox(cfg.maxAgeHours);
    await audit(actor.id, "UPDATE", "Outbox", null, { expiredManually: count, olderThanHours: cfg.maxAgeHours });
    revalidatePath("/admin/settings");
    return { ok: true, data: { count } };
  } catch (e) {
    return fail(e, "expireStaleOutbox");
  }
}
