"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import type { SessionUser } from "@/server/auth/session";
import { ROLE_LABEL } from "@/lib/crm/labels";
import { logoutAction } from "@/app/admin/login/actions";
import { GUARD_SCREEN, NAV } from "./nav";
import ChatsBadge from "./ChatsBadge";

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
      <nav className="mt-2 flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {NAV.filter((g) => !g.ownerOnly || user.role === "OWNER").map((g, gi) => (
          <div key={g.title ?? gi} className="flex flex-col gap-0.5">
            {g.title && (
              <div className="mt-3 px-3 pb-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{g.title}</div>
            )}
            {g.items.map((n) => {
              if (!n.ready) {
                return (
                  <span key={n.href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/70 opacity-50">
                    <n.icon size={18} strokeWidth={1.8} />
                    {n.label}
                    <span className="ml-auto rounded bg-white/10 px-1.5 text-[10px] uppercase">скоро</span>
                  </span>
                );
              }
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
                  {n.badge === "chats" && <ChatsBadge />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-4 py-3">
        <Link href={GUARD_SCREEN.href} className="mb-2 -mx-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/50 hover:bg-white/5 hover:text-white">
          <GUARD_SCREEN.icon size={18} strokeWidth={1.8} /> {GUARD_SCREEN.label}
        </Link>
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
