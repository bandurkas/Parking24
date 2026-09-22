"use server";
import { revalidatePath } from "next/cache";
import { requireActor, Forbidden, OWNER } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { SETTINGS, parkingSettings, setSetting } from "@/server/services/settings";
import { SCHEDULER_KEYS } from "@/server/automations/tick-core";
import { markNoticesRead } from "@/server/services/notices";
import { prisma } from "@/server/db/prisma";

type Result = { ok: true } | { ok: false; error: string };

export async function saveCapacityAction(input: {
  capacityTotal: number;
  capacityTruck: number;
  autoConfirmLimit: number;
  autoConfirm: boolean;
}): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const total = Math.round(Number(input.capacityTotal));
    const truck = Math.round(Number(input.capacityTruck));
    const limit = Math.round(Number(input.autoConfirmLimit));
    if (!Number.isFinite(total) || total < 1) return { ok: false, error: "Вместимость должна быть больше нуля" };
    if (!Number.isFinite(truck) || truck < 0) return { ok: false, error: "Мест для грузовых не может быть меньше нуля" };
    if (!Number.isFinite(limit) || limit < 1) return { ok: false, error: "Порог автоподтверждения должен быть больше нуля" };
    if (limit > total) return { ok: false, error: "Порог автоподтверждения не может превышать вместимость" };

    const before = await parkingSettings();
    await setSetting(SETTINGS.capacityTotal.key, total);
    await setSetting(SETTINGS.capacityTruck.key, truck);
    await setSetting(SETTINGS.autoConfirmLimit.key, limit);
    await setSetting(SETTINGS.autoConfirm.key, !!input.autoConfirm);
    // ёмкость задана вручную — предупреждение о плейсхолдере больше не нужно
    await prisma.setting.upsert({ where: { key: "capacityIsPlaceholder" }, update: { value: false }, create: { key: "capacityIsPlaceholder", value: false } });
    await audit(actor.id, "UPDATE", "Setting", "parking", { before, after: { capacityTotal: total, capacityTruck: truck, autoConfirmLimit: limit, autoConfirm: !!input.autoConfirm } });
    revalidatePath("/admin/settings/capacity");
    revalidatePath("/admin/occupancy");
    return { ok: true };
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: "Настройки меняет только владелец" };
    console.error("saveCapacity:", e);
    return { ok: false, error: "Ошибка сервера" };
  }
}

export async function markNoticesReadAction(ids?: string[]): Promise<Result> {
  try {
    const actor = await requireActor();
    await markNoticesRead(actor.id, ids);
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "Не удалось отметить уведомления" };
  }
}

// Аварийная пауза минутного тика: действует на таймер и на /api/cron, без правки .env и перезапуска
export async function setSchedulerPausedAction(paused: boolean): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    await setSetting(SCHEDULER_KEYS.paused, !!paused);
    await audit(actor.id, "UPDATE", "Setting", SCHEDULER_KEYS.paused, { paused: !!paused });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: "Планировщик останавливает только владелец" };
    console.error("setSchedulerPaused:", e);
    return { ok: false, error: "Ошибка сервера" };
  }
}
