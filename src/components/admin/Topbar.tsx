"use client";

import Link from "next/link";
import { LogOut, Plus, Search } from "lucide-react";
import type { SessionUser } from "@/server/auth/session";
import { logoutAction } from "@/app/admin/login/actions";
import { openQuickBooking } from "./QuickBookingDrawer";
import Clock from "./Clock";
import GlobalSearch from "./GlobalSearch";
import NoticeBell, { type Notice } from "./NoticeBell";

export default function Topbar({ user, notices = [] }: { user: SessionUser; notices?: Notice[] }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:px-6">
      <Link href="/admin" className="flex items-center gap-2 lg:hidden">
        <span className="grid size-8 place-items-center rounded-md bg-primary font-mono text-sm font-bold text-navy-deep">24</span>
      </Link>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-3">
        <Clock />
        <NoticeBell notices={notices} />
        <button onClick={() => openQuickBooking()} className="adm-btn-primary h-9 gap-1.5 px-3">
          <Plus size={16} strokeWidth={2.5} />
          <span className="hidden sm:inline">Новая заявка</span>
          <kbd className="hidden rounded bg-navy-deep/15 px-1.5 font-mono text-[10px] sm:inline">N</kbd>
        </button>
        <form action={logoutAction}>
          <button className="adm-btn-ghost size-9 p-0" aria-label="Выйти" title="Выйти">
            <LogOut size={18} />
          </button>
        </form>
        <span className="sr-only">{user.name}</span>
      </div>
      <Search className="hidden" />
    </header>
  );
}
