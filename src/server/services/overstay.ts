import "server-only";
import { toIso, todayIso } from "@/server/lib/dates";
import { overstayDebt, type Overstay, type TariffRow } from "@/lib/overstay";
import { parkingTariffs } from "./pricing";

// Контекст для страниц: «сегодня» по Москве и тарифы парковки — один раз на все строки
export type OverstayCtx = { today: string; tariffs: TariffRow[] };

export async function overstayCtx(): Promise<OverstayCtx> {
  return { today: todayIso(), tariffs: await parkingTariffs() };
}

type Row = { kind: string; status: string; dateTo: Date; vehicleType: string | null; days: number; amount: number; paidAmount: number };

export function overstayOf(b: Row, ctx: OverstayCtx): Overstay | null {
  return overstayDebt({ ...b, dateTo: toIso(b.dateTo) }, ctx.today, ctx.tariffs);
}
