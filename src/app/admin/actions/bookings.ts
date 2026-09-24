"use server";

import { revalidatePath } from "next/cache";
import type { BookingStatus, ResourceKind, VehicleType } from "@prisma/client";
import { requireActor, Forbidden, STAFF, ALL, OWNER } from "@/server/auth/guard";
import { correctStatusSchema, createBookingSchema, decideRecalcSchema, paymentSchema, reversePaymentSchema, updateBookingSchema } from "@/server/validation/booking";
import { addComment, addPayment, BookingError, CapacityError, changePrice, correctStatus, createBooking, crmCapacityHooks, decideRecalc, extendStay, transition, updateBooking, waiveOverstay } from "@/server/services/bookings";
import { reversePayment } from "@/server/services/bookings/payments";
import { quote } from "@/server/services/pricing";
import { occupancySummary, poolLoad } from "@/server/services/occupancy";
import { poolOf, type PoolKind } from "@/lib/occupancy-math";
import { searchClients } from "@/server/services/clients";
import { normalizePhone } from "@/lib/phone";
import { bookingDays } from "@/server/lib/dates";

// overCapacity — отказ по потолку мест (Ф3): canOverride — владелец может повторить действие с подтверждением «сверх вместимости»
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string>; overCapacity?: { canOverride: boolean } };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Forbidden) return { ok: false, error: "Нет доступа" };
  if (e instanceof CapacityError) return { ok: false, error: e.message, overCapacity: { canOverride: e.canOverride } };
  if (e instanceof BookingError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Ошибка сервера" };
}

function refresh() {
  revalidatePath("/admin", "layout");
}

export async function createBookingAction(raw: unknown, overCapacity?: boolean): Promise<ActionResult<{ id: string; number: number }>> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = createBookingSchema.safeParse(raw);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0] ?? "_")] = i.message;
      return { ok: false, error: "Проверьте поля", fieldErrors: fe };
    }
    if (!normalizePhone(parsed.data.phone)) return { ok: false, error: "Проверьте поля", fieldErrors: { phone: "Некорректный телефон" } };
    const b = await createBooking(parsed.data, actor, crmCapacityHooks(parsed.data, actor, overCapacity === true));
    refresh();
    return { ok: true, data: { id: b.id, number: b.number } };
  } catch (e) {
    return fail(e);
  }
}

