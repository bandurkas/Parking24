import { z } from "zod";
import { daysBetweenIso, toDate, toIso } from "@/server/lib/dates";

const id = z.string().min(1).max(40);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => toIso(toDate(s)) === s, "Нет такой даты");
const slot = z.enum(["DAY", "NIGHT", "FULL"]);
const reason = z.string().trim().max(300).optional();

export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export const startOwnSchema = z.object({ date: isoDate, slot });
export const markSchema = z.object({ employeeId: id, positionId: id, date: isoDate, slot, reason });
export const unmarkSchema = z.object({ id, reason });
export const periodSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((p) => p.from <= p.to, "Начало периода позже конца")
  .refine((p) => daysBetweenIso(p.from, p.to) < 366, "Период не длиннее 366 дней");

export const positionSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1, "Название обязательно").max(60),
    slots: z.array(slot).min(1, "Хотя бы одна смена").max(3),
    requiredSlots: z.array(slot).max(3),
    sortOrder: z.number().int().min(-1000).max(1000),
    isActive: z.boolean(),
  })
  .refine((p) => p.requiredSlots.every((s) => p.slots.includes(s)), "Обязательной может быть только смена должности");

export const employeeSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Имя обязательно").max(80),
  shortName: z.string().trim().max(20).nullable().optional(),
  positionId: id,
  userId: id.nullable().optional(),
  shiftRate: z.number().int().min(0).max(1_000_000).nullable().optional(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(-1000).max(1000),
  note: z.string().trim().max(300).nullable().optional(),
});

export const quickAddSchema = z.object({ name: z.string().trim().min(2, "Имя слишком короткое").max(80), positionId: id });

export type MarkInput = z.infer<typeof markSchema>;
export type PositionInput = z.infer<typeof positionSchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;
