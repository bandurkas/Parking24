"use server";
import { revalidatePath } from "next/cache";
import { requireActor, Forbidden, OWNER, STAFF } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { HOLD_HOURS_MAX, SETTINGS, parkingSettings, setSetting } from "@/server/services/settings";
import { peakAhead } from "@/server/services/occupancy";
import { belowPeakText } from "@/lib/capacity";
import { SCHEDULER_KEYS } from "@/server/automations/tick-core";
import { markNoticesRead } from "@/server/services/notices";
import { autoConfirmGate } from "@/server/services/autoconfirm";
import { gateBlockers, gateChecks } from "@/lib/autoconfirm-gate";
import { prisma } from "@/server/db/prisma";

type Result = { ok: true } | { ok: false; error: string };

// Автоподтверждение здесь не меняется — у него свой выключатель с предохранителем (setAutoConfirmAction).
// Ф3: удержание «Новой заявки», выключатель потолка мест и сверка вместимости с занятостью (confirm — владелец подтвердил)
export async function saveCapacityAction(input: {
  capacityTotal: number;
  capacityTruck: number;
  autoConfirmLimit: number;
  newLeadHoldHours?: number;
  enforceCapacity?: boolean;
  confirm?: boolean;
}): Promise<Result | { ok: false; error: string; confirm: true }> {
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
    const hold = input.newLeadHoldHours === undefined ? before.newLeadHoldHours : Math.round(Number(input.newLeadHoldHours));
    if (!Number.isFinite(hold) || hold < 0 || hold > HOLD_HOURS_MAX) return { ok: false, error: `Удержание «Новой заявки» — от 0 до ${HOLD_HOURS_MAX} часов` };
    const enforce = input.enforceCapacity === undefined ? before.enforceCapacity : input.enforceCapacity === true;

    // Вместимость опустили ниже занятости ближайших 90 дней — сохраняем только с подтверждением владельца
    const below: string[] = [];
    if (total < before.capacityTotal || truck < before.capacityTruck) {
      const peak = await peakAhead();
      if (total < before.capacityTotal && total < peak.POOL.busy) below.push(belowPeakText("POOL", total, peak.POOL));
      if (truck < before.capacityTruck && truck < peak.TRUCK.busy) below.push(belowPeakText("TRUCK", truck, peak.TRUCK));
    }
    if (below.length && input.confirm !== true) return { ok: false, error: below.join(" "), confirm: true };

    await setSetting(SETTINGS.capacityTotal.key, total);
    await setSetting(SETTINGS.capacityTruck.key, truck);
    await setSetting(SETTINGS.autoConfirmLimit.key, limit);
    await setSetting(SETTINGS.newLeadHoldHours.key, hold);
    await setSetting(SETTINGS.enforceCapacity.key, enforce);
    const after = { capacityTotal: total, capacityTruck: truck, autoConfirmLimit: limit, newLeadHoldHours: hold, enforceCapacity: enforce };
    await audit(actor.id, "UPDATE", "Setting", "parking", { before, after, ...(below.length ? { belowPeak: below } : {}) });
    for (const path of ["/admin/settings/capacity", "/admin/occupancy", "/admin/today", "/admin/boards/parking", "/admin/dashboard"]) revalidatePath(path);
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
    on = on === true;
    if (on) {
      if (ack !== true) return { ok: false, error: "Подтвердите, что понимаете: отказ клиенту уходит автоматически" };
      const blockers = gateBlockers(gateChecks(await autoConfirmGate()));
      if (blockers.length) return { ok: false, error: `Включить нельзя, не пройдено: ${blockers.map((b) => b.title).join("; ")}` };
    }
    const key = SETTINGS.autoConfirm.key;
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key }, update: { value: on }, create: { key, value: on } });
      await audit(actor.id, "UPDATE", "Setting", key, { autoConfirm: on }, tx);
    });
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
