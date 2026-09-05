"use server";

import { revalidatePath } from "next/cache";
import { requireActor, Forbidden, STAFF } from "@/server/auth/guard";
import { prisma } from "@/server/db/prisma";
import { audit } from "@/server/services/audit";
import { normalizePlate } from "@/lib/phone";
import { toDate } from "@/server/lib/dates";
import { consentSchema, updateClientSchema, vehicleSchema } from "@/server/validation/client";
import type { ActionResult } from "./bookings";

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Forbidden) return { ok: false, error: "Нет доступа" };
  console.error(e);
  return { ok: false, error: "Ошибка сервера" };
}

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fe: Record<string, string> = {};
  for (const i of issues) fe[String(i.path[0] ?? "_")] = i.message;
  return fe;
}

export async function updateClientAction(raw: unknown): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = updateClientSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Проверьте поля", fieldErrors: fieldErrors(parsed.error.issues) };
    const d = parsed.data;
    const before = await prisma.client.findUniqueOrThrow({ where: { id: d.clientId } });
    const updated = await prisma.client.update({
      where: { id: d.clientId },
      data: {
        name: d.name || null,
        status: d.status,
        email: d.email || null,
        messenger: d.messenger || null,
        telegram: d.telegram ? d.telegram.replace(/^@/, "") : null,
        birthday: d.birthday ? toDate(d.birthday) : null,
        company: d.company || null,
        inn: d.inn || null,
        tags: Array.from(new Set(d.tags.map((t) => t.toLowerCase()))),
        note: d.note || null,
      },
    });
    const RU: Record<string, string> = { name: "имя", status: "статус", email: "email", messenger: "канал", telegram: "telegram", company: "компания", inn: "ИНН", note: "заметка", tags: "теги", birthday: "день рождения" };
    const changed = (["name", "status", "email", "messenger", "telegram", "company", "inn", "note"] as const).filter((k) => before[k] !== updated[k]).map(String);
    if (before.tags.join() !== updated.tags.join()) changed.push("tags");
    if ((before.birthday?.getTime() ?? 0) !== (updated.birthday?.getTime() ?? 0)) changed.push("birthday");
    if (changed.length) {
      await prisma.interaction.create({ data: { clientId: d.clientId, type: "SYSTEM", text: `Изменено: ${changed.map((k) => RU[k] ?? k).join(", ")}`, userId: actor.id } });
      await audit(actor.id, "UPDATE", "Client", d.clientId, { changed });
    }
    revalidatePath(`/admin/clients/${d.clientId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function addClientNoteAction(clientId: string, text: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const t = text.trim().slice(0, 2000);
    if (!t) return { ok: false, error: "Пустая заметка" };
    await prisma.interaction.create({ data: { clientId, type: "COMMENT", text: t, userId: actor.id } });
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function addVehicleAction(raw: unknown): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = vehicleSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Проверьте поля", fieldErrors: fieldErrors(parsed.error.issues) };
    const d = parsed.data;
    const plate = normalizePlate(d.plate);
    const exists = await prisma.vehicle.findFirst({ where: { clientId: d.clientId, plate } });
    if (exists) return { ok: false, error: "Такой номер у клиента уже есть", fieldErrors: { plate: "Уже добавлен" } };
    await prisma.vehicle.create({ data: { clientId: d.clientId, plate, type: d.type, model: d.model || null } });
    await prisma.interaction.create({ data: { clientId: d.clientId, type: "SYSTEM", text: `Добавлен автомобиль ${plate}`, userId: actor.id } });
    await audit(actor.id, "UPDATE", "Client", d.clientId, { vehicle: plate });
    revalidatePath(`/admin/clients/${d.clientId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function removeVehicleAction(vehicleId: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, include: { _count: { select: { bookings: true } } } });
    if (v._count.bookings > 0) return { ok: false, error: "У автомобиля есть брони — удалить нельзя" };
    await prisma.vehicle.delete({ where: { id: vehicleId } });
    await prisma.interaction.create({ data: { clientId: v.clientId, type: "SYSTEM", text: `Удалён автомобиль ${v.plate ?? "без номера"}`, userId: actor.id } });
    revalidatePath(`/admin/clients/${v.clientId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function setConsentAction(raw: unknown): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = consentSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Проверьте поля" };
    const { clientId, kind, on } = parsed.data;
    const now = new Date();
    const data =
      kind === "personal" ? { consentPersonalAt: on ? now : null, consentSource: on ? `crm:${actor.login}` : undefined }
      : kind === "marketing" ? { consentMarketingAt: on ? now : null }
      : { doNotDisturb: on };
    await prisma.client.update({ where: { id: clientId }, data });
    const label = kind === "personal" ? "согласие на обработку ПД" : kind === "marketing" ? "согласие на рассылки" : "«не беспокоить»";
    await prisma.interaction.create({ data: { clientId, type: "SYSTEM", text: `${on ? "Включено" : "Снято"} ${label}`, userId: actor.id } });
    await audit(actor.id, "UPDATE", "Client", clientId, { consent: kind, on });
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
