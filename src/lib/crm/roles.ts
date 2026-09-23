import type { Role } from "@prisma/client";

// Домашний адрес роли — одно правило на вход, выход за роль и редирект с чужой страницы (МФ-UI §5.2).
// Чистый модуль без server-only: правило нужно и юнит-тестам, секретов в нём нет.
export function roleHome(role: Role): string {
  if (role === "GUARD") return "/admin/today";
  if (role === "PARKER") return "/admin/parking-lot";
  if (role === "DRIVER") return "/admin/transfers";
  return "/admin";
}
