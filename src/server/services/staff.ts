import "server-only";
import { Prisma, type WorkShift } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { SessionUser } from "@/server/auth/session";
import { OWNER } from "@/server/auth/guard";
import { audit } from "./audit";
import { moscowIso, toDate, toIso } from "@/server/lib/dates";
import { ROLE_LABEL } from "@/lib/crm/labels";
import {
  SELF_UNDO_MIN, SLOT_LABEL, addMonths, colorOf, columnsOf, countsOf, dayLabel, gridEditCheck, hhmm, lastOwnAction, longDate,
  monthDays, monthEnd, monthOf, monthStart, monthTitle, shiftState, shortDate, slotHours, startOptions, tabelToday,
  type Column, type Day, type ReportRow, type ShiftState, type Slot, type StartOption,
} from "@/lib/workshift";
import type { EmployeeInput, MarkInput, PositionInput } from "@/server/validation/staff";

export class StaffError extends Error {}
const code = (e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null);

const NO_CARD = "Вас ещё нет в табеле. Попросите владельца связать ваш логин с карточкой сотрудника";
const CARD_OFF = "Ваша карточка в табеле выключена — обратитесь к владельцу";
const POS_OFF = "Ваша должность выключена в табеле — обратитесь к владельцу";
const NOT_OPEN = "Смена не открыта — обновите экран";

type StateRow = Pick<WorkShift, "date" | "slot" | "startedAt" | "endedAt" | "openFor">;
const stateOf = (r: StateRow, now: Date) =>
  shiftState({ date: toIso(r.date), slot: r.slot, startedAt: r.startedAt, endedAt: r.endedAt, openFor: r.openFor }, now);

export async function cardOf(userId: string) {
  return prisma.employee.findUnique({ where: { userId }, include: { position: true } });
}

// ── «Моя смена»: только своё, без ставок и чужих имён (реш. 4.2.10) ──

export type MyMonth = {
  month: string;
  title: string;
  count: number;
  prev: string;
  next: string | null;
  items: { key: string; label: string; slot: string; times: string; state: ShiftState }[];
};
export type MyShiftState =
  | { linked: false }
  | {
      linked: true;
      name: string;
      position: string;
      blocked: string | null;
      open: { label: string; hhmm: string } | null;
      options: (StartOption & { label: string })[];
      undo: { kind: "start" | "leave"; until: string } | null;
      month: MyMonth;
    };
export type MyShiftResult = { state: MyShiftState; notice: string | null };

const optionLabel = (o: StartOption) => `${SLOT_LABEL[o.slot]} · ${shortDate(o.date)}${o.late ? " · прошедшая" : ""}`;

function timesOf(r: Pick<WorkShift, "startedAt" | "endedAt">, st: ShiftState): string {
  if (st === "manual" || !r.startedAt) return "вручную";
  const s = hhmm(r.startedAt);
  if (st === "late") return `отмечено позже, ${s}`;
  if (st === "open") return `${s} — на смене`;
  if (st === "no-leave") return `${s}, уход не отмечен`;
  return r.endedAt ? `${s}–${hhmm(r.endedAt)}` : s;
}

export async function myMonth(employeeId: string, month: string, now = new Date()): Promise<MyMonth> {
  const cur = monthOf(tabelToday(now));
  const m = month > cur ? cur : month;
  const rows = await prisma.workShift.findMany({
    where: { employeeId, date: { gte: toDate(monthStart(m)), lte: toDate(monthEnd(m)) } },
    orderBy: [{ date: "desc" }, { slot: "asc" }],
    select: { id: true, date: true, slot: true, startedAt: true, endedAt: true, openFor: true },
  });
  return {
    month: m,
    title: monthTitle(m),
    count: rows.length,
    prev: addMonths(m, -1),
    next: m < cur ? addMonths(m, 1) : null,
    items: rows.map((r) => {
      const st = stateOf(r, now);
      return { key: r.id, label: dayLabel(toIso(r.date)), slot: SLOT_LABEL[r.slot].toLowerCase(), times: timesOf(r, st), state: st };
    }),
  };
}

