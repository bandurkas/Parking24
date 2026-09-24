// Контракт отправщика (Ф4ш0) и адаптеров провайдеров (Ф14, docs/phases/MAP_DEPENDENCIES.md §2 п.14).
// Файл создают обе фазы; при слиянии берётся версия Ф4ш0, если совпадает по форме.
import type { Channel } from "@prisma/client";

export type SendRequest = {
  outboxId: string; // уходит провайдеру ключом идемпотентности (crmMessageId у Wazzup)
  channel: Channel;
  phone: string; // E.164: "+79991234567"
  text: string;
};

// retry: true — оставить PENDING и прийти позже; false — FAILED, больше не пробовать
export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retry: boolean; code: string; message: string };

export type AdapterHealth = { ok: boolean; message: string };

export interface MessengerAdapter {
  readonly code: string;
  send(req: SendRequest): Promise<SendResult>;
  availableChannels(): Promise<Channel[]>;
  check(): Promise<AdapterHealth>;
}
