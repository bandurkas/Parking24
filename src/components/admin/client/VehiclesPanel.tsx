"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { VehicleType } from "@prisma/client";
import { addVehicleAction, removeVehicleAction } from "@/app/admin/actions/clients";
import { VEHICLE_LABEL } from "@/lib/crm/labels";
import Plate from "../Plate";

export type VehicleRow = { id: string; plate: string | null; type: VehicleType; model: string | null; bookings: number; lastDate: string | null };
const VTS: VehicleType[] = ["CAR", "SUV", "MOTO", "TRUCK"];

export default function VehiclesPanel({ clientId, vehicles }: { clientId: string; vehicles: VehicleRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plate, setPlate] = useState("");
  const [type, setType] = useState<VehicleType>("CAR");
  const [model, setModel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await addVehicleAction({ clientId, plate, type, model });
      if (!res.ok) return setErr(res.fieldErrors?.plate ?? res.error);
      setPlate(""); setModel(""); setOpen(false); router.refresh();
    });
  }
  function remove(id: string) {
    if (!window.confirm("Удалить автомобиль из карточки?")) return;
    start(async () => { const r = await removeVehicleAction(id); if (!r.ok) setErr(r.error); else router.refresh(); });
  }

  return (
    <section className="adm-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="font-bold">Автомобили</h2>
        <span className="font-mono text-xs text-ink-muted">{vehicles.length}</span>
        <button onClick={() => setOpen((o) => !o)} className="adm-btn-ghost ml-auto h-8 gap-1 px-2.5 text-xs"><Plus size={13} /> Добавить</button>
      </header>
      {open && (
        <form onSubmit={submit} className="grid gap-2 border-b border-line bg-surface-soft p-3 sm:grid-cols-[1fr_9rem_1fr_auto]">
          <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="А123ВС77" className="adm-input h-10 font-mono uppercase" autoFocus />
          <select value={type} onChange={(e) => setType(e.target.value as VehicleType)} className="adm-input h-10 text-sm">
            {VTS.map((v) => <option key={v} value={v}>{VEHICLE_LABEL[v]}</option>)}
          </select>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Марка, модель, цвет" className="adm-input h-10 text-sm" />
          <button type="submit" disabled={pending || plate.length < 4} className="adm-btn-primary h-10 px-4 text-sm">Сохранить</button>
          {err && <p className="adm-err sm:col-span-4">{err}</p>}
        </form>
      )}
      <ul className="divide-y divide-line">
        {vehicles.map((v) => (
          <li key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <Plate plate={v.plate} size="sm" />
            <div className="min-w-0">
              <div className="font-semibold">{VEHICLE_LABEL[v.type]}{v.model ? ` · ${v.model}` : ""}</div>
              <div className="font-mono text-[11px] text-ink-muted">{v.bookings ? `${v.bookings} бр.` : "без броней"}{v.lastDate ? ` · последняя ${v.lastDate}` : ""}</div>
            </div>
            {v.bookings === 0 && (
              <button onClick={() => remove(v.id)} className="adm-btn-ghost ml-auto size-8 p-0 text-ink-muted hover:text-danger" aria-label="Удалить"><Trash2 size={14} /></button>
            )}
          </li>
        ))}
        {vehicles.length === 0 && <li className="px-4 py-4 text-sm text-ink-muted">—</li>}
      </ul>
    </section>
  );
}
