import "server-only";
import type { BookingStatus, Prisma, ResourceKind, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { addDays, daysBetweenIso, moscowIso, overstayDayIso, plannedCheckIn, plannedCheckOut, toDate, toIso } from "@/server/lib/dates";
import {
  ARRIVAL_LATE_H, OPEN_END, dueState, effectiveSpan, fitOn, holdSinceOf, holdsSpace, loadByDay, loadByDayByType, peakLoad, poolOf, worstDay,
  type DayLoad, type Fit, type PoolKind, type Span,
} from "@/lib/occupancy-math";
import { parkingSettings, type ParkingSettings } from "./settings";

// Занятость парковки — одно правило в одном месте (docs/phases/PHASE_03_OCCUPANCY.md §3.1):
// кто держит место — occupiesWhere/holdsSpace, на каком отрезке — effectiveSpan, в каком пуле — poolOf.
// Все экраны, автоподтверждение и потолок в CRM читают parkingSpans и считают производные в памяти.

export const VEHICLE_TYPES: readonly VehicleType[] = ["CAR", "SUV", "MOTO", "TRUCK"];

// Окна «за 24 ч» (контракт Ф9б): заезды — подтверждённые, ещё не заехали (ТЗ 4.2, вопрос 5); выезды — стоят на парковке
export const ARRIVAL_STATUSES: readonly BookingStatus[] = ["AWAITING_PAYMENT", "CONFIRMED"];
export const DEPARTURE_STATUSES: readonly BookingStatus[] = ["CHECKED_IN"];

// SQL-часть правила — надмножество по датам, точный отрезок даёт effectiveSpan:
// «Заехал» — всегда (ранний заезд и перестой), «Ожидает оплаты»/«Подтверждена» — по датам,
// «Новая заявка» — по датам, пока создана позже holdSince (null — не держит)
export function occupiesWhere(from: string, to: string, holdSince: Date | null): Prisma.BookingWhereInput {
  const dated = { dateFrom: { lte: toDate(to) }, dateTo: { gte: toDate(from) } };
  const or: Prisma.BookingWhereInput[] = [{ status: "CHECKED_IN" }, { status: { in: ["AWAITING_PAYMENT", "CONFIRMED"] }, ...dated }];
  if (holdSince) or.push({ status: "NEW", createdAt: { gt: holdSince }, ...dated });
  return { OR: or };
}

export type HeldSpan = Span & { id: string; status: BookingStatus; vehicleType: VehicleType | null; pool: PoolKind; overstay: boolean };

// Контекст подсчёта: «сейчас», сегодняшняя дата по Москве, окно «Новой заявки» и настройки.
// db — транзакция вызывающего: настройки читаются тем же соединением (МФ-1)
export type OccupancyCtx = { now: Date; today: string; holdSince: Date | null; settings: ParkingSettings };

export async function occupancyCtx(db: Pick<Prisma.TransactionClient, "setting"> = prisma, now = new Date()): Promise<OccupancyCtx> {
  const settings = await parkingSettings(db);
  return { now, today: moscowIso(now), holdSince: holdSinceOf(now, settings.newLeadHoldHours), settings };
}

export const capacityOf = (s: ParkingSettings, pool: PoolKind) => (pool === "TRUCK" ? s.capacityTruck : s.capacityTotal);

// ЕДИНСТВЕННАЯ выборка занятости парковки на [from, to]. db — транзакция (автоподтверждение, потолок) или prisma
export async function parkingSpans(
  db: Pick<Prisma.TransactionClient, "booking">,
  from: string,
  to: string,
  opts: { today: string; holdSince: Date | null; excludeBookingId?: string },
): Promise<HeldSpan[]> {
  const rows = await db.booking.findMany({
    where: { kind: "PARKING", ...occupiesWhere(from, to, opts.holdSince), ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}) },
    select: { id: true, status: true, vehicleType: true, dateFrom: true, dateTo: true, createdAt: true },
  });
  return rows
    .filter((b) => holdsSpace(b, opts.holdSince))
    .map((b) => {
      const s = effectiveSpan({ status: b.status, dateFrom: toIso(b.dateFrom), dateTo: toIso(b.dateTo) }, opts.today);
      return { ...s, id: b.id, status: b.status, vehicleType: b.vehicleType, pool: poolOf(b.vehicleType), overstay: s.dateTo === OPEN_END };
    });
}

const inPool = (spans: HeldSpan[], pool: PoolKind) => spans.filter((s) => s.pool === pool);

