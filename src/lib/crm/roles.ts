import type { Role } from "@prisma/client";

// Домашний адрес роли — одно правило на вход, выход за роль и редирект с чужой страницы (МФ-UI §5.2).
// Чистый модуль без server-only: правило нужно и юнит-тестам, секретов в нём нет.
// Record<Role, …>: новая роль без адреса не соберётся — иначе она молча получила бы «/admin» и цикл редиректов
const HOME: Record<Role, string> = {
  OWNER: "/admin",
  ADMIN: "/admin",
  GUARD: "/admin/today",
  PARKER: "/admin/parking-lot",
  DRIVER: "/admin/transfers",
};

export function roleHome(role: Role): string {
  return HOME[role];
}
