import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { BOOKED, noSpaceRows, type NoSpaceRow } from "@/lib/segments";

// Признак сегмента «не смогли к нам попасть» — одно место (Ф8)
const NO_SPACE: Prisma.BookingWhereInput = { rejectKind: "NO_SPACE" };
const IN_SEGMENT: Prisma.ClientWhereInput = { bookings: { some: NO_SPACE } };

export async function noSpaceCount(): Promise<number> {
  return prisma.client.count({ where: IN_SEGMENT });
}

// Одной выборкой: отказы NO_SPACE и состоявшиеся брони клиента; правило — в @/lib/segments
export async function noSpaceSegment(): Promise<NoSpaceRow[]> {
  const clients = await prisma.client.findMany({
    where: IN_SEGMENT,
    select: {
      id: true,
      name: true,
      phone: true,
      messenger: true,
      doNotDisturb: true,
      bookings: {
        where: { OR: [NO_SPACE, { status: { in: BOOKED } }] },
        select: { id: true, number: true, status: true, rejectKind: true, rejectedAt: true, createdAt: true, dateFrom: true, dateTo: true },
      },
    },
  });
  return noSpaceRows(clients);
}
