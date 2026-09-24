import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_CRON_SECRET = 16;

// sha256 уравнивает длину: timingSafeEqual падает на разных длинах, а проверка длины до сравнения выдала бы длину секрета
// min — нижняя граница длины секрета: у вебхука Wazzup своя (webhook-auth.ts), реализация одна
export function cronSecretOk(given: string | null | undefined, want: string | undefined, min = MIN_CRON_SECRET): boolean {
  if (!want || want.length < min) return false;
  const a = createHash("sha256").update(given ?? "").digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}
