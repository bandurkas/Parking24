import "server-only";
import { fmtDateTime } from "@/server/lib/dates";
import { dialogLimit, dialogsThisMonth } from "@/server/services/dialogs";
import { chatsEnabled, hasKey, providerSetting, webhookUrl } from "./config";
import { readSnapshot } from "./channels";
import { webhookMark } from "./setup";
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
  webhookAt: string | null; // только если зарегистрирован для текущего ключа и адреса
  webhookStale: boolean; // регистрация была, но для другого ключа или адреса
  checkedAt: string | null;
  channels: { id: string; name: string; number: string | null; state: string; ok: boolean }[];
  dialogs: { count: number; limit: number };
};

// Данные карточки «Сообщения» в настройках владельца. Без сетевых вызовов: только база и .env
export async function messagingOverview(): Promise<MessagingOverview> {
  const [provider, chatsOn, snap, hook, dialogs, limit] = await Promise.all([
    providerSetting(),
    chatsEnabled(),
    readSnapshot(),
    webhookMark(),
    dialogsThisMonth(true),
    dialogLimit(),
  ]);
  const w = webhookUrl();
  const at = (v?: string) => (v ? fmtDateTime(new Date(v)) : null);
  return {
    keyPresent: hasKey(),
    providerOn: provider === "wazzup",
    chatsOn,
    webhook: w.ok ? { ok: true, message: "адрес вебхука задан" } : { ok: false, message: w.message },
    webhookAt: hook.current ? at(hook.at ?? undefined) : null,
    webhookStale: !!hook.at && !hook.current,
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
