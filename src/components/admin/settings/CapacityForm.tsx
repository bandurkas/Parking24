"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { saveCapacityAction } from "@/app/admin/actions/settings";
import type { ParkingSettings } from "@/server/services/settings";

export default function CapacityForm({ settings, occupiedNow }: { settings: ParkingSettings; occupiedNow: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [total, setTotal] = useState(String(settings.capacityTotal));
  const [truck, setTruck] = useState(String(settings.capacityTruck));
  const [limit, setLimit] = useState(String(settings.autoConfirmLimit));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reserve = Math.max(0, Number(total) - Number(limit));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await saveCapacityAction({
        capacityTotal: Number(total),
        capacityTruck: Number(truck),
        autoConfirmLimit: Number(limit),
      });
      setMsg(res.ok ? { ok: true, text: "Сохранено" } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  }

  const num = "adm-input h-11 w-32 font-mono tnum";

  return (
    <form onSubmit={submit} className="adm-card mt-4 divide-y divide-line">
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-56 flex-1">
          <div className="font-semibold">Всего мест</div>
          <div className="text-xs text-ink-muted">Легковые, кроссоверы и мотоциклы вместе</div>
        </div>
        <input value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={num} aria-label="Всего мест" />
      </div>

      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-56 flex-1">
          <div className="font-semibold">Мест для грузовых</div>
          <div className="text-xs text-ink-muted">Считаются отдельно, автоподтверждение не применяется</div>
        </div>
        <input value={truck} onChange={(e) => setTruck(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={num} aria-label="Мест для грузовых" />
      </div>

      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-56 flex-1">
          <div className="font-semibold">Автоподтверждение до</div>
          <div className="text-xs text-ink-muted">
            Заявки подтверждаются, пока занято меньше этого числа. Остальные {reserve} мест — резерв администратора.
          </div>
        </div>
        <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={num} aria-label="Порог автоподтверждения" />
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button type="submit" disabled={pending} className="adm-btn-primary h-11 px-5">
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
        <span className="text-xs text-ink-muted">Сейчас занято мест: {occupiedNow}</span>
        {msg && (
          <span className={`ml-auto inline-flex items-center gap-1.5 text-sm font-semibold ${msg.ok ? "text-[#0b7a4c]" : "text-danger"}`}>
            {msg.ok ? <Check size={15} /> : <AlertTriangle size={15} />} {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
