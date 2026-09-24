import "server-only";
import type { Channel } from "@prisma/client";
import type { MessengerAdapter, SendRequest, SendResult } from "./types";

// Заглушка провайдера для разработки и e2e: сеть не трогает, пишет строку в лог сервера.
// Ответ задаёт Setting messaging.fakeMode — e2e переключает его без перезапуска сервера
export const FAKE_MODES = ["ok", "fail", "bad", "down"] as const;
export type FakeMode = (typeof FAKE_MODES)[number];

export function parseFakeMode(v: unknown): FakeMode {
  return FAKE_MODES.includes(v as FakeMode) ? (v as FakeMode) : "ok";
}

// Счётчик вызовов на запись: номер вызова уходит в providerMessageId, по нему e2e видит двойную отправку.
// globalThis — модуль в процессе загружается дважды (как scheduler.ts)
function calls(): Map<string, number> {
  const root = globalThis as typeof globalThis & { __p24FakeSends?: Map<string, number> };
  root.__p24FakeSends ??= new Map();
  return root.__p24FakeSends;
}

const CHANNELS: Channel[] = ["WHATSAPP", "TELEGRAM", "MAX"];

export function fakeAdapter(mode: FakeMode): MessengerAdapter {
  return {
    code: "fake",
    async send(req: SendRequest): Promise<SendResult> {
      const n = (calls().get(req.outboxId) ?? 0) + 1;
      calls().set(req.outboxId, n);
      console.log(`[sender:fake] ${mode} → ${req.channel} ${req.phone} · ${req.outboxId} · вызов ${n} · ${req.text.slice(0, 60).replace(/\s+/g, " ")}`);
      if (mode === "fail" || mode === "down") return { ok: false, retry: true, code: "FAKE_NETWORK", message: "заглушка: сбой сети" };
      if (mode === "bad") return { ok: false, retry: false, code: "FAKE_BAD_CONTACT", message: "заглушка: номера нет в мессенджере" };
      return { ok: true, providerMessageId: `fake-${req.outboxId}-${n}` };
    },
    async availableChannels() {
      return mode === "down" ? [] : CHANNELS;
    },
    async check() {
      return mode === "down" ? { ok: false, message: "заглушка: канал недоступен" } : { ok: true, message: `заглушка: ${mode}` };
    },
    textLimit(channel) {
      return channel === "TELEGRAM" ? 1024 : channel === "MAX" ? 4096 : 10_000;
    },
  };
}
