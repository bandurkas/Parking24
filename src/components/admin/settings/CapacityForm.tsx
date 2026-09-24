"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { saveCapacityAction } from "@/app/admin/actions/settings";
import type { ParkingSettings } from "@/server/services/settings";

// occupied, peak — готовые строки с сервера (Ф3): «Сейчас занято: пул N из 405, фуры M из 10», пик на 90 дней
export default function CapacityForm({ settings, occupied, peak }: { settings: ParkingSettings; occupied: string; peak: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [total, setTotal] = useState(String(settings.capacityTotal));
  const [truck, setTruck] = useState(String(settings.capacityTruck));
  const [limit, setLimit] = useState(String(settings.autoConfirmLimit));
  const [hold, setHold] = useState(String(settings.newLeadHoldHours));
  const [enforce, setEnforce] = useState(settings.enforceCapacity);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState(false);

  const reserve = Math.max(0, Number(total) - Number(limit));

  function save(confirm: boolean) {
    setMsg(null);
    setAsk(false);
    start(async () => {
      const res = await saveCapacityAction({
        capacityTotal: Number(total),
        capacityTruck: Number(truck),
        autoConfirmLimit: Number(limit),
        newLeadHoldHours: Number(hold),
        enforceCapacity: enforce,
        confirm,
      });
      setMsg(res.ok ? { ok: true, text: "Сохранено" } : { ok: false, text: res.error });
      if (!res.ok && "confirm" in res) setAsk(true);
      if (res.ok) router.refresh();
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save(false);
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

      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-56 flex-1">
          <div className="font-semibold">«Новая заявка» держит место, часов</div>
          <div className="text-xs text-ink-muted">Пока заявке меньше этого срока, её даты считаются занятыми. 0 — не держит. Рекомендуется 24.</div>
        </div>
        <input value={hold} onChange={(e) => setHold(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={num} aria-label="Новая заявка держит место, часов" />
      </div>

      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-56 flex-1">
          <div className="font-semibold">Проверка мест в CRM</div>
          <div className="text-xs text-ink-muted">
            Не даёт подтвердить бронь сверх вместимости: при создании, подтверждении, исправлении статуса и смене дат. Сверх вместимости может подтвердить владелец. «Заехал» не блокируется.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enforce}
          aria-label="Проверка мест в CRM"
          onClick={() => setEnforce((v) => !v)}
          className={`h-11 w-32 rounded-lg text-sm font-semibold ring-1 ${enforce ? "bg-success/12 text-[#0b7a4c] ring-success/40" : "bg-surface text-ink-muted ring-line"}`}
        >
          {enforce ? "включена" : "выключена"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button type="submit" disabled={pending} className="adm-btn-primary h-11 px-5">
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
        <span className="text-xs text-ink-muted">
          {occupied}
          <br />
          {peak}
        </span>
        {msg && (
          <span className={`ml-auto inline-flex items-center gap-1.5 text-sm font-semibold ${msg.ok ? "text-[#0b7a4c]" : "text-danger"}`}>
            {msg.ok ? <Check size={15} /> : <AlertTriangle size={15} />} {msg.text}
          </span>
        )}
        {ask && (
          <button type="button" disabled={pending} onClick={() => save(true)} className="adm-btn-danger h-11 px-4 text-sm">
            Да, сохранить с этим числом
          </button>
        )}
      </div>
    </form>
  );
}
