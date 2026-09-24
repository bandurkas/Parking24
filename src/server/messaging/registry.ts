import "server-only";
import type { Prisma } from "@prisma/client";
import { MESSAGING_KEYS } from "@/server/automations/sender-core";
import type { MessengerAdapter } from "./types";
import { fakeAdapter, parseFakeMode } from "./fake";
import { wazzupAdapter } from "./wazzup/adapter";

type Rows = { key: string; value: unknown }[];

// Реестр провайдеров. Выбранный — Setting messaging.provider (по умолчанию "none"); провайдер без ключа
// считается отсутствующим
type ProviderDef = { code: string; label: string; available: () => boolean; make: (get: (key: string) => unknown) => MessengerAdapter };

const PROVIDERS: ProviderDef[] = [
  // На бою (NODE_ENV=production) заглушки нет вовсе: выбрать её нельзя, сохранённое значение не действует
  { code: "fake", label: "Заглушка (только разработка)", available: () => process.env.NODE_ENV !== "production", make: (get) => fakeAdapter(parseFakeMode(get(MESSAGING_KEYS.fakeMode))) },
  { code: "wazzup", label: "Wazzup", available: () => !!process.env.WAZZUP_API_KEY, make: () => wazzupAdapter },
];

export const NO_PROVIDER = { code: "none", label: "Не подключён" } as const;

export const PROVIDER_SETTING_KEYS = [MESSAGING_KEYS.provider, MESSAGING_KEYS.fakeMode];

export function providerOptions(): { code: string; label: string }[] {
  return [NO_PROVIDER, ...PROVIDERS.filter((p) => p.available()).map(({ code, label }) => ({ code, label }))];
}

export function providerCode(rows: Rows): string {
  const v = rows.find((r) => r.key === MESSAGING_KEYS.provider)?.value;
  return typeof v === "string" ? v : NO_PROVIDER.code;
}

// Из уже прочитанных строк Setting: отправщик читает свои ключи и ключи провайдера одним запросом
export function adapterFrom(rows: Rows): MessengerAdapter | null {
  const def = PROVIDERS.find((p) => p.code === providerCode(rows));
  if (!def || !def.available()) return null;
  return def.make((key) => rows.find((r) => r.key === key)?.value);
}

export async function activeAdapter(db: Pick<Prisma.TransactionClient, "setting">): Promise<MessengerAdapter | null> {
  return adapterFrom(await db.setting.findMany({ where: { key: { in: PROVIDER_SETTING_KEYS } } }));
}
