import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_CRON_SECRET = 16;

// sha256 уравнивает длину: timingSafeEqual падает на разных длинах, а проверка длины до сравнения выдала бы длину секрета
export function cronSecretOk(given: string | null | undefined, want: string | undefined): boolean {
  if (!want || want.length < MIN_CRON_SECRET) return false;
  const a = createHash("sha256").update(given ?? "").digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}
