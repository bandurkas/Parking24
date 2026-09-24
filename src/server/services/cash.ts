import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { SessionUser } from "@/server/auth/session";
import { fmtDate, fmtDateTime, toDate } from "@/server/lib/dates";
import { shiftDateOf } from "@/lib/workshift";
import { cashDiff, expectedCash, shiftReportText, shiftTotals, signedRub, type ReportInput, type ShiftTotals } from "@/lib/cash";
import { rub } from "@/lib/overstay";
import { audit } from "./audit";
import { notify } from "./notices";

// Касса (Ф11, ТЗ 7): одна касса, открытая смена в системе всегда одна (PLAN §1, 22.09)
export class CashError extends Error {}

const OPEN = "OPEN";
type Db = Prisma.TransactionClient | typeof prisma;

export const currentShift = (db: Db = prisma) =>
  db.cashShift.findUnique({ where: { openKey: OPEN }, include: { openedBy: { select: { name: true } } } });

// Вызывается из addPayment в её транзакции прямо перед записью платежа.
// Поиск и блокировка одним запросом: если смену закрыли, пока платёж ждал, Postgres перепроверит openKey
// на новой версии строки и не вернёт её — платёж уйдёт вне смены, а не в уже снятый снимок
export async function shiftForPayment(tx: Prisma.TransactionClient): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "CashShift" WHERE "openKey" = ${OPEN} FOR KEY SHARE`;
  return rows[0]?.id ?? null;
}

// Подсказка начального остатка: фактический остаток прошлой закрытой смены
export async function lastClosedActual(): Promise<number> {
  const s = await prisma.cashShift.findFirst({ where: { closedAt: { not: null } }, orderBy: { closedAt: "desc" }, select: { actualCash: true } });
  return s?.actualCash ?? 0;
}

export async function openShift(openingBalance: number, actor: SessionUser) {
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const s = await tx.cashShift.create({ data: { openKey: OPEN, openedById: actor.id, openedAt: now, shiftDate: toDate(shiftDateOf(now)), openingBalance } });
      await audit(actor.id, "CREATE", "CashShift", s.id, { number: s.number, openingBalance }, tx);
      return s;
    });
  } catch (e) {
    // Уникальный openKey: второй одновременный «Открыть смену» не создаёт вторую запись
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const cur = await currentShift();
      throw new CashError(cur ? `Смена №${cur.number} уже открыта (${cur.openedBy.name}, ${fmtDateTime(cur.openedAt)}) — обновите страницу` : "Смена уже открыта — обновите страницу");
    }
    throw e;
  }
}

export async function addCollection(input: { shiftId: string; amount: number; takenBy: string; handedBy: string }, actor: SessionUser) {
  return prisma.$transaction(async (tx) => {
    // Та смена, которую видел человек, и она ещё открыта; закрытие дождётся этой записи
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "CashShift" WHERE id = ${input.shiftId} AND "openKey" = ${OPEN} FOR KEY SHARE`;
    if (!rows.length) throw new CashError("Смена уже закрыта — обновите страницу");
    const c = await tx.cashCollection.create({ data: { ...input, createdById: actor.id } });
    await audit(actor.id, "CREATE", "CashCollection", c.id, { ...input }, tx);
    return c;
  });
}

async function totalsOf(db: Db, shiftId: string): Promise<ShiftTotals> {
  const payments = await db.payment.findMany({ where: { cashShiftId: shiftId }, select: { kind: true, method: true, status: true, amount: true, reversalOfId: true } });
  const collections = await db.cashCollection.findMany({ where: { shiftId }, select: { amount: true } });
  return shiftTotals(payments, collections);
}

