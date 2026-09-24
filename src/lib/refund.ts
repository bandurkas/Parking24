// Возврат (docs/phases/PHASE_SP_URGENT_FIXES.md §3.3) и сторно (Ф10). Чистые функции — одинаково в форме и на сервере.
import { rub } from "./overstay";

export type RefundRow = { status: string; amount: number; paid: number };

// over — переплата до возврата; cut — на сколько уменьшилась сумма брони
export type RefundPlan = { amount: number; paid: number; over: number; cut: number };

// «Выехал»: возврат сначала гасит переплату, остаток уменьшает сумму брони — «не оплачено» не меняется.
// Остальные статусы: сумма брони та же, после возврата долг возвращается (ошибочная оплата не делает бронь бесплатной).
export function applyRefund(b: RefundRow, refund: number): RefundPlan | null {
  if (!(refund > 0) || refund > b.paid) return null;
  const over = Math.max(0, b.paid - b.amount);
  const cut = b.status === "CHECKED_OUT" ? Math.max(0, refund - over) : 0;
  return { amount: b.amount - cut, paid: b.paid - refund, over, cut };
}

// После выезда сумму брони возвратом уменьшает только владелец — администратор возвращает переплату
export function refundLimit(b: RefundRow, isOwner: boolean): number {
  return b.status === "CHECKED_OUT" && !isOwner ? Math.max(0, b.paid - b.amount) : b.paid;
}

// Полный возврат или сторно до заезда: «Подтверждена» значит «оплачена» (решение 3) — без оплаты бронь снова ждёт её (DECISIONS §3: всегда)
export function demoteAfterRefund(b: { status: string; paid: number }): "AWAITING_PAYMENT" | null {
  return b.status === "CONFIRMED" && b.paid <= 0 ? "AWAITING_PAYMENT" : null;
}

export type ReversalRow = { kind: string; status: string; reversalOfId: string | null; reversed: boolean; amount: number };

// Сторно ошибочной оплаты: владелец, только оплата, один раз, не больше оплаченного (иначе «оплачено» ушло бы в минус)
export function reversalError(p: ReversalRow, paid: number, isOwner: boolean): string | null {
  if (!isOwner) return "Сторно оформляет владелец";
  if (p.kind !== "PAYMENT" || p.reversalOfId) return "Сторнируется только оплата: ошибочный возврат гасится новой оплатой";
  if (p.reversed) return "Платёж уже сторнирован";
  if (p.status !== "SUCCEEDED") return "Платёж не проведён — сторнировать нечего";
  if (p.amount > paid) return `Сторно больше оплаченного: оплачено ${rub(paid)} — по брони уже был возврат`;
  return null;
}
