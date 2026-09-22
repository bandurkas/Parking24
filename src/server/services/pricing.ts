import "server-only";
import type { Prisma, ResourceKind, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { pickTariff, type TariffRow } from "@/lib/overstay";

export async function quote(kind: ResourceKind, days: number, opts: { vehicleType?: VehicleType | null; roomType?: string | null }): Promise<{ amount: number; perDay: number; tariffCode: string | null }> {
  if (days <= 0) return { amount: 0, perDay: 0, tariffCode: null };
  const tariffs = await prisma.tariff.findMany({ where: { kind, isActive: true }, orderBy: { sortOrder: "asc" } });
  if (kind === "PARKING") {
    const t = pickTariff(tariffs, opts.vehicleType, days);
    if (!t) return { amount: 0, perDay: 0, tariffCode: null };
    return { amount: days * t.price, perDay: t.price, tariffCode: t.code };
  }
  const t = tariffs.find((t) => t.roomType === opts.roomType && t.unit === "24h");
  if (!t) return { amount: 0, perDay: 0, tariffCode: null };
  return { amount: days * t.price, perDay: t.price, tariffCode: t.code };
}

// Активные тарифы парковки для расчёта долга за перестой: страница читает их один раз на все строки
export async function parkingTariffs(db: Pick<Prisma.TransactionClient, "tariff"> = prisma): Promise<TariffRow[]> {
  return db.tariff.findMany({ where: { kind: "PARKING", isActive: true }, select: { vehicleType: true, price: true, minDays: true } });
}
