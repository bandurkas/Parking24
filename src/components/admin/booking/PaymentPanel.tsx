"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentKind, PaymentMethod } from "@prisma/client";
import { addPaymentAction, reversePaymentAction } from "@/app/admin/actions/bookings";
import { METHOD_LABEL } from "@/lib/crm/labels";
import { applyRefund } from "@/lib/refund";
import { rub } from "@/lib/overstay";

// Строка платежа — готовые строки с сервера: время по Москве, сотрудник, причина; reversed — сторно этой оплаты
export type PayRow = {
  id: string; kind: PaymentKind; method: PaymentMethod; amount: number; at: string; by: string | null; text: string | null;
  reversed: { at: string; by: string | null; reason: string | null } | null; canReverse: boolean;
};
const METHODS: PaymentMethod[] = ["CASH", "CARD_TERMINAL", "TRANSFER", "ONLINE"];

// debt — показанный ДОЛГ за перестой: его можно принять заранее, сумма брони догонит оплату при выезде
// canSettle — можно ли менять цену галочкой «Это полная стоимость» (после выезда — только владелец)
// refundMax — предел возврата с сервера (refundLimit: после выезда администратор — только переплата); status — для расчёта «после возврата»
// overpaid — переплата с сервера: кнопка возврата предлагает её готовой суммой (ТЗ 5.3)
export default function PaymentPanel({ bookingId, total, status, unpaid, debt = 0, overstay = false, canSettle = true, paid, refundMax, overpaid, payments }: {
  bookingId: string; total: number; status: string; unpaid: number; debt?: number; overstay?: boolean; canSettle?: boolean; paid: number; refundMax: number; overpaid: number; payments: PayRow[];
}) {
  const due = unpaid + debt;
  // В перестое переплата — принятый заранее долг, её не предлагаем
  const offer = overpaid > 0 && !overstay ? Math.min(overpaid, refundMax) : 0;
  const router = useRouter();
  const [open, setOpen] = useState<PaymentKind | null>(null);
  const [amount, setAmount] = useState(String(due || ""));
  const [method, setMethod] = useState<PaymentMethod>("CARD_TERMINAL");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [settle, setSettle] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await addPaymentAction({ bookingId, kind: open, method, amount, note: open === "PAYMENT" ? note : "", reason: open === "REFUND" ? reason : "", settle: open === "PAYMENT" && settle });
      if (!res.ok) return setErr(res.error);
      setOpen(null);
      setNote("");
      setReason("");
      setSettle(false);
      router.refresh();
    });
  }

  const refundOpen = open === "REFUND";
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {due > 0 && (
          <button onClick={() => { setOpen("PAYMENT"); setAmount(String(due)); setMethod("CARD_TERMINAL"); setNote(""); setSettle(false); setErr(null); }} className="adm-btn-primary h-9 px-3 text-sm">Принять оплату</button>
        )}
        {refundMax > 0 && (
          // Возврат по умолчанию — наличными (ТЗ 5.3); способ виден и меняется, сервер пишет тот, что выбран
          <button onClick={() => { setOpen("REFUND"); setAmount(offer ? String(offer) : ""); setMethod("CASH"); setReason(""); setSettle(false); setErr(null); }} className="adm-btn h-9 px-3 text-sm">
            {offer ? `Оформить возврат ${rub(offer)}` : "Возврат"}
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg border border-line bg-surface-soft p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{open === "PAYMENT" ? "Оплата" : "Возврат"}</div>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="adm-input h-10 font-mono" aria-label="Сумма" autoFocus />
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="adm-input h-10 text-sm" aria-label="Способ">
              {METHODS.map((m) => (
                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
              ))}
            </select>
          </div>
          {refundOpen && (
            <p className="text-xs text-ink-muted" data-testid="refund-method-hint">
              {method === "CASH" ? "Наличными — уменьшит наличные в кассе." : "Не наличными — наличные в кассе не меняются."} Укажите способ, которым деньги действительно вернули.
            </p>
          )}
          {refundOpen && <RefundHint total={total} status={status} paid={paid} refundMax={refundMax} amount={Number(amount || 0)} />}
          {refundOpen ? (
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина возврата (обязательно)" aria-label="Причина возврата" className="adm-input h-10 text-sm" maxLength={300} aria-invalid={reason.trim().length < 3} />
          ) : (
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={settle ? "Причина изменения цены (обязательно)" : "Примечание"} aria-label={settle ? "Причина изменения цены" : "Примечание"} className="adm-input h-10 text-sm" maxLength={300} aria-invalid={settle && !note.trim()} />
          )}
          {open === "PAYMENT" && !overstay && canSettle && Number(amount || 0) !== unpaid && (
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
              <span>Это полная стоимость — изменить сумму брони на {(paid + Number(amount || 0)).toLocaleString("ru-RU")} ₽ (скидка, договорённость)</span>
            </label>
          )}
          {err && <p className="adm-err">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !amount || (settle && !note.trim()) || (refundOpen && reason.trim().length < 3)} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Провести"}</button>
            <button type="button" onClick={() => setOpen(null)} className="adm-btn-ghost h-10 px-3 text-sm">Отмена</button>
          </div>
        </form>
      )}
      {payments.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-xs text-ink-muted">
          {payments.map((p) => <PaymentLine key={p.id} p={p} />)}
        </ul>
      )}
    </div>
  );
}

