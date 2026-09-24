import "server-only";
import type { Booking, BookingStatus, Prisma, ResourceKind, VehicleType } from "@prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { fmtDate, fmtDateTime, toIso, todayIso } from "@/server/lib/dates";
import { rub, type Charge } from "@/lib/overstay";
import { CLOSED_STATUSES } from "@/lib/correction";
import { poolOf, type Fit } from "@/lib/occupancy-math";
import { capacityRefusal, checkSpan, overCapacityLine, overCapacityNotice, type CheckMode } from "@/lib/capacity";
import { checkFit, occupancyCtx } from "../occupancy";
import { audit } from "../audit";
import { notify } from "../notices";

export class BookingError extends Error {}

// Строка брони под блокировкой до конца транзакции: два одновременных «Выехал» (охрана и администратор,
// двойное нажатие) иначе оба проходят проверку статуса и задваивают начисление перестоя.
// NO KEY UPDATE: вставки в ленту и платежи по этой брони из других транзакций не ждут
export async function lockBooking(tx: Prisma.TransactionClient, bookingId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR NO KEY UPDATE`;
}

// Свой ключ: OCCUPANCY_LOCK (24_0921) держат заявки с сайта, SCHEDULER_LOCK (24_0922) — тик
const CONTRACT_LOCK = 24_0923;

// Номер договора хранения (Ф5, решение 22.09): MAX+1 под блокировкой до конца транзакции заезда — два заезда
// разных машин иначе прочитают один MAX (lockBooking держит только свою строку). Не SEQUENCE: откат оставлял бы дыру.
// Звать последним перед update брони; @unique — последний рубеж
export async function nextContractNumber(tx: Prisma.TransactionClient): Promise<number> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CONTRACT_LOCK})`);
  const agg = await tx.booking.aggregate({ _max: { contractNumber: true } });
  return (agg._max.contractNumber ?? 0) + 1;
}

// Действующее правило (changePrice): после выезда, отмены и «не приехал» деньги брони меняет только владелец
export const CLOSED: BookingStatus[] = CLOSED_STATUSES;

export function assertMoneyEditable(b: Booking, actor: SessionUser) {
  if (CLOSED.includes(b.status) && actor.role !== "OWNER") throw new BookingError("После выезда цену меняет только владелец");
}

// Деньги брони — владелец и администратор; второй рубеж после requireActor(STAFF) в действиях
export function assertMoneyActor(actor: SessionUser) {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") throw new BookingError("Деньги брони ведёт администратор");
}

// «Начислен перестой: 2 сут. × 350 ₽ = 700 ₽ · выезд 25 сент → 27 сент, 3 → 5 сут., 1 050 → 1 750 ₽»
export function chargeLine(b: { dateTo: Date; days: number; amount: number }, c: Charge, head: string): string {
  const moved = `${fmtDate(b.dateTo)} → ${fmtDate(c.dateTo)}, ${b.days} → ${c.days} сут.`;
  if (c.rate === 0) return `${head}: ${c.extra} сут., тариф не задан — уточните сумму · выезд ${moved}`;
  return `${head}: ${c.extra} сут. × ${rub(c.rate)} = ${rub(c.extra * c.rate)} · выезд ${moved}, ${rub(b.amount)} → ${rub(c.amount)}`;
}

// Выход из «Отклонена»: отметки остаются (Ф10 Р12), в ленте — что именно снято
export function rejectClearedLine(b: Pick<Booking, "rejectedAt" | "rejectKind">): string {
  return `Отклонение снято (${b.rejectKind === "NO_SPACE" ? "нет мест" : "другая причина"})${b.rejectedAt ? ` · отклонена ${fmtDateTime(b.rejectedAt)}` : ""}`;
}

export function stayOf(b: Booking) {
  return { kind: b.kind, dateTo: toIso(b.dateTo), vehicleType: b.vehicleType, days: b.days, amount: b.amount };
}

export async function cancelPendingOutbox(bookingId: string, tx: Prisma.TransactionClient) {
  await tx.outbox.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "CANCELLED" } });
}

// ── Потолок мест в CRM (docs/phases/PHASE_03_OCCUPANCY.md §3.7–3.8) ──────────────────────────
// Порядок блокировок жёсткий: lockOccupancy (autoconfirm.ts) → lockBooking, иначе взаимная блокировка.
// Жёсткую проверку вызывающий делает под lockOccupancy, взятым первым в транзакции. Мягкая (оплата) читает без него —
// она только пишет строку в ленту и уведомление, лёгкое опоздание данных допустимо.

export class CapacityError extends BookingError {
  constructor(readonly fit: Fit, readonly canOverride: boolean, message: string) {
    super(message);
  }
}

export type CapacitySpan = { id?: string; kind: ResourceKind; vehicleType: VehicleType | null; dateFrom: string; dateTo: string };

// null — проверять нечего (не парковка, проверка выключена в настройках, места хватает).
// Fit — сверх вместимости, но пропускаем (заезд, мягкая проверка при оплате или владелец подтвердил):
// вызывающий пишет noteOverCapacity. Иначе — отказ с цифрами
export async function guardCapacity(
  tx: Prisma.TransactionClient,
  b: CapacitySpan,
  mode: CheckMode,
  actor: SessionUser | null,
  opts: { override?: boolean; soft?: boolean } = {},
): Promise<Fit | null> {
  if (b.kind !== "PARKING") return null;
  const ctx = await occupancyCtx(tx);
  if (!ctx.settings.enforceCapacity) return null;
  const span = checkSpan(mode, b, ctx.today);
  if (!span) return null;
  const pool = poolOf(b.vehicleType);
  const fit = await checkFit(tx, ctx, { pool, from: span.dateFrom, to: span.dateTo, excludeBookingId: b.id });
  if (fit.ok) return null;
  if (mode === "checkin" || opts.soft) return fit;
  const owner = actor?.role === "OWNER";
  if (opts.override && owner) return fit;
  throw new CapacityError(fit, owner, capacityRefusal(fit, pool));
}

// Сверх вместимости прошло: строка в ленту брони, журнал и уведомление администратору
export async function noteOverCapacity(tx: Prisma.TransactionClient, b: { id: string; number: number; clientId: string | null }, fit: Fit, how: "override" | "soft", what: string, actor: SessionUser | null) {
  const diff = { overCapacity: true, how, day: fit.day, peak: fit.busy, capacity: fit.capacity };
  await tx.interaction.create({ data: { bookingId: b.id, clientId: b.clientId, type: "SYSTEM", text: overCapacityLine(fit, how, what), userId: actor?.id ?? null, meta: diff } });
  await audit(actor?.id ?? null, "UPDATE", "Booking", b.id, diff, tx);
  // Ключ: одно уведомление на бронь, событие, худший день и дату события
  await notify("CAPACITY_OVER", overCapacityNotice(b.number, fit, how, what), b.id, { tx, key: `capacity-over:${b.id}:${how}:${what}:${fit.day}:${todayIso()}` });
}
