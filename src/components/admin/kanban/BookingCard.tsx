"use client";

import Link from "next/link";
import { Bus, Clock } from "lucide-react";
import type { KanbanItem } from "./KanbanBoard";
import Plate from "../Plate";
import { SOURCE_LABEL, VEHICLE_SHORT } from "@/lib/crm/labels";
import { formatPhone } from "@/lib/phone";

function d(iso: string) {
  const [, m, day] = iso.split("-");
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${Number(day)} ${months[Number(m) - 1]}`;
}

export default function BookingCard({ item, dragging = false }: { item: KanbanItem; dragging?: boolean }) {
  const unpaid = item.amount > 0 && item.paidAmount < item.amount;
  const partial = item.paidAmount > 0 && unpaid;
  return (
    <article className={`adm-card group relative select-none p-3 ${dragging ? "rotate-1 shadow-card-lg ring-2 ring-primary" : "hover:ring-primary/60"}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/admin/bookings/${item.id}`} onPointerDown={(e) => e.stopPropagation()} className="font-mono text-xs font-bold text-primary-deep hover:underline">
          №{item.number}
        </Link>
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{SOURCE_LABEL[item.source]}</span>
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold">{item.name || <span className="text-ink-muted">Без имени</span>}</div>
      <div className="font-mono text-xs text-ink-muted">{formatPhone(item.phone)}</div>
      <div className="mt-2 flex items-center gap-2">
        <Plate plate={item.plate} size="sm" />
        {item.vehicleType && <span className="text-[11px] font-semibold text-steel">{VEHICLE_SHORT[item.vehicleType]}</span>}
        {item.roomType && <span className="text-[11px] font-semibold text-steel">{item.roomType}</span>}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-xs tnum">
        <span>
          {d(item.dateFrom)} → {d(item.dateTo)} <span className="text-ink-muted">· {item.days}д</span>
        </span>
        <span className={`font-bold ${unpaid ? (partial ? "text-warning" : "text-ink") : "text-success"}`}>{item.amount.toLocaleString("ru-RU")} ₽</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-muted">
        {item.timeFrom && <span className="flex items-center gap-1"><Clock size={11} /> {item.timeFrom}</span>}
        {item.transferNeeded && <span className="flex items-center gap-1 text-primary-deep"><Bus size={11} /> трансфер</span>}
        {partial && <span className="ml-auto text-warning">оплачено {item.paidAmount.toLocaleString("ru-RU")}</span>}
      </div>
    </article>
  );
}