export async function transitionAction(bookingId: string, to: BookingStatus, reason?: string, overCapacity?: boolean): Promise<ActionResult> {
  try {
    const actor = await requireActor(ALL);
    // Причина пишется в ленту только у отмены и отказа — иначе POST-ом можно подделать строку «по факту …»
    const why = to === "CANCELLED" || to === "REJECTED" ? reason?.trim().slice(0, 300) || undefined : undefined;
    await transition(bookingId, to, actor, { reason: why, overCapacity: overCapacity === true });
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// «Мест нет» — отказ с отметкой NO_SPACE (DECISIONS §2): клиенту уходит текст «мест нет», человек попадает в сегмент Ф8
export async function rejectNoSpaceAction(bookingId: string, reason?: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    await transition(bookingId, "REJECTED", actor, { reason: reason?.trim().slice(0, 300) || undefined, rejectKind: "NO_SPACE" });
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function correctStatusAction(bookingId: string, to: BookingStatus, reason: string, dates?: { in?: string; out?: string }, overCapacity?: boolean): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = correctStatusSchema.safeParse({ bookingId, to, reason, dateIn: dates?.in || undefined, dateOut: dates?.out || undefined });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
    await correctStatus(parsed.data.bookingId, parsed.data.to, parsed.data.reason, actor, { in: parsed.data.dateIn, out: parsed.data.dateOut }, { overCapacity: overCapacity === true });
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function changePriceAction(bookingId: string, amount: number, reason: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    if (!Number.isInteger(amount)) return { ok: false, error: "Сумма — целое число" };
    await changePrice(bookingId, amount, reason, actor);
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function waiveOverstayAction(bookingId: string, reason: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    await waiveOverstay(bookingId, reason, actor);
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// expected — сумма из баннера: применяется только тот расчёт, который человек видел
export async function decideRecalcAction(bookingId: string, apply: boolean, expected?: number): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = decideRecalcSchema.safeParse({ bookingId, apply, expected });
    if (!parsed.success || (apply && parsed.data.expected === undefined)) return { ok: false, error: "Бронь изменилась, пока был открыт расчёт — обновите страницу" };
    await decideRecalc(parsed.data.bookingId, parsed.data.apply, actor, parsed.data.expected);
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function extendStayAction(bookingId: string, dateTo: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    await extendStay(bookingId, dateTo, actor);
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function addPaymentAction(raw: unknown): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = paymentSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
    await addPayment({ ...parsed.data, note: parsed.data.note || undefined, reason: parsed.data.reason || undefined, settle: parsed.data.settle }, actor);
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// Сторно ошибочной оплаты — владелец (Ф10 Р9); отдельная запись платежа, исходная не меняется
export async function reversePaymentAction(paymentId: string, reason: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(OWNER);
    const parsed = reversePaymentSchema.safeParse({ paymentId, reason });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
    await reversePayment(parsed.data.paymentId, parsed.data.reason, actor);
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function addCommentAction(bookingId: string, text: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(ALL);
    const t = text.trim().slice(0, 2000);
    if (!t) return { ok: false, error: "Пустой комментарий" };
    await addComment(bookingId, t, actor);
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function updateBookingAction(raw: unknown, overCapacity?: boolean): Promise<ActionResult> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = updateBookingSchema.safeParse(raw);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0] ?? "_")] = i.message;
      return { ok: false, error: "Проверьте поля", fieldErrors: fe };
    }
    const d = parsed.data;
    await updateBooking(
      { ...d, name: d.name || undefined, plate: d.plate || undefined, comment: d.comment || undefined, timeFrom: d.timeFrom || undefined, timeTo: d.timeTo || undefined, resourceId: d.resourceId || undefined },
      actor,
      { overCapacity: overCapacity === true },
    );
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// pool — у парковки подсказка «свободно N из 405» по пулу, у фур — «из 10» (Ф3)
export type Quote = { amount: number; perDay: number; capacity: number; minFree: number; overbooked: boolean; days: number; pool?: PoolKind };

export async function quoteAction(kind: ResourceKind, dateFrom: string, dateTo: string, vehicleType?: VehicleType, roomType?: string, excludeBookingId?: string, timeFrom?: string, timeTo?: string): Promise<Quote | null> {
  try {
    await requireActor(ALL);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateTo < dateFrom) return null;
    const days = bookingDays(dateFrom, dateTo, timeFrom, timeTo, kind);
    if (days <= 0) return null;
    const q = await quote(kind, days, { vehicleType: vehicleType ?? null, roomType: roomType ?? null });
    if (kind === "PARKING") {
      const pool = poolOf(vehicleType);
      const load = await poolLoad(pool, dateFrom, dateTo, { excludeBookingId });
      return { amount: q.amount, perDay: q.perDay, capacity: load.capacity, minFree: load.minFree, overbooked: load.peak >= load.capacity, days, pool };
    }
    const occ = await occupancySummary(kind, dateFrom, dateTo, { roomType, excludeBookingId });
    return { amount: q.amount, perDay: q.perDay, capacity: occ.capacity, minFree: occ.minFree, overbooked: occ.overbooked, days };
  } catch {
    return null;
  }
}

export type ClientHit = { id: string; phone: string; name: string | null; bookings: number; vehicles: { plate: string | null; type: VehicleType }[] };

export async function searchClientsAction(q: string): Promise<ClientHit[]> {
  try {
    await requireActor(STAFF);
    if (q.trim().length < 3) return [];
    const rows = await searchClients(q.trim());
    return rows.map((c) => ({ id: c.id, phone: c.phone, name: c.name, bookings: c._count.bookings, vehicles: c.vehicles.map((v) => ({ plate: v.plate, type: v.type })) }));
  } catch {
    return [];
  }
}