// Пик занятости пула на отрезке брони и свободный минимум — подсказка «свободно N из 405» в формах CRM
export async function poolLoad(pool: PoolKind, from: string, to: string, opts: { excludeBookingId?: string } = {}) {
  const ctx = await occupancyCtx();
  const spans = inPool(await parkingSpans(prisma, from, to, { ...ctx, excludeBookingId: opts.excludeBookingId }), pool);
  const capacity = capacityOf(ctx.settings, pool);
  const peak = peakLoad(spans, from, to);
  return { peak, capacity, minFree: Math.max(0, capacity - peak), days: loadByDay(spans, from, to) };
}

// Потолок (§3.7): самый загруженный день отрезка без самой брони, сколько из занятых — перестой
export async function checkFit(db: Pick<Prisma.TransactionClient, "booking">, ctx: OccupancyCtx, c: { pool: PoolKind; from: string; to: string; excludeBookingId?: string }): Promise<Fit> {
  const spans = inPool(await parkingSpans(db, c.from, c.to, { ...ctx, excludeBookingId: c.excludeBookingId }), c.pool);
  return fitOn(spans, c.from, c.to, capacityOf(ctx.settings, c.pool));
}

// Сегодняшний срез: на стоянке (только «Заехал»), занято бронями (все, кто держит место), свободно = вместимость − на стоянке
// (эталон ТЗ 4.2: одна машина → 404), под новые заявки = вместимость − занято бронями
export type PoolToday = { onSite: number; held: number; capacity: number; free: number; open: number };
export type ParkingToday = { pool: PoolToday; truck: PoolToday; byType: { vehicleType: VehicleType; busy: number }[] };

function sliceToday(spans: HeldSpan[], today: string, s: ParkingSettings): ParkingToday {
  const on = spans.filter((x) => x.dateFrom <= today && x.dateTo >= today);
  const part = (pool: PoolKind): PoolToday => {
    const p = inPool(on, pool);
    const onSite = p.filter((x) => x.status === "CHECKED_IN").length;
    const capacity = capacityOf(s, pool);
    return { onSite, held: p.length, capacity, free: Math.max(0, capacity - onSite), open: Math.max(0, capacity - p.length) };
  };
  return { pool: part("POOL"), truck: part("TRUCK"), byType: VEHICLE_TYPES.map((vt) => ({ vehicleType: vt, busy: on.filter((x) => x.vehicleType === vt).length })) };
}

export async function parkingToday(): Promise<ParkingToday> {
  const ctx = await occupancyCtx();
  return sliceToday(await parkingSpans(prisma, ctx.today, ctx.today, ctx), ctx.today, ctx.settings);
}

// «Заезды за 24 ч» (ТЗ 4.2): подтверждённые, плановый заезд в окне; опоздавшие — тоже (вопрос 13), но не дольше 48 ч.
// overdue — сколько из них опаздывают
export async function arrivalsIn24h(now = new Date()): Promise<{ total: number; overdue: number }> {
  const today = moscowIso(now);
  const rows = await prisma.booking.findMany({
    where: { kind: "PARKING", status: { in: [...ARRIVAL_STATUSES] }, dateFrom: { gte: toDate(addDays(today, -3)), lte: toDate(addDays(today, 2)) } },
    select: { dateFrom: true, timeFrom: true },
  });
  const floor = now.getTime() - ARRIVAL_LATE_H * 3_600_000;
  let total = 0;
  let overdue = 0;
  for (const r of rows) {
    const at = plannedCheckIn(r);
    const due = dueState(at, now);
    if (due === null || at.getTime() < floor) continue;
    total++;
    if (due === "late") overdue++;
  }
  return { total, overdue };
}

// «Выезды за 24 ч»: стоящие машины, плановый выезд раньше «сейчас + 24 ч», просроченные входят (вопрос 6).
// overdue — сколько из них в перестое (правило Ф2: с 01:00 МСК следующего дня после даты выезда)
export async function departuresIn24h(now = new Date()): Promise<{ total: number; overdue: number }> {
  const rows = await prisma.booking.findMany({
    where: { kind: "PARKING", status: { in: [...DEPARTURE_STATUSES] }, dateTo: { lte: toDate(addDays(moscowIso(now), 2)) } },
    select: { dateTo: true, timeTo: true },
  });
  const day = overstayDayIso(now);
  let total = 0;
  let overdue = 0;
  for (const r of rows) {
    if (dueState(plannedCheckOut(r), now) === null) continue;
    total++;
    if (toIso(r.dateTo) < day) overdue++;
  }
  return { total, overdue };
}

