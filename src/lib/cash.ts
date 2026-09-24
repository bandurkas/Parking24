// Касса (Ф11, ТЗ 7): чистые правила без базы — итоги смены, расчётный остаток, текст отчёта
import { rub } from "@/lib/overstay";

export type CashPaymentRow = { kind: string; method: string; status: string; amount: number; reversalOfId: string | null };
export type ShiftTotals = { cashIn: number; cardIn: number; cashRefund: number; collected: number };

// Только проведённые платежи. Сторно (REFUND с reversalOfId) уменьшает оплаты своего способа, а не «возвраты»:
// это отмена ошибочной записи, клиенту деньги не выдавались
export function shiftTotals(payments: CashPaymentRow[], collections: { amount: number }[]): ShiftTotals {
  const t: ShiftTotals = { cashIn: 0, cardIn: 0, cashRefund: 0, collected: 0 };
  for (const p of payments) {
    if (p.status !== "SUCCEEDED") continue;
    if (p.kind === "REFUND" && !p.reversalOfId) {
      if (p.method === "CASH") t.cashRefund += p.amount;
      continue;
    }
    const v = p.kind === "PAYMENT" ? p.amount : -p.amount;
    if (p.method === "CASH") t.cashIn += v;
    else if (p.method === "CARD_TERMINAL") t.cardIn += v;
  }
  for (const c of collections) t.collected += c.amount;
  return t;
}

// ТЗ 7.3: остаток на конец = начало + наличные оплаты − возвраты наличными − инкассация
export const expectedCash = (opening: number, t: ShiftTotals) => opening + t.cashIn - t.cashRefund - t.collected;
export const cashDiff = (actual: number, expected: number) => actual - expected;
export const signedRub = (n: number) => (n > 0 ? `+${rub(n)}` : n < 0 ? `−${rub(-n)}` : rub(0));

export type ReportInput = {
  number: number;
  date: string;
  admin: string;
  opened: string;
  closed: string | null;
  closedBy: string | null;
  opening: number;
  totals: ShiftTotals;
  expected: number;
  actual: number | null;
  collections: { at: string; amount: number; takenBy: string; handedBy: string }[];
};

// Строки формы и отчёта ТЗ 7.2 / 7.5
export function reportRows(d: ReportInput): [string, string][] {
  const rows: [string, string][] = [
    ["Администратор", d.admin],
    ["Остаток на начало смены", rub(d.opening)],
    ["Получено наличными", rub(d.totals.cashIn)],
    ["Получено картами", rub(d.totals.cardIn)],
    ["Возвраты наличными", rub(d.totals.cashRefund)],
    ["Инкассация", rub(d.totals.collected)],
    [d.actual == null ? "Расчётный остаток сейчас" : "Расчётный остаток на конец смены", rub(d.expected)],
  ];
  if (d.actual != null) rows.push(["Фактический остаток", rub(d.actual)], ["Расхождение", signedRub(cashDiff(d.actual, d.expected))]);
  return rows;
}

export const collectionLine = (c: ReportInput["collections"][number]) => `${c.at} · ${rub(c.amount)} · забрал: ${c.takenBy} · передал: ${c.handedBy}`;

// «Скопировать отчёт»: строки ТЗ 7.2, под инкассацией — кто забрал и кто передал
export function shiftReportText(d: ReportInput): string {
  const lines = [
    `Смена №${d.number} · ${d.date}`,
    `Открыта ${d.opened}${d.closed ? ` · закрыта ${d.closed}${d.closedBy ? ` (${d.closedBy})` : ""}` : " · не закрыта"}`,
    "",
  ];
  for (const [label, value] of reportRows(d)) {
    lines.push(`${label}: ${value}`);
    if (label === "Инкассация") for (const c of d.collections) lines.push(`  ${collectionLine(c)}`);
  }
  return lines.join("\n");
}
