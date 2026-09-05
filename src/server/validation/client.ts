import { z } from "zod";

const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const updateClientSchema = z.object({
  clientId: z.string().min(1),
  name: opt(120),
  status: z.enum(["LEAD", "ACTIVE", "VIP", "LOST", "BLOCKED"]),
  email: z.string().trim().max(120).email("Некорректный email").optional().or(z.literal("")),
  messenger: z.enum(["PHONE", "WHATSAPP", "TELEGRAM", "MAX", "SMS", "EMAIL", "SITE"]).optional().or(z.literal("")),
  telegram: opt(64),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД").optional().or(z.literal("")),
  company: opt(160),
  inn: z.string().trim().regex(/^\d{10}(\d{2})?$/, "ИНН — 10 или 12 цифр").optional().or(z.literal("")),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  note: opt(2000),
});
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const vehicleSchema = z.object({
  clientId: z.string().min(1),
  plate: z.string().trim().min(4, "Госномер слишком короткий").max(12),
  type: z.enum(["CAR", "SUV", "MOTO", "TRUCK"]),
  model: opt(80),
});

export const consentSchema = z.object({
  clientId: z.string().min(1),
  kind: z.enum(["personal", "marketing", "dnd"]),
  on: z.boolean(),
});
