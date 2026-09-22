// Возврат (docs/phases/PHASE_SP_URGENT_FIXES.md §3.3). Чистые функции — одинаково в форме и на сервере.

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
