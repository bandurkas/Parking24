"use server";

import { revalidatePath } from "next/cache";
import type { BookingStatus, ResourceKind, VehicleType } from "@prisma/client";
import { requireActor, Forbidden, STAFF, ALL } from "@/server/auth/guard";
import { createBookingSchema, paymentSchema, updateBookingSchema } from "@/server/validation/booking";
import { addComment, addPayment, BookingError, createBooking, transition, updateBooking } from "@/server/services/bookings";
import { quote } from "@/server/services/pricing";
import { occupancySummary } from "@/server/services/occupancy";
import { searchClients } from "@/server/services/clients";
import { normalizePhone } from "@/lib/phone";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Forbidden) return { ok: false, error: "Нет доступа" };
  if (e instanceof BookingError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Ошибка сервера" };
}

function refresh() {
  revalidatePath("/admin", "layout");
}

export async function createBookingAction(raw: unknown): Promise<ActionResult<{ id: string; number: number }>> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = createBookingSchema.safeParse(raw);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0] ?? "_")] = i.message;
      return { ok: false, error: "Проверьте поля", fieldErrors: fe };
    }
    if (!normalizePhone(parsed.data.phone)) return { ok: false, error: "Проверьте поля", fieldErrors: { phone: "Некорректный телефон" } };
    const b = await createBooking(parsed.data, actor);
    refresh();
    return { ok: true, data: { id: b.id, number: b.number } };
  } catch (e) {
    return fail(e);
  }
}

export async function transitionAction(bookingId: string, to: BookingStatus, reason?: string): Promise<ActionResult> {
  try {
    const actor = await requireActor(ALL);
    await transition(bookingId, to, actor, { reason });
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
    await addPayment({ ...parsed.data, note: parsed.data.note || undefined }, actor);
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

export async function updateBookingAction(raw: unknown): Promise<ActionResult> {
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
    );
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export type Quote = { amount: number; perDay: number; capacity: number; minFree: number; overbooked: boolean; days: number };

export async function quoteAction(kind: ResourceKind, dateFrom: string, dateTo: string, vehicleType?: VehicleType, roomType?: string, excludeBookingId?: string): Promise<Quote | null> {
  try {
    await requireActor(ALL);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateTo <= dateFrom) return null;
    const days = Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000);
    const [q, occ] = await Promise.all([
      quote(kind, days, { vehicleType: vehicleType ?? null, roomType: roomType ?? null }),
      occupancySummary(kind, dateFrom, dateTo, { vehicleType, roomType, excludeBookingId }),
    ]);
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
