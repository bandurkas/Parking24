import "server-only";
import { overstayDayIso, toIso, todayIso } from "@/server/lib/dates";
import { overstayDebt, type Overstay, type TariffRow } from "@/lib/overstay";
import { parkingTariffs } from "./pricing";

// Контекст для страниц: «сегодня» по Москве, сутки перестоя (с льготным часом) и тарифы парковки — один раз на все строки
export type OverstayCtx = { today: string; day: string; tariffs: TariffRow[] };

export async function overstayCtx(): Promise<OverstayCtx> {
  return { today: todayIso(), day: overstayDayIso(), tariffs: await parkingTariffs() };
}

type Row = { kind: string; status: string; dateTo: Date; vehicleType: string | null; days: number; amount: number; paidAmount: number };

export function overstayOf(b: Row, ctx: OverstayCtx): Overstay | null {
  return overstayDebt({ ...b, dateTo: toIso(b.dateTo) }, ctx.day, ctx.tariffs);
}
