"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bus, LogOut, RefreshCw } from "lucide-react";
import Plate from "../Plate";
import { logoutAction } from "@/app/admin/login/actions";

// Узкий тип экрана водителя: без телефона, сумм и ссылок на брони (решение 24.09 п. 6)
export type TransferRow = { id: string; name: string | null; plate: string | null; dateFrom: string; timeFrom: string | null };

const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}`;

export default function TransferScreen({ today, userName, rows, shift }: { today: string; userName: string; rows: TransferRow[]; shift?: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const date = new Date(today + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });

  return (
    <div className="admin-root flex min-h-screen flex-col bg-navy-deep text-white">
      <header className="flex items-center gap-3 px-4 py-3">
        <Bus size={22} className="text-primary" />
        <div className="mr-auto min-w-0 leading-tight">
          <div className="truncate text-base font-bold">Трансферы · {date}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">{userName}</div>
        </div>
        {shift}
        <button onClick={() => start(() => router.refresh())} className="grid size-11 place-items-center rounded-full bg-white/10" aria-label="Обновить">
          <RefreshCw size={18} className={pending ? "animate-spin" : ""} />
        </button>
        <form action={logoutAction}>
          <button className="grid size-11 place-items-center rounded-full bg-white/10" aria-label="Выйти"><LogOut size={18} /></button>
        </form>
      </header>

      <ul className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {rows.length === 0 && <li className="py-8 text-center text-white/50">Сегодня трансферов нет</li>}
        {rows.map((r) => (
          <li key={r.id} className="rounded-2xl bg-white p-3 text-ink">
            <Plate plate={r.plate} size="lg" />
            <div className="mt-1.5 flex items-center gap-2 text-sm">
              <span className="truncate font-semibold">{r.name ?? "Без имени"}</span>
            </div>
            <div className="font-mono text-xs text-ink-muted tnum">заезд {dm(r.dateFrom)}{r.timeFrom ? ` · ${r.timeFrom}` : ""}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
