import "server-only";
import { prisma } from "@/server/db/prisma";
import { audit } from "./audit";
import { LONG_TERM, VEHICLE_TYPES } from "@/lib/tariffs";
import { ROOMS } from "@/lib/rooms";
import { tariffDisableError, validateTariffPrice, validateTitle } from "@/lib/settings-validate";

export type TariffView = {
  id: string;
  code: string;
  kind: "PARKING" | "ROOM";
  label: string;
  unit: string;
  minDays: number | null;
  price: number;
  isActive: boolean;
  sitePrice: number | null; // сколько показывает сайт (цены сайта пока в коде, Р12); 0 — «по запросу»
  version: string;
};

// Цена на сайте для строки CRM: парковка — src/lib/tariffs.ts, комнаты — src/lib/rooms.ts
function sitePrice(t: { kind: string; code: string; vehicleType: string | null; minDays: number | null; roomType: string | null; unit: string }): number | null {
  if (t.kind === "PARKING") {
    if (t.vehicleType === "TRUCK") return 0; // на сайте грузовые «по запросу»
    if (t.vehicleType === "CAR" && (t.minDays ?? 0) >= LONG_TERM.minDays) return LONG_TERM.perDay;
    return VEHICLE_TYPES.find((v) => v.id === t.vehicleType?.toLowerCase())?.perDay ?? null;
  }
  const room = ROOMS.find((r) => r.id === t.roomType);
  if (!room) return null;
  return t.unit === "12h" ? room.price12 : t.unit === "24h" ? room.price24 : null;
}

export async function tariffsForSettings(): Promise<TariffView[]> {
  const rows = await prisma.tariff.findMany({ where: { kind: { in: ["PARKING", "ROOM"] } }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] });
  return rows.map((t) => ({
    id: t.id,
    code: t.code,
    kind: t.kind as "PARKING" | "ROOM",
    label: t.label,
    unit: t.unit,
    minDays: t.minDays,
    price: t.price,
    isActive: t.isActive,
    sitePrice: sitePrice(t),
    version: t.updatedAt.toISOString(),
  }));
}

type Result = { ok: true } | { ok: false; error: string };

// Меняются только название, цена и «действует». Новые брони считаются по новой цене; уже созданные не пересчитываются
export async function saveTariff(actorId: string, id: string, input: { label: string; price: number; isActive: boolean; version: string }): Promise<Result> {
  const label = validateTitle(input.label, "Название", 80);
  if (!label.ok) return label;
  const row = await prisma.tariff.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Тариф не найден" };
  if (row.updatedAt.toISOString() !== input.version) return { ok: false, error: "Тариф изменили в другом окне — обновите страницу" };
  const price = validateTariffPrice(Number(input.price), row);
  if (!price.ok) return price;
  if (row.isActive && !input.isActive) {
    const all = await prisma.tariff.findMany({ where: { kind: row.kind } });
    const err = tariffDisableError(row, all);
    if (err) return { ok: false, error: err };
  }
  if (row.label === label.value && row.price === price.value && row.isActive === input.isActive) return { ok: true };
  const res = await prisma.tariff.updateMany({ where: { id, updatedAt: row.updatedAt }, data: { label: label.value, price: price.value, isActive: input.isActive } });
  if (res.count === 0) return { ok: false, error: "Тариф изменили в другом окне — обновите страницу" };
  await audit(actorId, "UPDATE", "Tariff", id, {
    code: row.code,
    before: { label: row.label, price: row.price, isActive: row.isActive },
    after: { label: label.value, price: price.value, isActive: input.isActive },
  });
  return { ok: true };
}
