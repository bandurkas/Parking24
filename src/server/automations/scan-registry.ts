// Коды и подписи сканов минутного тика. Без Prisma и без server-only: читают карточка «Планировщик»,
// setScanModeAction и юнит-тесты. Новый скан — строка здесь плюс объект в SCANS (scheduler.ts) с кодом `"…" satisfies ScanCode`.
// Шаг тика с режимом в той же карте scheduler.scans (отправщик Ф4, код sender) — тоже строкой здесь:
// иначе setScanModeAction его отклонит; строка появится и в карточке «Планировщик».
export const SCAN_REGISTRY = [
  { code: "overstay", label: "Перестой: уведомление администратору" },
] as const satisfies readonly { code: string; label: string }[];

export type ScanCode = (typeof SCAN_REGISTRY)[number]["code"];

export function isScanCode(code: unknown): code is ScanCode {
  return SCAN_REGISTRY.some((s) => s.code === code);
}
