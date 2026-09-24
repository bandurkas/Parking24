"use server";
import { revalidatePath } from "next/cache";
import { requireActor, Forbidden, OWNER, STAFF } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { SETTINGS, parkingSettings, setSetting } from "@/server/services/settings";
import { SCHEDULER_KEYS } from "@/server/automations/tick-core";
import { markNoticesRead } from "@/server/services/notices";
import { autoConfirmGate } from "@/server/services/autoconfirm";
import { gateBlockers, gateChecks } from "@/lib/autoconfirm-gate";
import { prisma } from "@/server/db/prisma";

type Result = { ok: true } | { ok: false; error: string };

// Автоподтверждение здесь не меняется — у него свой выключатель с предохранителем (setAutoConfirmAction)
export async function saveCapacityAction(input: {
  capacityTotal: number;
  capacityTruck: number;
  autoConfirmLimit: number;
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
    // ёмкость задана вручную — предупреждение о плейсхолдере больше не нужно
    await prisma.setting.upsert({ where: { key: "capacityIsPlaceholder" }, update: { value: false }, create: { key: "capacityIsPlaceholder", value: false } });
    await audit(actor.id, "UPDATE", "Setting", "parking", { before, after: { capacityTotal: total, capacityTruck: truck, autoConfirmLimit: limit } });
    revalidatePath("/admin/settings/capacity");
    revalidatePath("/admin/occupancy");
    return { ok: true };
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: "Настройки меняет только владелец" };
    console.error("saveCapacity:", e);
    return { ok: false, error: "Ошибка сервера" };
  }
}

// Включение — только владельцем, с «Понимаю» и пройденным предохранителем (сервер проверяет сам, форме не верит).
// Выключение — всегда, одним нажатием («вернуть ручной режим», PLAN §3).
export async function setAutoConfirmAction(on: boolean, ack?: boolean): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    if (on) {
      if (ack !== true) return { ok: false, error: "Подтвердите, что понимаете: отказ клиенту уходит автоматически" };
      const blockers = gateBlockers(gateChecks(await autoConfirmGate()));
      if (blockers.length) return { ok: false, error: `Включить нельзя, не пройдено: ${blockers.map((b) => b.title).join("; ")}` };
    }
    await setSetting(SETTINGS.autoConfirm.key, on);
    await audit(actor.id, "UPDATE", "Setting", SETTINGS.autoConfirm.key, { autoConfirm: on });
    revalidatePath("/admin/settings/capacity");
    revalidatePath("/admin/occupancy");
    return { ok: true };
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: "Автоподтверждение включает и выключает только владелец" };
    console.error("setAutoConfirm:", e);
    return { ok: false, error: "Ошибка сервера" };
  }
}

export async function markNoticesReadAction(ids?: string[]): Promise<Result> {
  try {
    const actor = await requireActor(STAFF); // ревью МФ-UI: у полевых ролей колокольчика нет — гасить чужие уведомления нельзя
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
