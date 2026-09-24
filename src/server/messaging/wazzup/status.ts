import "server-only";
import { fmtDateTime } from "@/server/lib/dates";
import { dialogLimit, dialogsThisMonth } from "@/server/services/dialogs";
import { chatsEnabled, hasKey, providerSetting, readSetting, webhookUrl, WZ_KEYS } from "./config";
import { readSnapshot } from "./channels";
import { stateLabel, transportName } from "./rules";

// Строка к сообщению в карточке брони и клиента: «доставлено / прочитано / не доставлено», время по Москве
export function deliveryLabel(o: { deliveredAt: Date | null; readAt: Date | null; failCode: string | null }): { text: string; bad: boolean } | null {
  if (o.readAt) return { text: `прочитано ${fmtDateTime(o.readAt)}`, bad: false };
  if (o.deliveredAt) return { text: `доставлено ${fmtDateTime(o.deliveredAt)}`, bad: false };
  if (o.failCode) return { text: `не доставлено (${o.failCode})`, bad: true };
  return null;
}

export type MessagingOverview = {
  keyPresent: boolean;
  providerOn: boolean;
  chatsOn: boolean;
  webhook: { ok: boolean; message: string };
  setupAt: string | null;
  webhookAt: string | null;
  checkedAt: string | null;
  channels: { id: string; name: string; number: string | null; state: string; ok: boolean }[];
  dialogs: { count: number; limit: number };
};

// Данные карточки «Сообщения» в настройках владельца. Без сетевых вызовов: только база и .env
export async function messagingOverview(): Promise<MessagingOverview> {
  const [provider, chatsOn, snap, setup, dialogs, limit] = await Promise.all([
    providerSetting(),
    chatsEnabled(),
    readSnapshot(),
    readSetting(WZ_KEYS.setup),
    dialogsThisMonth(true),
    dialogLimit(),
  ]);
  const w = webhookUrl();
  const s = setup && typeof setup === "object" ? (setup as { at?: string; webhookAt?: string }) : {};
  const at = (v?: string) => (v ? fmtDateTime(new Date(v)) : null);
  return {
    keyPresent: hasKey(),
    providerOn: provider === "wazzup",
    chatsOn,
    webhook: w.ok ? { ok: true, message: "адрес вебхука задан" } : { ok: false, message: w.message },
    setupAt: at(s.at),
    webhookAt: at(s.webhookAt),
    checkedAt: at(snap?.at),
    channels: (snap?.list ?? []).map((c) => ({
      id: c.channelId,
      name: transportName(c.transport),
      number: c.plainId ? `…${c.plainId.slice(-4)}` : null,
      state: stateLabel(c.state),
      ok: c.state === "active",
    })),
    dialogs: { count: dialogs.count, limit },
  };
}