export async function myShiftState(user: SessionUser, month?: string, now = new Date()): Promise<MyShiftState> {
  const emp = await cardOf(user.id);
  if (!emp) return { linked: false };
  const since = new Date(now.getTime() - SELF_UNDO_MIN * 60_000);
  const [openRow, recent, mon] = await Promise.all([
    prisma.workShift.findUnique({ where: { openFor: emp.id } }),
    prisma.workShift.findMany({
      where: { employeeId: emp.id, OR: [{ startedAt: { gte: since } }, { endedAt: { gte: since } }] },
      select: { id: true, startedAt: true, endedAt: true },
    }),
    myMonth(emp.id, month ?? monthOf(tabelToday(now)), now),
  ]);
  const open = openRow?.startedAt && stateOf(openRow, now) === "open" ? openRow : null;
  const blocked = !emp.isActive ? CARD_OFF : !emp.position.isActive ? POS_OFF : null;
  const last = lastOwnAction(recent, now);
  return {
    linked: true,
    name: emp.name,
    position: emp.position.name,
    blocked,
    open: open && { label: `${SLOT_LABEL[open.slot]}, ${longDate(toIso(open.date))}`, hhmm: hhmm(open.startedAt!) },
    options: open || blocked ? [] : startOptions(now, emp.position.slots).map((o) => ({ ...o, label: optionLabel(o) })),
    undo: last && { kind: last.kind, until: new Date(last.at.getTime() + SELF_UNDO_MIN * 60_000).toISOString() },
    month: mon,
  };
}

export async function startOwnShift(user: SessionUser, input: { date: string; slot: Slot }, now = new Date()): Promise<MyShiftResult> {
  const emp = await cardOf(user.id); // сотрудник только из сессии, не из формы
  if (!emp) throw new StaffError(NO_CARD);
  if (!emp.isActive) throw new StaffError(CARD_OFF);
  if (!emp.position.isActive) throw new StaffError(POS_OFF);
  const opt = startOptions(now, emp.position.slots).find((o) => o.date === input.date && o.slot === input.slot);
  if (!opt) throw new StaffError("Эту смену нельзя отметить самому — обратитесь к администратору");
  try {
    await prisma.$transaction(async (tx) => {
      if (!opt.late) {
        const open = await tx.workShift.findUnique({ where: { openFor: emp.id } });
        if (open) {
          if (open.startedAt && stateOf(open, now) === "open") throw new StaffError(`Смена уже открыта с ${hhmm(open.startedAt)} — сначала отметьте уход`);
          await tx.workShift.update({ where: { id: open.id }, data: { openFor: null } }); // забытый уход: время не выдумываем
        }
      }
      const key = { employeeId: emp.id, date: toDate(input.date), slot: input.slot };
      const same = await tx.workShift.findUnique({ where: { employeeId_date_slot: key } });
      if (same?.startedAt) throw new StaffError(`Эта смена уже отмечена: приход ${hhmm(same.startedAt)}`);
      const openFor = opt.late ? null : emp.id;
      const row = same
        ? await tx.workShift.update({ where: { id: same.id }, data: { startedAt: now, openFor } })
        : await tx.workShift.create({
            data: { ...key, positionId: emp.positionId, hours: slotHours(input.slot), startedAt: now, createdAt: now, openFor, markedById: user.id },
          });
      await audit(user.id, same ? "UPDATE" : "CREATE", "WorkShift", row.id,
        { via: "self", op: opt.late ? "start-late" : "start", employee: emp.name, date: input.date, slot: input.slot, at: now.toISOString() }, tx);
    });
  } catch (e) {
    if (code(e) === "P2002") throw new StaffError(opt.late ? "Эта смена уже отмечена — обновите экран" : "Смена уже открыта — обновите экран");
    throw e;
  }
  return { state: await myShiftState(user, undefined, now), notice: null };
}

export async function endOwnShift(user: SessionUser, now = new Date()): Promise<MyShiftResult> {
  const emp = await cardOf(user.id); // выключенная карточка уход отмечает
  if (!emp) throw new StaffError(NO_CARD);
  const row = await prisma.workShift.findUnique({ where: { openFor: emp.id } });
  if (!row?.startedAt) throw new StaffError(NOT_OPEN);
  const stale = stateOf(row, now) !== "open";
  try {
    await prisma.$transaction(async (tx) => {
      await tx.workShift.update({ where: { id: row.id, openFor: emp.id }, data: stale ? { openFor: null } : { endedAt: now, openFor: null } });
      await audit(user.id, "UPDATE", "WorkShift", row.id,
        { via: "self", op: stale ? "leave-stale" : "leave", employee: emp.name, date: toIso(row.date), slot: row.slot, at: now.toISOString() }, tx);
    });
  } catch (e) {
    if (code(e) === "P2025") throw new StaffError(NOT_OPEN);
    throw e;
  }
  return { state: await myShiftState(user, undefined, now), notice: stale ? "Смена закончилась больше 4 ч назад — время ухода не записано" : null };
}

