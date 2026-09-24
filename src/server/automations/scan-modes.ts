import "server-only";
import type { Prisma } from "@prisma/client";
import { SCHEDULER_KEYS, parseModes, withScanMode, type ScanMode } from "./tick-core";

// Запись режима одного скана в Setting "scheduler.scans" под блокировкой строки: ручное переключение,
// восстановление режима в e2e и самоотключение из тика (Ф4) не затирают друг друга.
// tx — транзакция вызывающего (основной клиент или клиент планировщика), основной prisma здесь не импортируется
export async function saveScanMode(tx: Prisma.TransactionClient, code: string, mode: ScanMode): Promise<ScanMode> {
  const key = SCHEDULER_KEYS.scans;
  await tx.$executeRaw`INSERT INTO "Setting" (key, value, "updatedAt") VALUES (${key}, '{}'::jsonb, now()) ON CONFLICT (key) DO NOTHING`;
  const [row] = await tx.$queryRaw<{ value: unknown }[]>`SELECT value FROM "Setting" WHERE key = ${key} FOR UPDATE`;
  const before = parseModes(row?.value)[code] ?? "off";
  await tx.setting.update({ where: { key }, data: { value: withScanMode(row?.value, code, mode) as Prisma.InputJsonValue } });
  return before;
}
