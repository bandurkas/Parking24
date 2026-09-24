"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openShiftAction } from "@/app/admin/actions/cash";

// ТЗ 7.1: имя администратора и время ставит система, начальный остаток — человек (подсказка — остаток прошлой смены)
export default function OpenShiftForm({ suggest, me }: { suggest: number; me: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(suggest));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await openShiftAction({ openingBalance: Number(amount) });
      if (!r.ok) return setErr(r.error);
      router.refresh();
    });
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <div className="text-sm">Администратор: <span className="font-semibold">{me}</span></div>
      <label className="block">
        <span className="adm-label">Начальный остаток наличных в кассе, ₽</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="adm-input h-10 max-w-48 font-mono" aria-label="Начальный остаток" />
      </label>
      <p className="text-xs text-ink-muted">Подставлен фактический остаток прошлой смены — пересчитайте деньги и поправьте, если в кассе другая сумма.</p>
      {err && <p className="adm-err">{err}</p>}
      <button type="submit" disabled={pending || amount === ""} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Открыть смену"}</button>
    </form>
  );
}
