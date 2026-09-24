import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePhone, normalizePlate } from "@/lib/phone";

export const bookingInclude = {
  client: { select: { id: true, name: true, phone: true, ltv: true, messenger: true, channels: true, telegram: true, _count: { select: { bookings: true } } } },
  vehicle: true,
  resource: true,
  // Автор операции и сторно — реквизиты ТЗ 5.3 в строке платежа
  payments: { orderBy: { paidAt: "desc" as const }, include: { createdBy: { select: { name: true } }, reversal: { include: { createdBy: { select: { name: true } } } } } },
  interactions: { orderBy: { occurredAt: "desc" as const }, include: { user: { select: { name: true } } } },
  outbox: { orderBy: { scheduledAt: "asc" as const } },
  createdBy: { select: { name: true } },
} satisfies Prisma.BookingInclude;

export type BookingFull = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export async function findByPhoneOrPlate(q: string) {
  const digits = q.replace(/\D/g, "");
  const num = /^\d{1,6}$/.test(q.trim()) ? Number(q.trim()) : null;
  return prisma.booking.findMany({
    where: {
      OR: [
        ...(num ? [{ number: num }] : []),
        ...(digits.length >= 4 ? [{ contactPhone: { contains: digits.slice(-Math.min(10, digits.length)) } }] : []),
        { plate: { contains: normalizePlate(q) } },
        { contactName: { contains: q, mode: "insensitive" as const } },
      ],
    },
    include: { client: { select: { name: true, phone: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}

export function normalizeContact(phone: string) {
  return normalizePhone(phone);
}
