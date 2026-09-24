// Контракт отправщика (Ф4ш0) и адаптеров провайдеров (Ф14, docs/phases/MAP_DEPENDENCIES.md §2 п.14).
// Файл создают обе фазы; при слиянии берётся версия Ф4ш0, если совпадает по форме.
import type { Channel } from "@prisma/client";

export type SendRequest = {
  outboxId: string; // уходит провайдеру ключом идемпотентности (crmMessageId у Wazzup)
  channel: Channel;
  phone: string; // E.164: "+79991234567"
  text: string;
};

// retry: true — оставить PENDING и прийти позже; false — FAILED, больше не пробовать.
// uncertain — единственное добавление Ф14 к контракту карты (необязательное): исход неизвестен (таймаут, обрыв, 5xx),
// сообщение могло уйти, а защита crmMessageId у Wazzup живёт 60 с — повтор позже может задвоить сообщение клиенту
export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retry: boolean; code: string; message: string; uncertain?: boolean };

export type AdapterHealth = { ok: boolean; message: string };

export interface MessengerAdapter {
  readonly code: string;
  send(req: SendRequest): Promise<SendResult>;
  availableChannels(): Promise<Channel[]>;
  check(): Promise<AdapterHealth>;
}