export async function undoOwnShift(user: SessionUser, now = new Date()): Promise<MyShiftResult> {
  const emp = await cardOf(user.id);
  if (!emp) throw new StaffError(NO_CARD);
  const since = new Date(now.getTime() - SELF_UNDO_MIN * 60_000);
  const rows = await prisma.workShift.findMany({ where: { employeeId: emp.id, OR: [{ startedAt: { gte: since } }, { endedAt: { gte: since } }] } });
  const last = lastOwnAction(rows, now);
  const row = last && rows.find((r) => r.id === last.id);
  if (!last || !row) throw new StaffError(`Отменять нечего — прошло больше ${SELF_UNDO_MIN} минут`);
  const snap = { via: "self", employee: emp.name, date: toIso(row.date), slot: row.slot, startedAt: row.startedAt?.toISOString() ?? null, endedAt: row.endedAt?.toISOString() ?? null };
  try {
    await prisma.$transaction(async (tx) => {
      if (last.kind === "leave") {
        await tx.workShift.update({ where: { id: row.id, endedAt: row.endedAt }, data: { endedAt: null, openFor: emp.id } });
        await audit(user.id, "UPDATE", "WorkShift", row.id, { ...snap, op: "undo-leave" }, tx);
      } else if (row.startedAt && row.createdAt.getTime() === row.startedAt.getTime()) {
        await tx.workShift.delete({ where: { id: row.id, startedAt: row.startedAt } }); // строку создал этот приход
        await audit(user.id, "DELETE", "WorkShift", row.id, { ...snap, op: "undo-start" }, tx);
      } else {
        await tx.workShift.update({ where: { id: row.id, startedAt: row.startedAt }, data: { startedAt: null, openFor: null } }); // приход лёг на ручную отметку
        await audit(user.id, "UPDATE", "WorkShift", row.id, { ...snap, op: "undo-start" }, tx);
      }
    });
  } catch (e) {
    if (code(e) === "P2002") throw new StaffError("Уже открыта другая смена — отменить уход нельзя");
    if (code(e) === "P2025") throw new StaffError(NOT_OPEN);
    throw e;
  }
  return { state: await myShiftState(user, undefined, now), notice: null };
}

// ── Сетка: владелец и администратор; всё — в журнал ──

type GridActor = SessionUser & { role: "OWNER" | "ADMIN" };

export async function markShift(input: MarkInput, actor: SessionUser, now = new Date()): Promise<{ id: string }> {
  const a = actor as GridActor;
  const [emp, pos] = await Promise.all([
    prisma.employee.findUnique({ where: { id: input.employeeId } }),
    prisma.staffPosition.findUnique({ where: { id: input.positionId } }),
  ]);
  if (!emp) throw new StaffError("Сотрудник не найден");
  if (!pos || !pos.slots.includes(input.slot)) throw new StaffError("У этой должности нет такой смены");
  const no = gridEditCheck({ actorRole: a.role, actorId: a.id, empUserId: emp.userId, date: input.date, today: tabelToday(now) });
  if (no) throw new StaffError(no);
  const date = toDate(input.date);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.workShift.create({ data: { employeeId: emp.id, positionId: pos.id, date, slot: input.slot, hours: slotHours(input.slot), markedById: a.id } });
      await audit(a.id, "CREATE", "WorkShift", r.id, { via: "grid", employee: emp.name, position: pos.name, date: input.date, slot: input.slot }, tx);
      return r;
    });
    return { id: row.id };
  } catch (e) {
    if (code(e) !== "P2002") throw e;
    const ex = await prisma.workShift.findUnique({ where: { employeeId_date_slot: { employeeId: emp.id, date, slot: input.slot } }, include: { position: true } });
    if (!ex) throw new StaffError("Отметка изменилась — обновите экран");
    if (ex.positionId === pos.id) return { id: ex.id }; // повторный клик, вторая вкладка
    throw new StaffError(`${emp.name} уже отмечен: ${ex.position.name} · ${SLOT_LABEL[input.slot].toLowerCase()}`);
  }
}

export async function unmarkShift(input: { id: string }, actor: SessionUser, now = new Date()): Promise<void> {
  const a = actor as GridActor;
  const row = await prisma.workShift.findUnique({ where: { id: input.id }, include: { employee: true, position: true, markedBy: { select: { name: true } } } });
  if (!row) return; // уже сняли в другой вкладке
  const no = gridEditCheck({ actorRole: a.role, actorId: a.id, empUserId: row.employee.userId, date: toIso(row.date), today: tabelToday(now) });
  if (no) throw new StaffError(no);
  const at = (d: Date | null) => (d ? `${moscowIso(d)} ${hhmm(d)}` : null); // фактический момент по Москве
  try {
    await prisma.$transaction(async (tx) => {
      await tx.workShift.delete({ where: { id: row.id } });
      // снимок целиком: самоотметка — доказательство, её время прихода и ухода остаётся в журнале
      await audit(a.id, "DELETE", "WorkShift", row.id, {
        employee: row.employee.name, position: row.position.name, date: toIso(row.date), slot: row.slot,
        startedAt: at(row.startedAt), endedAt: at(row.endedAt), markedBy: row.markedBy?.name ?? null,
      }, tx);
    });
  } catch (e) {
    if (code(e) !== "P2025") throw e; // P2025 — сняли параллельно, итог тот же
  }
}

