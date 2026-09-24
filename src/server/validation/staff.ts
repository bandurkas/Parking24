import { z } from "zod";
import { daysBetweenIso, toDate, toIso } from "@/server/lib/dates";

const id = z.string().min(1).max(40);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => toIso(toDate(s)) === s, "Нет такой даты");
const slot = z.enum(["DAY", "NIGHT", "FULL"]);

export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export const startOwnSchema = z.object({ date: isoDate, slot });
export const markSchema = z.object({ employeeId: id, positionId: id, date: isoDate, slot });
export const unmarkSchema = z.object({ id });
export const periodSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((p) => p.from <= p.to, "Начало периода позже конца")
  .refine((p) => daysBetweenIso(p.from, p.to) < 366, "Период не длиннее 366 дней");

export const positionSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Название обязательно").max(60),
  slots: z.array(slot).min(1, "Хотя бы одна смена").max(3),
  isActive: z.boolean(),
});

export const employeeSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Имя обязательно").max(80),
  positionId: id,
  userId: id.nullable().optional(),
  isActive: z.boolean(),
});

export type MarkInput = z.infer<typeof markSchema>;
export type PositionInput = z.infer<typeof positionSchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;
