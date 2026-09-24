"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { requireActor, Forbidden, OWNER, STAFF } from "@/server/auth/guard";
import type { ActionResult } from "./bookings";
import {
  StaffError, cardOf, deleteEmployee, deletePosition, endOwnShift, markShift, myMonth, saveEmployee, savePosition, startOwnShift,
  undoOwnShift, unmarkShift, type MyMonth, type MyShiftResult,
} from "@/server/services/staff";
import { employeeSchema, markSchema, monthSchema, positionSchema, startOwnSchema, unmarkSchema } from "@/server/validation/staff";

// Самоотметка — явный список ролей, не requireActor() без аргумента (реш. 4.6.2)
const SELF_ROLES: Role[] = ["OWNER", "ADMIN", "GUARD", "DRIVER", "PARKER"];

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Forbidden) return { ok: false, error: "Нет доступа" };
  if (e instanceof StaffError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Ошибка сервера" };
}
const bad = (): ActionResult<never> => ({ ok: false, error: "Проверьте поля" });
const people = () => revalidatePath("/admin/staff", "layout");

export async function startMyShiftAction(raw: unknown): Promise<ActionResult<MyShiftResult>> {
  try {
    const actor = await requireActor(SELF_ROLES);
    const p = startOwnSchema.safeParse(raw);
    if (!p.success) return bad();
    return { ok: true, data: await startOwnShift(actor, p.data) };
  } catch (e) {
    return fail(e);
  }
}

export async function endMyShiftAction(): Promise<ActionResult<MyShiftResult>> {
  try {
    const actor = await requireActor(SELF_ROLES);
    return { ok: true, data: await endOwnShift(actor) };
  } catch (e) {
    return fail(e);
  }
}

export async function undoMyShiftAction(): Promise<ActionResult<MyShiftResult>> {
  try {
    const actor = await requireActor(SELF_ROLES);
    return { ok: true, data: await undoOwnShift(actor) };
  } catch (e) {
    return fail(e);
  }
}

export async function myMonthAction(raw: unknown): Promise<ActionResult<MyMonth>> {
  try {
    const actor = await requireActor(SELF_ROLES);
    const p = monthSchema.safeParse(raw);
    if (!p.success) return bad();
    const emp = await cardOf(actor.id);
    if (!emp) return { ok: false, error: "Вас ещё нет в табеле" };
    return { ok: true, data: await myMonth(emp.id, p.data.month) };
  } catch (e) {
    return fail(e);
  }
}

export async function markShiftAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor(STAFF);
    const p = markSchema.safeParse(raw);
    if (!p.success) return bad();
    return { ok: true, data: await markShift(p.data, actor) };
  } catch (e) {
    return fail(e);
  }
}

export async function unmarkShiftAction(raw: unknown): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const p = unmarkSchema.safeParse(raw);
    if (!p.success) return bad();
    await unmarkShift(p.data, actor);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function savePositionAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor(OWNER);
    const p = positionSchema.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Проверьте поля" };
    const r = await savePosition(p.data, actor);
    people();
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePositionAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(OWNER);
    if (typeof id !== "string" || !id) return bad();
    await deletePosition(id, actor);
    people();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function saveEmployeeAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor(OWNER);
    const p = employeeSchema.safeParse(raw);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Проверьте поля" };
    const r = await saveEmployee(p.data, actor);
    people();
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEmployeeAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(OWNER);
    if (typeof id !== "string" || !id) return bad();
    await deleteEmployee(id, actor);
    people();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
