"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays, Car, BedDouble, Users, LayoutGrid, Settings, ScrollText, BarChart3, ShieldCheck, LogOut,
} from "lucide-react";
import type { SessionUser } from "@/server/auth/session";
import { ROLE_LABEL } from "@/lib/crm/labels";
import { logoutAction } from "@/app/admin/login/actions";

const NAV = [
  { href: "/admin/today", label: "Сегодня", icon: CalendarDays },
  { href: "/admin/boards/parking", label: "Парковка", icon: Car },
  { href: "/admin/boards/rooms", label: "Комнаты", icon: BedDouble },
  { href: "/admin/clients", label: "Клиенты", icon: Users },
  { href: "/admin/occupancy", label: "Занятость", icon: LayoutGrid },
  { href: "/admin/dashboard", label: "Дашборд", icon: BarChart3, owner: true },
  { href: "/admin/audit", label: "Журнал", icon: ScrollText, owner: true },
  { href: "/admin/settings", label: "Настройки", icon: Settings, owner: true },
];

export default function Sidebar({ user }: { user: SessionUser }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col bg-navy-deep text-white lg:flex">
      <Link href="/admin" className="flex items-center gap-3 px-4 py-5">
        <span className="grid size-9 place-items-center rounded-lg bg-primary font-mono text-base font-bold text-navy-deep">24</span>
        <div className="leading-tight">
          <div className="text-sm font-bold">Питстоп</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Диспетчерская</div>
        </div>
      </Link>
      <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-2">
        {NAV.filter((n) => !n.owner || user.role === "OWNER").map((n) => {
          const active = path === n.href || (n.href !== "/admin" && path.startsWith(n.href));
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active ? "bg-white/10 font-semibold text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <n.icon size={18} strokeWidth={active ? 2.2 : 1.8} className={active ? "text-primary" : ""} />
              {n.label}
            </Link>
          );
        })}
        <Link href="/admin/today?guard=1" className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/50 hover:bg-white/5 hover:text-white">
          <ShieldCheck size={18} strokeWidth={1.8} /> Экран охраны
        </Link>
      </nav>
      <div className="border-t border-white/10 px-4 py-3">
        <div className="truncate text-sm font-semibold">{user.name}</div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/50">{ROLE_LABEL[user.role]}</span>
          <form action={logoutAction}>
            <button className="flex items-center gap-1 text-xs text-white/50 hover:text-white" title="Выйти">
              <LogOut size={14} /> Выйти
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
