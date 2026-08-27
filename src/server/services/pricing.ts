import "server-only";
import type { ResourceKind, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

export async function quote(kind: ResourceKind, days: number, opts: { vehicleType?: VehicleType | null; roomType?: string | null }): Promise<{ amount: number; perDay: number; tariffCode: string | null }> {
  if (days <= 0) return { amount: 0, perDay: 0, tariffCode: null };
  const tariffs = await prisma.tariff.findMany({ where: { kind, isActive: true }, orderBy: { sortOrder: "asc" } });
  if (kind === "PARKING") {
    const t = tariffs
      .filter((t) => t.vehicleType === opts.vehicleType && (t.minDays ?? 0) <= days)
      .sort((a, b) => (b.minDays ?? 0) - (a.minDays ?? 0))[0];
    if (!t) return { amount: 0, perDay: 0, tariffCode: null };
    return { amount: days * t.price, perDay: t.price, tariffCode: t.code };
  }
  const t = tariffs.find((t) => t.roomType === opts.roomType && t.unit === "24h");
  if (!t) return { amount: 0, perDay: 0, tariffCode: null };
  return { amount: days * t.price, perDay: t.price, tariffCode: t.code };
}
