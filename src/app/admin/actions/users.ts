"use server";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { requireActor, Forbidden, OWNER, STAFF } from "@/server/auth/guard";
import { changeOwnPassword, createUser, setUserPassword, updateUser } from "@/server/services/users";

type Result = { ok: true } | { ok: false; error: string };

function fail(e: unknown, where: string, forbidden = "Пользователей заводит и меняет только владелец"): Result {
  if (e instanceof Forbidden) return { ok: false, error: forbidden };
  console.error(`${where}:`, e);
  return { ok: false, error: "Ошибка сервера" };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function createUserAction(input: { login: string; name: string; role: Role; password: string }): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const res = await createUser(actor.id, { login: str(input?.login), name: str(input?.name), role: str(input?.role) as Role, password: str(input?.password) });
    if (res.ok) revalidatePath("/admin/settings/users");
    return res;
  } catch (e) {
    return fail(e, "createUser");
  }
}

export async function updateUserAction(id: string, input: { name: string; role: Role; isActive: boolean }): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const res = await updateUser(actor.id, str(id), { name: str(input?.name), role: str(input?.role) as Role, isActive: input?.isActive === true });
    if (res.ok) revalidatePath("/admin/settings/users");
    return res;
  } catch (e) {
    return fail(e, "updateUser");
  }
}

export async function setUserPasswordAction(id: string, password: string): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    return await setUserPassword(actor.id, str(id), str(password));
  } catch (e) {
    return fail(e, "setUserPassword");
  }
}

// Свой пароль меняют владелец и администраторы; нужен текущий пароль
export async function changeOwnPasswordAction(input: { current: string; next: string; repeat: string }): Promise<Result> {
  try {
    const actor = await requireActor(STAFF);
    return await changeOwnPassword(actor.id, { current: str(input?.current), next: str(input?.next), repeat: str(input?.repeat) });
  } catch (e) {
    return fail(e, "changeOwnPassword", "Нет доступа");
  }
}
