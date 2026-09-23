import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getSessionUser, type SessionUser } from "./session";
import { roleHome } from "@/lib/crm/roles";

export { roleHome };

export class Forbidden extends Error {
  constructor() {
    super("forbidden");
  }
}

// Для страниц: редирект на логин / запрет. Чужая роль уходит на свой домашний экран (roleHome),
// а не на «/admin» — иначе PARKER/DRIVER зациклились бы об layout группы (app)
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (roles && !roles.includes(user.role)) redirect(roleHome(user.role));
  return user;
}

// Для server actions / route handlers: бросает ошибку вместо редиректа.
export async function requireActor(roles?: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || (roles && !roles.includes(user.role))) throw new Forbidden();
  return user;
}

export const STAFF: Role[] = ["OWNER", "ADMIN"];
export const OWNER: Role[] = ["OWNER"];
export const ALL: Role[] = ["OWNER", "ADMIN", "GUARD"];
