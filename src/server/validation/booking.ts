import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");
const time = z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal(""));

export const createBookingSchema = z
  .object({
    kind: z.enum(["PARKING", "ROOM"]).default("PARKING"),
    phone: z.string().trim().min(6, "Телефон обязателен").max(30),
    name: z.string().trim().max(120).optional().or(z.literal("")),
    dateFrom: isoDate,
    dateTo: isoDate,
    timeFrom: time,
    timeTo: time,
    vehicleType: z.enum(["CAR", "SUV", "MOTO", "TRUCK"]).optional(),
    plate: z.string().trim().max(12).optional().or(z.literal("")),
    roomType: z.string().trim().max(40).optional().or(z.literal("")),
    transferNeeded: z.coerce.boolean().default(false),
    source: z.enum(["SITE", "CALL", "WHATSAPP", "TELEGRAM", "TWO_GIS", "INSTAGRAM", "ADS", "BUSINESS_CARD", "REFERRAL", "OTHER"]).default("CALL"),
    amount: z.coerce.number().int().min(0).optional(),
    comment: z.string().trim().max(1000).optional().or(z.literal("")),
    status: z.enum(["NEW", "AWAITING_PAYMENT", "CONFIRMED"]).default("NEW"),
  })
  .refine((v) => v.dateTo > v.dateFrom, { message: "Выезд должен быть позже заезда", path: ["dateTo"] })
  .refine((v) => v.kind !== "PARKING" || !!v.vehicleType, { message: "Укажите тип ТС", path: ["vehicleType"] });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const leadSchema = z.object({
  dateFrom: isoDate,
  dateTo: isoDate,
  vehicleType: z.enum(["car", "suv", "moto", "truck"]),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  dial: z.string().trim().max(6).optional(),
  utm: z.record(z.string(), z.string().max(200)).optional(),
  website: z.string().max(0).optional(),
  ts: z.coerce.number().optional(),
});

export const paymentSchema = z.object({
  bookingId: z.string().min(1),
  kind: z.enum(["PAYMENT", "REFUND"]).default("PAYMENT"),
  method: z.enum(["CASH", "CARD_TERMINAL", "TRANSFER", "ONLINE"]),
  amount: z.coerce.number().int().positive("Сумма должна быть больше 0"),
  note: z.string().trim().max(300).optional().or(z.literal("")),
});

export const updateBookingSchema = z.object({
  bookingId: z.string().min(1),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  plate: z.string().trim().max(12).optional().or(z.literal("")),
  vehicleType: z.enum(["CAR", "SUV", "MOTO", "TRUCK"]).optional(),
  dateFrom: isoDate,
  dateTo: isoDate,
  timeFrom: time,
  timeTo: time,
  amount: z.coerce.number().int().min(0),
  transferNeeded: z.coerce.boolean().default(false),
  source: z.enum(["SITE", "CALL", "WHATSAPP", "TELEGRAM", "TWO_GIS", "INSTAGRAM", "ADS", "BUSINESS_CARD", "REFERRAL", "OTHER"]),
  comment: z.string().trim().max(1000).optional().or(z.literal("")),
  resourceId: z.string().optional().or(z.literal("")),
}).refine((v) => v.dateTo > v.dateFrom, { message: "Выезд должен быть позже заезда", path: ["dateTo"] });
