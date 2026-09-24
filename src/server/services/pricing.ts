import "server-only";
import type { Prisma, ResourceKind, VehicleType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TariffRow } from "@/lib/overstay";
import { priceFor, type PriceTariff } from "@/lib/recalc";

// Активные тарифы вида ресурса в порядке sortOrder: при равных minDays все расчёты выберут один и тот же тариф
export async function activeTariffs(kind: ResourceKind, db: Pick<Prisma.TransactionClient, "tariff"> = prisma): Promise<PriceTariff[]> {
  return db.tariff.findMany({ where: { kind, isActive: true }, orderBy: { sortOrder: "asc" }, select: { vehicleType: true, roomType: true, unit: true, price: true, minDays: true, code: true } });
}

export async function quote(kind: ResourceKind, days: number, opts: { vehicleType?: VehicleType | null; roomType?: string | null }): Promise<{ amount: number; perDay: number; tariffCode: string | null }> {
  if (days <= 0) return { amount: 0, perDay: 0, tariffCode: null };
  return priceFor(await activeTariffs(kind), kind, days, opts);
}

// Активные тарифы парковки для расчёта долга за перестой: страница читает их один раз на все строки
export async function parkingTariffs(db: Pick<Prisma.TransactionClient, "tariff"> = prisma): Promise<TariffRow[]> {
  // порядок как в quote(): при равных minDays оба выберут один и тот же тариф
  return db.tariff.findMany({ where: { kind: "PARKING", isActive: true }, orderBy: { sortOrder: "asc" }, select: { vehicleType: true, price: true, minDays: true } });
}
