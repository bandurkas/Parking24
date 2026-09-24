// Коды и подписи сканов минутного тика. Без Prisma и без server-only: читают карточка «Планировщик»,
// setScanModeAction и юнит-тесты. Новый скан — строка здесь плюс объект с тем же кодом в SCANS (scheduler.ts).
export const SCAN_REGISTRY = [
  { code: "overstay", label: "Перестой: уведомление администратору" },
] as const satisfies readonly { code: string; label: string }[];

export type ScanCode = (typeof SCAN_REGISTRY)[number]["code"];

export function isScanCode(code: unknown): code is ScanCode {
  return SCAN_REGISTRY.some((s) => s.code === code);
}