// Две строки, чтобы на телефоне сумма не уезжала: «дата, время · способ · сотрудник» и сумма, ниже — причина
function PaymentLine({ p }: { p: PayRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const refund = p.kind === "REFUND";
  return (
    <li data-testid="payment-row">
      <div className={`flex justify-between gap-2 font-mono tnum ${p.reversed ? "line-through" : ""}`}>
        <span>{p.at} · {METHOD_LABEL[p.method]}{p.by ? ` · ${p.by}` : ""}</span>
        <span className={p.reversed ? "" : refund ? "text-danger" : "text-success"}>{refund ? "−" : "+"}{p.amount.toLocaleString("ru-RU")} ₽</span>
      </div>
      {p.text && <div className={p.reversed ? "line-through" : ""}>{p.text}</div>}
      {p.reversed && (
        <div className="font-semibold text-danger" data-testid="payment-reversed">сторно · {p.reversed.reason}{p.reversed.by ? ` · ${p.reversed.by}` : ""} · {p.reversed.at}</div>
      )}
      {p.canReverse && !open && (
        <button onClick={() => { setOpen(true); setReason(""); setErr(null); }} className="adm-btn-ghost mt-0.5 h-7 px-2 text-[11px] text-ink-muted">Сторно</button>
      )}
      {open && (
        <form
          onSubmit={(e) => { e.preventDefault(); setErr(null); start(async () => { const r = await reversePaymentAction(p.id, reason); if (!r.ok) setErr(r.error); else { setOpen(false); router.refresh(); } }); }}
          className="mt-1 space-y-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-ink"
        >
          <p className="text-xs">Сторно отменит только учёт этой оплаты: «оплачено» уменьшится на {rub(p.amount)}, сумма брони не изменится. Если этой оплатой меняли сумму брони («Это полная стоимость»), поправьте сумму отдельно.</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина сторно (обязательно): оплата не на ту бронь…" aria-label="Причина сторно" className="adm-input h-10 text-sm" maxLength={300} autoFocus />
          {err && <p className="adm-err">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || reason.trim().length < 3} className="adm-btn-danger h-10 px-4 text-sm">{pending ? "…" : "Провести сторно"}</button>
            <button type="button" onClick={() => setOpen(false)} className="adm-btn-ghost h-10 px-3 text-sm">Отмена</button>
          </div>
        </form>
      )}
    </li>
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
