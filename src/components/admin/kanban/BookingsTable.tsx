"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { BookingSource, BookingStatus, VehicleType } from "@prisma/client";
import type { KanbanItem } from "./KanbanBoard";
import StatusChip from "../StatusChip";
import Plate from "../Plate";
import { SOURCE_LABEL, STATUS_SHORT, VEHICLE_LABEL } from "@/lib/crm/labels";
import { formatPhone } from "@/lib/phone";

const STATUSES: BookingStatus[] = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"];
const VTS: VehicleType[] = ["CAR", "SUV", "MOTO", "TRUCK"];

export default function BookingsTable({ items }: { items: KanbanItem[] }) {
  const [status, setStatus] = useState<BookingStatus | "">("");
  const [vt, setVt] = useState<VehicleType | "">("");
  const [src, setSrc] = useState<BookingSource | "">("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"dateFrom" | "number" | "amount">("dateFrom");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s/g, "");
    return items
      .filter((i) => (!status || i.status === status) && (!vt || i.vehicleType === vt) && (!src || i.source === src))
      .filter((i) => !needle || [i.name, i.phone, i.plate, String(i.number)].some((v) => v?.toLowerCase().replace(/\s/g, "").includes(needle)))
      .sort((a, b) => (sort === "dateFrom" ? a.dateFrom.localeCompare(b.dateFrom) : sort === "number" ? b.number - a.number : b.amount - a.amount));
  }, [items, status, vt, src, q, sort]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const sources = Array.from(new Set(items.map((i) => i.source)));

  function exportCsv() {
    const head = ["№", "Статус", "Имя", "Телефон", "Номер", "Тип", "Заезд", "Выезд", "Суток", "Сумма", "Оплачено", "Источник"];
    const lines = rows.map((r) => [r.number, STATUS_SHORT[r.status], r.name ?? "", r.phone ?? "", r.plate ?? "", r.vehicleType ? VEHICLE_LABEL[r.vehicleType] : "", r.dateFrom, r.dateTo, r.days, r.amount, r.paidAmount, SOURCE_LABEL[r.source]]);
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const chip = (active: boolean) => `h-8 rounded-full px-3 text-xs font-semibold ring-1 ring-inset transition ${active ? "bg-navy-deep text-white ring-navy-deep" : "bg-white text-ink-muted ring-line hover:ring-steel"}`;

  return (
    <div className="adm-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: имя, телефон, номер" className="adm-input h-8 w-56 text-sm" />
        <div className="flex flex-wrap gap-1">
          <button className={chip(status === "")} onClick={() => setStatus("")}>Все</button>
          {STATUSES.map((s) => (
            <button key={s} className={chip(status === s)} onClick={() => setStatus(status === s ? "" : s)}>{STATUS_SHORT[s]}</button>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-line" />
        <div className="flex gap-1">
          {VTS.map((v) => (
            <button key={v} className={chip(vt === v)} onClick={() => setVt(vt === v ? "" : v)}>{VEHICLE_LABEL[v]}</button>
          ))}
        </div>
        <select value={src} onChange={(e) => setSrc(e.target.value as BookingSource | "")} className="adm-input h-8 w-36 text-xs">
          <option value="">Источник: все</option>
          {sources.map((s) => (
            <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
          <span className="font-mono tnum">{rows.length} · {total.toLocaleString("ru-RU")} ₽</span>
          <button onClick={exportCsv} className="adm-btn h-8 px-3 text-xs">CSV</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-soft text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="cursor-pointer px-3 py-2" onClick={() => setSort("number")}>№</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Клиент</th>
              <th className="px-3 py-2">Авто</th>
              <th className="cursor-pointer px-3 py-2" onClick={() => setSort("dateFrom")}>Заезд → Выезд</th>
              <th className="cursor-pointer px-3 py-2 text-right" onClick={() => setSort("amount")}>Сумма</th>
              <th className="px-3 py-2">Источник</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-surface-soft">
                <td className="px-3 py-2 font-mono font-bold text-primary-deep"><Link href={`/admin/bookings/${r.id}`}>№{r.number}</Link></td>
                <td className="px-3 py-2"><StatusChip status={r.status} short /></td>
                <td className="px-3 py-2">
                  <div className="font-semibold">{r.name ?? <span className="text-ink-muted">—</span>}</div>
                  <div className="font-mono text-xs text-ink-muted">{formatPhone(r.phone)}</div>
                </td>
                <td className="px-3 py-2"><Plate plate={r.plate} size="sm" /></td>
                <td className="px-3 py-2 font-mono text-xs tnum">{r.dateFrom} → {r.dateTo} <span className="text-ink-muted">· {r.days}д</span></td>
                <td className="px-3 py-2 text-right font-mono tnum font-semibold">
                  {r.amount.toLocaleString("ru-RU")} ₽
                  {r.paidAmount < r.amount && <div className="text-[10px] font-normal text-warning">оплачено {r.paidAmount.toLocaleString("ru-RU")}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-ink-muted">{SOURCE_LABEL[r.source]}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-ink-muted">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
