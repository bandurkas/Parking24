import "server-only";
import type { Booking, BookingStatus, Prisma } from "@prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { fmtDate, toIso } from "@/server/lib/dates";
import { rub, type Charge } from "@/lib/overstay";
import { CLOSED_STATUSES } from "@/lib/correction";

export class BookingError extends Error {}

// Строка брони под блокировкой до конца транзакции: два одновременных «Выехал» (охрана и администратор,
// двойное нажатие) иначе оба проходят проверку статуса и задваивают начисление перестоя.
// NO KEY UPDATE: вставки в ленту и платежи по этой брони из других транзакций не ждут
export async function lockBooking(tx: Prisma.TransactionClient, bookingId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR NO KEY UPDATE`;
}

// Действующее правило (changePrice): после выезда, отмены и «не приехал» деньги брони меняет только владелец
export const CLOSED: BookingStatus[] = CLOSED_STATUSES;

export function assertMoneyEditable(b: Booking, actor: SessionUser) {
  if (CLOSED.includes(b.status) && actor.role !== "OWNER") throw new BookingError("После выезда цену меняет только владелец");
}

// «Начислен перестой: 2 сут. × 350 ₽ = 700 ₽ · выезд 25 сент → 27 сент, 3 → 5 сут., 1 050 → 1 750 ₽»
export function chargeLine(b: { dateTo: Date; days: number; amount: number }, c: Charge, head: string): string {
  const moved = `${fmtDate(b.dateTo)} → ${fmtDate(c.dateTo)}, ${b.days} → ${c.days} сут.`;
  if (c.rate === 0) return `${head}: ${c.extra} сут., тариф не задан — уточните сумму · выезд ${moved}`;
  return `${head}: ${c.extra} сут. × ${rub(c.rate)} = ${rub(c.extra * c.rate)} · выезд ${moved}, ${rub(b.amount)} → ${rub(c.amount)}`;
}

export function stayOf(b: Booking) {
  return { kind: b.kind, dateTo: toIso(b.dateTo), vehicleType: b.vehicleType, days: b.days, amount: b.amount };
}

export async function cancelPendingOutbox(bookingId: string, tx: Prisma.TransactionClient) {
  await tx.outbox.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "CANCELLED" } });
}
