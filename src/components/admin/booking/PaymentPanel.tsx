"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentKind, PaymentMethod } from "@prisma/client";
import { addPaymentAction } from "@/app/admin/actions/bookings";
import { METHOD_LABEL } from "@/lib/crm/labels";
import { applyRefund } from "@/lib/refund";
import { rub } from "@/lib/overstay";

type P = { id: string; kind: PaymentKind; method: PaymentMethod; amount: number; paidAt: string; note: string | null };
const METHODS: PaymentMethod[] = ["CASH", "CARD_TERMINAL", "TRANSFER", "ONLINE"];

// debt — показанный ДОЛГ за перестой: его можно принять заранее, сумма брони догонит оплату при выезде
// canSettle — можно ли менять цену галочкой «Это полная стоимость» (после выезда — только владелец)
// refundMax — предел возврата с сервера (refundLimit: после выезда администратор — только переплата); status — для расчёта «после возврата»
export default function PaymentPanel({ bookingId, total, status, unpaid, debt = 0, overstay = false, canSettle = true, paid, refundMax, payments }: { bookingId: string; total: number; status: string; unpaid: number; debt?: number; overstay?: boolean; canSettle?: boolean; paid: number; refundMax: number; payments: P[] }) {
  const due = unpaid + debt;
  const over = Math.max(0, paid - total);
  const router = useRouter();
  const [open, setOpen] = useState<PaymentKind | null>(null);
  const [amount, setAmount] = useState(String(due || ""));
  const [method, setMethod] = useState<PaymentMethod>("CARD_TERMINAL");
  const [note, setNote] = useState("");
  const [settle, setSettle] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await addPaymentAction({ bookingId, kind: open, method, amount, note, settle: open === "PAYMENT" && settle });
      if (!res.ok) return setErr(res.error);
      setOpen(null);
      setNote("");
      setSettle(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        {due > 0 && (
          <button onClick={() => { setOpen("PAYMENT"); setAmount(String(due)); setMethod("CARD_TERMINAL"); setNote(""); setSettle(false); setErr(null); }} className="adm-btn-primary h-9 px-3 text-sm">Принять оплату</button>
        )}
        {refundMax > 0 && (
          // По умолчанию — переплата; в перестое переплата — принятый заранее долг, её не предлагаем. Возврат — наличными (ТЗ 5.3)
          <button onClick={() => { setOpen("REFUND"); setAmount(over > 0 && !overstay ? String(Math.min(over, refundMax)) : ""); setMethod("CASH"); setNote(""); setSettle(false); setErr(null); }} className="adm-btn h-9 px-3 text-sm">Возврат</button>
        )}
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg border border-line bg-surface-soft p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{open === "PAYMENT" ? "Оплата" : "Возврат"}</div>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="adm-input h-10 font-mono" aria-label="Сумма" autoFocus />
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="adm-input h-10 text-sm">
              {METHODS.map((m) => (
                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
              ))}
            </select>
          </div>
          {open === "REFUND" && <RefundHint total={total} status={status} paid={paid} refundMax={refundMax} amount={Number(amount || 0)} />}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={open === "REFUND" ? "Причина возврата (обязательно)" : settle ? "Причина изменения цены (обязательно)" : "Примечание"} aria-label={open === "REFUND" ? "Причина возврата" : settle ? "Причина изменения цены" : "Примечание"} className="adm-input h-10 text-sm" aria-invalid={(open === "REFUND" && note.trim().length < 3) || (settle && !note.trim())} />
          {open === "PAYMENT" && !overstay && canSettle && Number(amount || 0) !== unpaid && (
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
              <span>Это полная стоимость — изменить сумму брони на {(paid + Number(amount || 0)).toLocaleString("ru-RU")} ₽ (скидка, договорённость)</span>
            </label>
          )}
          {err && <p className="adm-err">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !amount || (settle && !note.trim()) || (open === "REFUND" && note.trim().length < 3)} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Провести"}</button>
            <button type="button" onClick={() => setOpen(null)} className="adm-btn-ghost h-10 px-3 text-sm">Отмена</button>
          </div>
        </form>
      )}
      {payments.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-ink-muted">
          {payments.map((p) => (
            <li key={p.id} className="flex justify-between font-mono tnum">
              <span>{new Date(p.paidAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} · {METHOD_LABEL[p.method]}{p.note ? ` · ${p.note}` : ""}</span>
              <span className={p.kind === "REFUND" ? "text-danger" : "text-success"}>{p.kind === "REFUND" ? "−" : "+"}{p.amount.toLocaleString("ru-RU")} ₽</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Предел и итог возврата — той же applyRefund, что на сервере; по сумме кнопку не блокируем, отказывает сервер
function RefundHint({ total, status, paid, refundMax, amount }: { total: number; status: string; paid: number; refundMax: number; amount: number }) {
  const r = applyRefund({ status, amount: total, paid }, amount);
  const ownerOnly = status === "CHECKED_OUT" && refundMax < paid;
  return (
    <div className="space-y-0.5 text-xs text-ink-muted" data-testid="refund-hint">
      <div>Не больше {rub(refundMax)}{ownerOnly ? " — переплата; уменьшить сумму брони после выезда может владелец" : ""}</div>
      {r && amount <= refundMax && (
        <div className="font-mono tnum">
          После возврата: сумма {rub(r.amount)} · оплачено {rub(r.paid)}
          {r.amount > r.paid && <span className="text-warning"> · не оплачено {rub(r.amount - r.paid)}</span>}
        </div>
      )}
      {amount > refundMax && <div className="text-danger">Больше допустимого — возврат не пройдёт</div>}
    </div>
  );
}
