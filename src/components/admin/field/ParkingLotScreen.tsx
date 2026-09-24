"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, Delete, LogOut, RefreshCw } from "lucide-react";
import type { VehicleType } from "@prisma/client";
import Plate from "../Plate";
import { VEHICLE_SHORT } from "@/lib/crm/labels";
import { logoutAction } from "@/app/admin/login/actions";
import { normalizePlate } from "@/lib/phone";

// Узкие типы экрана парковщика: без сумм, телефонов, «не оплачено» и денег перестоя (решение 24.09 п. 6)
export type LotExit = { id: string; plate: string | null; vehicleType: VehicleType | null; dateTo: string; overstayDays: number | null };
export type LotArrival = { id: string; plate: string | null; vehicleType: VehicleType | null; dateFrom: string; timeFrom: string | null };

const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}`;

export default function ParkingLotScreen({ today, userName, exits, expected, shift }: { today: string; userName: string; exits: LotExit[]; expected: LotArrival[]; shift?: React.ReactNode }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();

  const needle = normalizePlate(q);
  const exitList = useMemo(() => (needle ? exits.filter((r) => (r.plate ?? "").includes(needle)) : exits), [exits, needle]);
  const expectedList = useMemo(() => (needle ? expected.filter((r) => (r.plate ?? "").includes(needle)) : expected), [expected, needle]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "А", "0", "⌫"];
  const date = new Date(today + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });

  return (
    <div className="admin-root flex min-h-screen flex-col bg-navy-deep text-white">
      <header className="flex items-center gap-3 px-4 py-3">
        <Car size={22} className="text-primary" />
        <div className="mr-auto min-w-0 leading-tight">
          <div className="truncate text-base font-bold">Машины · {date}</div>
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

      <div className="px-4">
        <div className="flex h-14 items-center rounded-xl bg-white px-4 font-mono text-2xl font-bold uppercase tracking-[0.15em] text-ink">
          {q || <span className="text-base font-normal normal-case tracking-normal text-ink-muted">Поиск по госномеру</span>}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <section>
          <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-white/60">Скоро выезд · {exitList.length}</h2>
          <ul className="space-y-2">
            {exitList.length === 0 && <li className="py-4 text-center text-white/50">{q ? "Ничего не найдено" : "Машин нет"}</li>}
            {exitList.map((r) => (
              <li key={r.id} className={`rounded-2xl bg-white p-3 text-ink ${r.overstayDays !== null ? "ring-2 ring-danger" : ""}`}>
                <Plate plate={r.plate} size="lg" />
                <div className="mt-1.5 flex items-center gap-2 font-mono text-xs text-ink-muted tnum">
                  {r.vehicleType && <span className="font-semibold">{VEHICLE_SHORT[r.vehicleType]}</span>}
                  <span>выезд {dm(r.dateTo)}</span>
                  {r.overstayDays !== null && <span className="font-bold uppercase text-danger">перестой {r.overstayDays} сут.</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-white/60">Ожидаем · {expectedList.length}</h2>
          <ul className="space-y-2">
            {expectedList.length === 0 && <li className="py-4 text-center text-white/50">{q ? "Ничего не найдено" : "Заездов нет"}</li>}
            {expectedList.map((r) => (
              <li key={r.id} className="rounded-2xl bg-white p-3 text-ink">
                <Plate plate={r.plate} size="lg" />
                <div className="mt-1.5 flex items-center gap-2 font-mono text-xs text-ink-muted tnum">
                  {r.vehicleType && <span className="font-semibold">{VEHICLE_SHORT[r.vehicleType]}</span>}
                  <span>заезд {dm(r.dateFrom)}{r.timeFrom ? ` · ${r.timeFrom}` : ""}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid grid-cols-6 gap-1.5 bg-black/30 p-3 sm:grid-cols-12">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => (k === "⌫" ? setQ((s) => s.slice(0, -1)) : setQ((s) => (s + k).slice(0, 10)))}
            className="h-12 rounded-lg bg-white/10 font-mono text-lg font-bold active:bg-primary active:text-navy-deep"
            aria-label={k === "⌫" ? "Стереть" : k}
          >
            {k === "⌫" ? <Delete size={18} className="mx-auto" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
