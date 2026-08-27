import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { randomBytes } from "node:crypto";
import type { Role, User } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

export const SESSION_COOKIE = "p24_sid";
const TTL_DAYS = 30;

export type SessionUser = Pick<User, "id" | "login" | "name" | "role">;

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("hex");
  const h = await headers();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);
  await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent")?.slice(0, 250) ?? null,
    },
  });
  const proto = h.get("x-forwarded-proto") ?? "http";
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) await prisma.session.deleteMany({ where: { id } });
  store.delete(SESSION_COOKIE);
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const s = await prisma.session.findUnique({
    where: { id },
    select: { expiresAt: true, user: { select: { id: true, login: true, name: true, role: true, isActive: true } } },
  });
  if (!s || s.expiresAt < new Date() || !s.user.isActive) return null;
  const { isActive: _ignored, ...user } = s.user;
  void _ignored;
  return user;
});

export function can(user: SessionUser | null, roles: Role[]): user is SessionUser {
  return !!user && roles.includes(user.role);
}
