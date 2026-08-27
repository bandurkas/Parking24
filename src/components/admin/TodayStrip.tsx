import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { VehicleType } from "@prisma/client";
import { VEHICLE_SHORT } from "@/lib/crm/labels";

type Occ = { vehicleType: VehicleType; capacity: number; busy: number; free: number };

export default function TodayStrip({ today, occupancy, arrivals, departures }: { today: string; occupancy: Occ[]; arrivals: number; departures: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/admin/today" className="adm-card flex h-10 items-center gap-3 px-3 text-sm hover:ring-primary/50">
        <span className="flex items-center gap-1.5"><ArrowDownToLine size={15} className="text-success" /> <b className="font-mono">{arrivals}</b> заезд</span>
        <span className="h-4 w-px bg-line" />
        <span className="flex items-center gap-1.5"><ArrowUpFromLine size={15} className="text-primary" /> <b className="font-mono">{departures}</b> выезд</span>
      </Link>
      {occupancy.length > 0 && (
        <Link href="/admin/occupancy" className="adm-card flex h-10 items-center gap-3 px-3 hover:ring-primary/50" title={`Занятость на ${today}`}>
          {occupancy.map((o) => {
            const pct = o.capacity ? Math.min(100, Math.round((o.busy / o.capacity) * 100)) : 0;
            const color = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success";
            return (
              <span key={o.vehicleType} className="flex items-center gap-1.5 text-xs">
                <span className="text-ink-muted">{VEHICLE_SHORT[o.vehicleType]}</span>
                <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-surface">
                  <span className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                </span>
                <span className="font-mono tnum"><b>{o.busy}</b>/{o.capacity}</span>
              </span>
            );
          })}
        </Link>
      )}
    </div>
  );
}