// Закрытие — только кнопкой с повторным подтверждением (PLAN §1, ответ 4 раздела 8).
// seenExpected — расчётный остаток, который человек видел: если с тех пор прошла оплата или инкассация, отказ
export async function closeShift(input: { shiftId: string; actualCash: number; seenExpected: number; confirmed: boolean }, actor: SessionUser) {
  if (!input.confirmed) throw new CashError("Подтвердите закрытие смены");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "CashShift" WHERE id = ${input.shiftId} FOR UPDATE`;
    const s = await tx.cashShift.findUnique({ where: { id: input.shiftId }, include: { openedBy: { select: { name: true } } } });
    if (!s) throw new CashError("Смена не найдена");
    if (s.closedAt) throw new CashError("Смена уже закрыта");
    const t = await totalsOf(tx, s.id);
    const expected = expectedCash(s.openingBalance, t);
    if (expected !== input.seenExpected) throw new CashError("Суммы изменились, пока была открыта форма (оплата, возврат или инкассация) — проверьте расчёт заново");
    const diff = cashDiff(input.actualCash, expected);
    const closed = await tx.cashShift.update({
      where: { id: s.id },
      data: { openKey: null, closedAt: new Date(), closedById: actor.id, ...t, expectedCash: expected, actualCash: input.actualCash, cashDiff: diff },
    });
    await audit(actor.id, "UPDATE", "CashShift", s.id, { closed: true, ...t, expectedCash: expected, actualCash: input.actualCash, cashDiff: diff }, tx);
    if (diff !== 0) {
      const by = s.openedById === actor.id ? "" : ` Закрыл: ${actor.name}.`;
      await notify("CASH_MISMATCH", `Смена №${s.number} (${s.openedBy.name}) закрыта с расхождением ${signedRub(diff)}: расчётный остаток ${rub(expected)}, фактический ${rub(input.actualCash)}.${by}`, null, tx);
    }
    return closed;
  });
}

export type ShiftOperation = { id: string; at: string; bookingId: string; bookingNumber: number; kind: string; method: string; amount: number; by: string | null; reversal: boolean; outOfTotals: boolean };
export type ShiftView = ReportInput & { id: string; open: boolean; operations: ShiftOperation[]; text: string };

// Смена для экрана: открытая — итоги на сейчас, закрытая — сохранённый снимок (ТЗ 7.5)
export async function shiftView(id: string): Promise<ShiftView | null> {
  const s = await prisma.cashShift.findUnique({
    where: { id },
    include: {
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      collections: { orderBy: { takenAt: "asc" } },
      payments: { orderBy: { paidAt: "asc" }, include: { booking: { select: { number: true } }, createdBy: { select: { name: true } } } },
    },
  });
  if (!s) return null;
  const open = !s.closedAt;
  const totals: ShiftTotals = open
    ? shiftTotals(s.payments, s.collections)
    : { cashIn: s.cashIn ?? 0, cardIn: s.cardIn ?? 0, cashRefund: s.cashRefund ?? 0, collected: s.collected ?? 0 };
  const r: ReportInput = {
    number: s.number,
    date: fmtDate(s.shiftDate, { day: "numeric", month: "long" }),
    admin: s.openedBy.name,
    opened: fmtDateTime(s.openedAt),
    closed: s.closedAt ? fmtDateTime(s.closedAt) : null,
    closedBy: s.closedBy && s.closedById !== s.openedById ? `закрыл: ${s.closedBy.name}` : null,
    opening: s.openingBalance,
    totals,
    expected: open ? expectedCash(s.openingBalance, totals) : (s.expectedCash ?? 0),
    actual: open ? null : s.actualCash,
    collections: s.collections.map((c) => ({ at: fmtDateTime(c.takenAt), amount: c.amount, takenBy: c.takenBy, handedBy: c.handedBy })),
  };
  const operations = s.payments.map((p) => ({
    id: p.id,
    at: fmtDateTime(p.paidAt),
    bookingId: p.bookingId,
    bookingNumber: p.booking.number,
    kind: p.kind,
    method: p.method,
    amount: p.amount,
    by: p.createdBy?.name ?? null,
    reversal: !!p.reversalOfId,
    outOfTotals: p.status !== "SUCCEEDED",
  }));
  return { ...r, id: s.id, open, operations, text: shiftReportText(r) };
}

export async function recentShifts(take = 30) {
  return prisma.cashShift.findMany({ where: { closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take, include: { openedBy: { select: { name: true } } } });
}

// Для отчёта Ф12: смены с датой смены в [fromIso, toIso] (московские ISO), снимок — колонками
export async function shiftsInRange(fromIso: string, toIso: string) {
  return prisma.cashShift.findMany({
    where: { shiftDate: { gte: toDate(fromIso), lte: toDate(toIso) } },
    orderBy: { openedAt: "asc" },
    include: { openedBy: { select: { id: true, name: true } }, closedBy: { select: { id: true, name: true } } },
  });
}