export type BoardMark = { id: string; employeeId: string; positionId: string; date: string; slot: Slot; state: ShiftState; hint: string; hours: number };
export type BoardPerson = { id: string; name: string; color: number; positionId: string; isActive: boolean; self: boolean };
export type StaffBoard = {
  month: string;
  title: string;
  prev: string;
  next: string;
  today: string;
  version: string;
  isOwner: boolean;
  days: Day[];
  columns: Column[];
  positions: { id: string; name: string; isActive: boolean }[];
  people: BoardPerson[];
  marks: BoardMark[];
};

function hintOf(r: WorkShift & { markedBy: { name: string } | null }, st: ShiftState): string {
  if (st === "manual") return `Поставил ${r.markedBy?.name ?? "система"} · без времени`;
  const s = hhmm(r.startedAt!);
  if (st === "late") return `Приход отмечен в ${s}, после конца смены`;
  if (st === "open") return `Отметился сам: приход ${s}, на смене`;
  if (st === "no-leave") return `Отметился сам: приход ${s}, уход не отмечен`;
  return `Отметился сам: приход ${s}${r.endedAt ? `, уход ${hhmm(r.endedAt)}` : ""}`;
}

export async function staffBoard(month: string, user: SessionUser, now = new Date()): Promise<StaffBoard> {
  const from = monthStart(month);
  const to = monthEnd(month);
  const [positions, employees, rows] = await Promise.all([
    prisma.staffPosition.findMany({ orderBy: [{ createdAt: "asc" }, { name: "asc" }] }),
    prisma.employee.findMany({ orderBy: { name: "asc" } }),
    prisma.workShift.findMany({ where: { date: { gte: toDate(from), lte: toDate(to) } }, include: { markedBy: { select: { name: true } } } }),
  ]);
  const marks: BoardMark[] = rows.map((r) => {
    const st = stateOf(r, now);
    return { id: r.id, employeeId: r.employeeId, positionId: r.positionId, date: toIso(r.date), slot: r.slot, state: st, hint: hintOf(r, st), hours: r.hours };
  });
  const withMarks = new Set(marks.map((m) => m.employeeId));
  return {
    month,
    title: monthTitle(month),
    prev: addMonths(month, -1),
    next: addMonths(month, 1),
    today: tabelToday(now),
    version: now.toISOString(),
    isOwner: OWNER.includes(user.role),
    days: monthDays(month),
    columns: columnsOf(positions, marks),
    positions: positions.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive })),
    people: employees
      .filter((e) => e.isActive || withMarks.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, color: colorOf(e.id), positionId: e.positionId, isActive: e.isActive, self: e.userId === user.id })),
    marks,
  };
}

export async function periodReport(from: string, to: string): Promise<ReportRow[]> {
  const rows = await prisma.workShift.findMany({
    where: { date: { gte: toDate(from), lte: toDate(to) } },
    orderBy: [{ position: { createdAt: "asc" } }, { employee: { name: "asc" } }],
    select: { employeeId: true, positionId: true, slot: true, hours: true, employee: { select: { name: true } }, position: { select: { name: true } } },
  });
  return countsOf(rows.map((r) => ({ employeeId: r.employeeId, employee: r.employee.name, positionId: r.positionId, position: r.position.name, slot: r.slot, hours: r.hours })));
}

// ── Справочник: только владелец ──

export type PeopleData = {
  positions: { id: string; name: string; slots: Slot[]; isActive: boolean; employees: number; shifts: number }[];
  employees: {
    id: string; name: string; positionId: string; userId: string | null; isActive: boolean; shifts: number;
    login: { login: string; name: string; role: string; isActive: boolean } | null;
  }[];
  users: { id: string; login: string; name: string; role: string; isActive: boolean; cardId: string | null }[];
};

