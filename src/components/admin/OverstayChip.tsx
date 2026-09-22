import { AlertTriangle } from "lucide-react";
import { rub } from "@/lib/overstay";

export type OverstayView = { days: number; shown: number; rate: number };

// Значок перестоя на доске, в таблице и в списках: числа уже посчитаны на сервере
export default function OverstayChip({ o, className = "" }: { o: OverstayView; className?: string }) {
  const money = o.rate === 0 ? " · стоимость не задана" : o.shown > 0 ? ` · ${rub(o.shown)}` : " · оплачено";
  return (
    <span className={`inline-flex items-center gap-1 rounded bg-danger/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger ${className}`} data-testid="overstay-chip">
      <AlertTriangle size={10} /> перестой {o.days} д{money}
    </span>
  );
}
