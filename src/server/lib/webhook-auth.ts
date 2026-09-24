import { cronSecretOk } from "./cron-auth";

// Секрет вебхука Wazzup живёт в адресе (/api/webhooks/wazzup/<секрет>): штатной авторизации у Wazzup не выяснено
export const MIN_WEBHOOK_SECRET = 32;

export function webhookSecretOk(given: string | null | undefined, want: string | undefined): boolean {
  return cronSecretOk(given, want, MIN_WEBHOOK_SECRET);
}
