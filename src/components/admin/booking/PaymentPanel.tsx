"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentKind, PaymentMethod } from "@prisma/client";
import { addPaymentAction } from "@/app/admin/actions/bookings";
import { METHOD_LABEL } from "@/lib/crm/labels";

type P = { id: string; kind: PaymentKind; method: PaymentMethod; amount: number; paidAt: string; note: string | null };
const METHODS: PaymentMethod[] = ["CASH", "CARD_TERMINAL", "TRANSFER", "ONLINE"];

export default function PaymentPanel({ bookingId, unpaid, paid, payments }: { bookingId: string; unpaid: number; paid: number; payments: P[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<PaymentKind | null>(null);
  const [amount, setAmount] = useState(String(unpaid || ""));
  const [method, setMethod] = useState<PaymentMethod>("CARD_TERMINAL");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await addPaymentAction({ bookingId, kind: open, method, amount, note });
      if (!res.ok) return setErr(res.error);
      setOpen(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        {unpaid > 0 && (
          <button onClick={() => { setOpen("PAYMENT"); setAmount(String(unpaid)); }} className="adm-btn-primary h-9 px-3 text-sm">Принять оплату</button>
        )}
        {paid > 0 && (
          <button onClick={() => { setOpen("REFUND"); setAmount(String(paid)); }} className="adm-btn h-9 px-3 text-sm">Возврат</button>
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
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Примечание" className="adm-input h-10 text-sm" />
          {err && <p className="adm-err">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !amount} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Провести"}</button>
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
