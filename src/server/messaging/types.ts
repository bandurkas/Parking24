// Контракт отправщика (Ф4 шаг 0) и адаптера провайдера (Ф14: Wazzup). Отправщик не знает ни одного кода провайдера:
// адаптер сам решает «повторить или нет», отправщик — когда и сколько раз.
import type { Channel } from "@prisma/client";

export type SendRequest = {
  outboxId: string; // провайдеру — ключ идемпотентности (crmMessageId у Wazzup)
  channel: Channel; // WHATSAPP | TELEGRAM | MAX
  phone: string; // E.164: «+79991234567»
  text: string;
};

// retry: true — только если запрос заведомо не дошёл до провайдера (нет соединения, DNS, отказ до приёма, 429, 5xx).
// Запрос ушёл, а ответа нет (таймаут, обрыв после отправки) — { ok: false, retry: false, code: "UNKNOWN", … }:
// отправщик ставит «статус отправки неизвестен» и не повторяет — иначе клиент может получить сообщение дважды.
// Исключение из send и превышение таймаута отправщика трактуются так же
export type SendResult =
  | { ok: true; providerMessageId: string | null }
  // message — короткая строка для Outbox.lastError: без тела ответа и без ключа
  // uncertain (Ф14) — исход неизвестен (таймаут, обрыв, 5xx у Wazzup): отправщик ведёт как UNKNOWN, без повтора
  | { ok: false; retry: boolean; code: string; message: string; uncertain?: boolean };

export type AdapterHealth = { ok: boolean; message: string };

// send вызывается вне транзакции базы; адаптер сам не повторяет и не спит.
// signal — таймаут отправщика; адаптер, который его не слушает, всё равно будет прерван по времени
export interface MessengerAdapter {
  readonly code: string;
  send(req: SendRequest, signal?: AbortSignal): Promise<SendResult>;
  availableChannels(): Promise<Channel[]>;
  check(): Promise<AdapterHealth>;
  // предел длины текста по каналу (у Wazzup: Telegram 1 024, MAX 4 096, WhatsApp 10 000); нет метода — без предела
  textLimit?(channel: Channel): number | null;
}
