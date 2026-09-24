import "server-only";
import { cookies } from "next/headers";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { audit } from "./audit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { SESSION_COOKIE } from "@/server/auth/session";
import { fmtDateTime } from "@/server/lib/dates";
import { userChangeError, validateLogin, validatePassword, validateTitle } from "@/lib/settings-validate";

export const ROLES: Role[] = ["OWNER", "ADMIN", "GUARD", "DRIVER", "PARKER"];
// Что видит роль после входа (МФ-UI: roleHome) — подсказка при заведении
export const ROLE_HINT: Record<Role, string> = {
  OWNER: "вся CRM и настройки",
  ADMIN: "CRM без настроек",
  GUARD: "экран КПП",
  DRIVER: "экран трансферов",
  PARKER: "список машин",
};
const USERS_LOCK = 24_0925; // постоянный ключ pg_advisory_xact_lock: «последний владелец» решается под ним

type Result = { ok: true } | { ok: false; error: string };

export type UserView = { id: string; login: string; name: string; role: Role; isActive: boolean; lastLogin: string | null; self: boolean };

export async function listUsers(actorId: string): Promise<UserView[]> {
  const rows = await prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
  return rows
    .map((u) => ({ id: u.id, login: u.login, name: u.name, role: u.role, isActive: u.isActive, lastLogin: u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : null, self: u.id === actorId }))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

async function currentSessionId(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

// Смена пароля выходит со всех устройств этого пользователя, кроме текущего окна (контракт МФ-3б)
async function dropOtherSessions(db: Prisma.TransactionClient, userId: string) {
  const current = await currentSessionId();
  await db.session.deleteMany({ where: { userId, ...(current ? { NOT: { id: current } } : {}) } });
}

export async function createUser(actorId: string, input: { login: string; name: string; role: Role; password: string }): Promise<Result> {
  const login = validateLogin(input.login);
  if (!login.ok) return login;
  const name = validateTitle(input.name, "Имя", 80);
  if (!name.ok) return name;
  if (!ROLES.includes(input.role)) return { ok: false, error: "Неизвестная роль" };
  const pw = validatePassword(input.password);
  if (!pw.ok) return pw;
  if (await prisma.user.findUnique({ where: { login: login.value } })) return { ok: false, error: `Логин «${login.value}» уже занят` };
  const passwordHash = await hashPassword(pw.value);
  try {
    const u = await prisma.user.create({ data: { login: login.value, name: name.value, role: input.role, passwordHash } });
    await audit(actorId, "CREATE", "User", u.id, { login: u.login, name: u.name, role: u.role });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, error: `Логин «${login.value}» уже занят` };
    throw e;
  }
  return { ok: true };
}

// Имя, роль, включён ли. Логин после создания не меняется: по нему вход и журнал
export async function updateUser(actorId: string, id: string, input: { name: string; role: Role; isActive: boolean }): Promise<Result> {
  const name = validateTitle(input.name, "Имя", 80);
  if (!name.ok) return name;
  if (!ROLES.includes(input.role)) return { ok: false, error: "Неизвестная роль" };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${USERS_LOCK})`);
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) return { ok: false, error: "Пользователь не найден" } as const;
    const owners = await tx.user.count({ where: { role: "OWNER", isActive: true, id: { not: id } } });
    const err = userChangeError(actorId, before, { role: input.role, isActive: input.isActive }, owners);
    if (err) return { ok: false, error: err } as const;
    if (before.name === name.value && before.role === input.role && before.isActive === input.isActive) return { ok: true } as const;
    await tx.user.update({ where: { id }, data: { name: name.value, role: input.role, isActive: input.isActive } });
    // Выключенный выходит сразу со всех устройств (вход и так проверяет isActive — это вторая защита)
    if (before.isActive && !input.isActive) await tx.session.deleteMany({ where: { userId: id } });
    await audit(actorId, "UPDATE", "User", id, {
      login: before.login,
      before: { name: before.name, role: before.role, isActive: before.isActive },
      after: { name: name.value, role: input.role, isActive: input.isActive },
    }, tx);
    return { ok: true } as const;
  });
}

// Пароль задаёт владелец (сотруднику старый не нужен). Свой — через changeOwnPassword с текущим паролем
export async function setUserPassword(actorId: string, id: string, password: string): Promise<Result> {
  if (id === actorId) return { ok: false, error: "Свой пароль меняется в «Мой пароль» — там нужен текущий" };
  const pw = validatePassword(password);
  if (!pw.ok) return pw;
  const passwordHash = await hashPassword(pw.value);
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id } });
    if (!u) return { ok: false, error: "Пользователь не найден" } as const;
    await tx.user.update({ where: { id }, data: { passwordHash } });
    await dropOtherSessions(tx, id);
    await audit(actorId, "UPDATE", "User", id, { login: u.login, passwordChanged: true }, tx);
    return { ok: true } as const;
  });
}

export async function changeOwnPassword(actorId: string, input: { current: string; next: string; repeat: string }): Promise<Result> {
  const u = await prisma.user.findUnique({ where: { id: actorId } });
  if (!u || !(await verifyPassword(input.current ?? "", u.passwordHash))) return { ok: false, error: "Текущий пароль неверный" };
  const pw = validatePassword(input.next);
  if (!pw.ok) return pw;
  if (input.next !== input.repeat) return { ok: false, error: "Новый пароль и повтор не совпадают" };
  if (await verifyPassword(pw.value, u.passwordHash)) return { ok: false, error: "Новый пароль совпадает с текущим" };
  const passwordHash = await hashPassword(pw.value);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actorId }, data: { passwordHash } });
    await dropOtherSessions(tx, actorId);
    await audit(actorId, "UPDATE", "User", actorId, { login: u.login, passwordChanged: true, self: true }, tx);
  });
  return { ok: true };
}
