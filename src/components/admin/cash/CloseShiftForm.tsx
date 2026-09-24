"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeShiftAction } from "@/app/admin/actions/cash";
import { cashDiff, signedRub } from "@/lib/cash";
import { rub } from "@/lib/overstay";

// ТЗ 7.2–7.3: фактический остаток → расхождение → повторное подтверждение (PLAN §1, ответ 4 раздела 8).
// expected — расчётный остаток с сервера; сервер пересчитает и откажет, если он изменился
export default function CloseShiftForm({ shiftId, expected }: { shiftId: string; expected: number }) {
  const router = useRouter();
  const [actual, setActual] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const diff = actual === "" ? null : cashDiff(Number(actual), expected);

  function close() {
    setErr(null);
    start(async () => {
      const r = await closeShiftAction({ shiftId, actualCash: Number(actual), seenExpected: expected, confirmed: true });
      if (!r.ok) {
        setConfirm(false);
        return setErr(r.error);
      }
      router.push(`/admin/cash/${shiftId}`);
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-ink-muted">Расчётный остаток на конец смены</span>
        <span className="font-mono tnum">{rub(expected)}</span>
      </div>
      <label className="block">
        <span className="adm-label">Фактический остаток наличных в кассе, ₽</span>
        <input value={actual} onChange={(e) => { setActual(e.target.value.replace(/\D/g, "")); setConfirm(false); }} inputMode="numeric" className="adm-input h-10 max-w-48 font-mono" aria-label="Фактический остаток" />
      </label>
      {diff != null && (
        <div className="flex justify-between gap-3 text-sm" data-testid="close-diff">
          <span className="text-ink-muted">Расхождение</span>
          <span className={`font-mono tnum ${diff !== 0 ? "font-semibold text-danger" : "text-success"}`}>{signedRub(diff)}</span>
        </div>
      )}
      {err && <p className="adm-err">{err}</p>}
      {!confirm ? (
        <button type="button" disabled={actual === ""} onClick={() => { setErr(null); setConfirm(true); }} className="adm-btn-primary h-10 px-4 text-sm">Закрыть смену</button>
      ) : (
        <div className="rounded-lg border border-warning/50 bg-warning/5 p-3" role="alertdialog" aria-label="Подтверждение закрытия смены">
          <p className="text-sm">
            Расчётный {rub(expected)}, фактический {rub(Number(actual))}, расхождение {signedRub(diff ?? 0)}. Закрыть смену? После закрытия итоги не меняются.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={close} disabled={pending} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Да, закрыть смену"}</button>
            <button type="button" onClick={() => setConfirm(false)} className="adm-btn-ghost h-10 px-3 text-sm">Назад</button>
          </div>
        </div>
      )}
    </div>
  );
}