// Пять показателей панели (ТЗ 4.2) — пул 405 без фур, фуры отдельной строкой
export async function parkingDashboard(now = new Date()) {
  const ctx = await occupancyCtx(prisma, now);
  const [spans, arrivals, departures] = await Promise.all([parkingSpans(prisma, ctx.today, ctx.today, ctx), arrivalsIn24h(now), departuresIn24h(now)]);
  const t = sliceToday(spans, ctx.today, ctx.settings);
  return { ...t, arrivals, departures, autoConfirm: ctx.settings.autoConfirm, autoConfirmLimit: ctx.settings.autoConfirmLimit };
}

// Сетка на 3 недели: пул, фуры, категории (только «занято», ТЗ 4.1) и сколько дней ближайших трёх недель
// заняты на порог и выше — считается всегда от сегодня, а не от показанного ?from=
export async function occupancyGrid(start: string, end: string): Promise<{ pool: DayLoad[]; truck: DayLoad[]; byType: { vehicleType: string; days: DayLoad[] }[]; limitDays: number }> {
  const ctx = await occupancyCtx();
  const limitTo = addDays(ctx.today, 20);
  const spans = await parkingSpans(prisma, start < ctx.today ? start : ctx.today, end > limitTo ? end : limitTo, ctx);
  const pool = inPool(spans, "POOL");
  return {
    pool: loadByDay(pool, start, end),
    truck: loadByDay(inPool(spans, "TRUCK"), start, end),
    byType: loadByDayByType(spans, start, end, VEHICLE_TYPES),
    limitDays: loadByDay(pool, ctx.today, limitTo).filter((d) => d.busy >= ctx.settings.autoConfirmLimit).length,
  };
}

// Пик занятости на ближайшие days дней — сверка вместимости при сохранении настроек (§3.9)
export async function peakAhead(days = 90): Promise<Record<PoolKind, { day: string; busy: number }>> {
  const ctx = await occupancyCtx();
  const to = addDays(ctx.today, days);
  const spans = await parkingSpans(prisma, ctx.today, to, ctx);
  return { POOL: worstDay(inPool(spans, "POOL"), ctx.today, to), TRUCK: worstDay(inPool(spans, "TRUCK"), ctx.today, to) };
}

// ── Только комнаты. Занятость парковки считает parkingSpans — вторым путём её не посчитать ──

const ROOM_ACTIVE: readonly BookingStatus[] = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"];

function roomsOnly(kind: ResourceKind) {
  if (kind === "PARKING") throw new Error("Занятость парковки считает parkingSpans (occupancy.ts)");
}

export type DayOccupancy = { date: string; busy: number; capacity: number; free: number; overbooked: boolean };

export async function capacityFor(kind: ResourceKind, roomType?: string | null): Promise<number> {
  roomsOnly(kind);
  const rows = await prisma.capacityConfig.findMany({ where: { kind, roomType: roomType ?? undefined } });
  return rows.reduce((s, r) => s + r.capacity, 0);
}

type OccupancyOpts = { roomType?: string | null; excludeBookingId?: string };

// Занятость комнат по дням в диапазоне [from, to): комната занята до дня выезда
export async function occupancy(kind: ResourceKind, from: string, to: string, opts: OccupancyOpts = {}): Promise<DayOccupancy[]> {
  roomsOnly(kind);
  const capacity = await capacityFor(kind, opts.roomType);
  const n = Math.max(1, daysBetweenIso(from, to));
  const days = Array.from({ length: n }, (_, i) => addDays(from, i));
  const rows = await prisma.booking.findMany({
    where: {
      kind,
      status: { in: [...ROOM_ACTIVE] },
      dateFrom: { lt: toDate(to) },
      dateTo: { gt: toDate(from) },
      ...(opts.roomType ? { roomType: opts.roomType } : {}),
      ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
    },
    select: { dateFrom: true, dateTo: true },
  });
  return days.map((day) => {
    const t = toDate(day).getTime();
    const busy = rows.filter((b) => b.dateFrom.getTime() <= t && b.dateTo.getTime() > t).length;
    return { date: day, busy, capacity, free: Math.max(0, capacity - busy), overbooked: capacity > 0 && busy >= capacity };
  });
}

export async function occupancySummary(kind: ResourceKind, from: string, to: string, opts: OccupancyOpts = {}) {
  const days = await occupancy(kind, from, to, opts);
  const minFree = Math.min(...days.map((d) => d.free));
  const capacity = days[0]?.capacity ?? 0;
  return { capacity, minFree, overbooked: days.some((d) => d.overbooked), days };
}
