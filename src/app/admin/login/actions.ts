"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { verifyPassword } from "@/server/auth/password";
import { createSession, destroySession, getSessionUser } from "@/server/auth/session";
import { audit } from "@/server/services/audit";

const schema = z.object({
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Введите логин и пароль" };
  const { login, password, next } = parsed.data;
  const user = await prisma.user.findUnique({ where: { login: login.toLowerCase() } });
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    await new Promise((r) => setTimeout(r, 400));
    return { error: "Неверный логин или пароль" };
  }
  await createSession(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(user.id, "LOGIN", "User", user.id);
  const safeNext = next && next.startsWith("/admin") ? next : null;
  redirect(safeNext ?? (user.role === "GUARD" ? "/admin/today" : "/admin"));
}

export async function logoutAction() {
  const user = await getSessionUser();
  if (user) await audit(user.id, "LOGOUT", "User", user.id);
  await destroySession();
  redirect("/admin/login");
}