export async function peopleData(): Promise<PeopleData> {
  const [positions, employees, users] = await Promise.all([
    prisma.staffPosition.findMany({ orderBy: [{ createdAt: "asc" }, { name: "asc" }], include: { _count: { select: { employees: true, shifts: true } } } }),
    prisma.employee.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { user: { select: { login: true, name: true, role: true, isActive: true } }, _count: { select: { shifts: true } } },
    }),
    prisma.user.findMany({ orderBy: { login: "asc" }, select: { id: true, login: true, name: true, role: true, isActive: true, employee: { select: { id: true } } } }),
  ]);
  return {
    positions: positions.map((p) => ({ id: p.id, name: p.name, slots: p.slots, isActive: p.isActive, employees: p._count.employees, shifts: p._count.shifts })),
    employees: employees.map((e) => ({
      id: e.id, name: e.name, positionId: e.positionId, userId: e.userId, isActive: e.isActive, shifts: e._count.shifts,
      login: e.user && { login: e.user.login, name: e.user.name, role: ROLE_LABEL[e.user.role], isActive: e.user.isActive },
    })),
    users: users.map((u) => ({ id: u.id, login: u.login, name: u.name, role: ROLE_LABEL[u.role], isActive: u.isActive, cardId: u.employee?.id ?? null })),
  };
}

const posSnap = (p: { name: string; slots: Slot[]; isActive: boolean }) => ({ name: p.name, slots: p.slots, isActive: p.isActive });

export async function savePosition(input: PositionInput, actor: SessionUser): Promise<{ id: string }> {
  const data = { name: input.name, slots: input.slots, isActive: input.isActive };
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.id) {
        const before = await tx.staffPosition.findUnique({ where: { id: input.id } });
        if (!before) throw new StaffError("Должность не найдена");
        const p = await tx.staffPosition.update({ where: { id: input.id }, data });
        await audit(actor.id, "UPDATE", "StaffPosition", p.id, { before: posSnap(before), after: posSnap(p) }, tx);
        return { id: p.id };
      }
      const p = await tx.staffPosition.create({ data });
      await audit(actor.id, "CREATE", "StaffPosition", p.id, posSnap(p), tx);
      return { id: p.id };
    });
  } catch (e) {
    if (code(e) === "P2002") throw new StaffError("Должность с таким названием уже есть");
    throw e;
  }
}

export async function deletePosition(id: string, actor: SessionUser): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const p = await tx.staffPosition.delete({ where: { id } });
      await audit(actor.id, "DELETE", "StaffPosition", id, posSnap(p), tx);
    });
  } catch (e) {
    if (code(e) === "P2003") throw new StaffError("У должности есть сотрудники или смены — её можно только выключить");
    if (code(e) === "P2025") return;
    throw e;
  }
}

const empSnap = (e: { name: string; positionId: string; userId: string | null; isActive: boolean }) =>
  ({ name: e.name, positionId: e.positionId, userId: e.userId, isActive: e.isActive });

export async function saveEmployee(input: EmployeeInput, actor: SessionUser): Promise<{ id: string }> {
  const data = { name: input.name, positionId: input.positionId, userId: input.userId || null, isActive: input.isActive };
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await tx.staffPosition.findUnique({ where: { id: data.positionId } }))) throw new StaffError("Должность не найдена");
      if (data.userId) {
        const other = await tx.employee.findFirst({ where: { userId: data.userId, NOT: input.id ? { id: input.id } : undefined } });
        if (other) throw new StaffError(`Логин уже связан с карточкой «${other.name}» — сначала отвяжите его там`);
        if (!(await tx.user.findUnique({ where: { id: data.userId } }))) throw new StaffError("Логин не найден");
      }
      if (input.id) {
        const before = await tx.employee.findUnique({ where: { id: input.id } });
        if (!before) throw new StaffError("Сотрудник не найден");
        const e = await tx.employee.update({ where: { id: input.id }, data });
        await audit(actor.id, "UPDATE", "Employee", e.id, { before: empSnap(before), after: empSnap(e) }, tx);
        return { id: e.id };
      }
      const e = await tx.employee.create({ data });
      await audit(actor.id, "CREATE", "Employee", e.id, empSnap(e), tx);
      return { id: e.id };
    });
  } catch (e) {
    if (code(e) === "P2002") throw new StaffError("Логин уже связан с другой карточкой — сначала отвяжите его там");
    throw e;
  }
}

export async function deleteEmployee(id: string, actor: SessionUser): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const e = await tx.employee.delete({ where: { id } });
      await audit(actor.id, "DELETE", "Employee", id, empSnap(e), tx);
    });
  } catch (e) {
    if (code(e) === "P2003") throw new StaffError("У сотрудника есть смены — его можно только выключить");
    if (code(e) === "P2025") return;
    throw e;
  }
}
