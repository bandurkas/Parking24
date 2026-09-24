// Раскладка ответов Wazzup на «повторять / не повторять» (PHASE_14 §7, docs/WAZZUP_INTEGRATION.md §2).
// Чистый модуль: без базы и сети, под юнит-тестами.

export type ApiFailure =
  | { kind: "http"; status: number; code: string | null }
  | { kind: "timeout" }
  | { kind: "network" };

// notice — только то, о чём отправщик знать не может (тариф, спам, ключ). «Позвоните клиенту» (MESSAGE_FAILED)
// по окончательной ошибке ставит Ф4 — второго уведомления адаптер не создаёт
export type FailRule = {
  retry: boolean;
  code: string;
  message: string;
  notice: { key: string; text: string } | null;
  dropChannelCache: boolean;
  // исход неизвестен: запрос мог дойти, повтор позже окна crmMessageId (60 с) рискует дублем у клиента
  uncertain: boolean;
};

const KNOWN: Record<string, Omit<FailRule, "code" | "uncertain">> = {
  BAD_CONTACT: { retry: false, message: "номера нет в мессенджере — позвоните клиенту", notice: null, dropChannelCache: false },
  INVALID_MESSAGE_DATA: { retry: false, message: "Wazzup не принял номер или текст сообщения", notice: null, dropChannelCache: false },
  MESSAGE_TEXT_TOO_LONG: { retry: false, message: "сообщение длиннее лимита мессенджера", notice: null, dropChannelCache: false },
  MESSAGES_NOT_TEXT_FIRST: {
    retry: false,
    message: "тариф Wazzup не позволяет писать клиенту первым",
    notice: { key: "tariff:not-text-first", text: "Wazzup не даёт писать клиентам первыми: нужен тариф Pro или Max. Сообщения клиентам не уходят." },
    dropChannelCache: false,
  },
  MESSAGES_IS_SPAM: {
    retry: false,
    message: "WhatsApp счёл сообщение спамом",
    notice: { key: "tariff:spam", text: "WhatsApp счёл сообщение клиенту спамом и не доставил его. Проверьте текст шаблона и канал в кабинете Wazzup." },
    dropChannelCache: false,
  },
  BALANCE_IS_EMPTY: {
    retry: false,
    message: "в Wazzup закончился баланс канала",
    notice: { key: "tariff:balance", text: "В Wazzup закончился баланс канала WhatsApp Business. Сообщения клиентам не уходят." },
    dropChannelCache: false,
  },
  CHANNEL_NOT_FOUND: { retry: true, message: "канал Wazzup не найден или отключён", notice: null, dropChannelCache: true },
  CHANNEL_BLOCKED: { retry: true, message: "канал Wazzup заблокирован", notice: null, dropChannelCache: true },
  WRONG_TRANSPORT: { retry: true, message: "канал Wazzup сменился, список каналов перечитан", notice: null, dropChannelCache: true },
};

export function classify(f: ApiFailure): FailRule {
  if (f.kind === "timeout") return { retry: true, code: "TIMEOUT", message: "Wazzup не ответил вовремя", notice: null, dropChannelCache: false, uncertain: true };
  if (f.kind === "network") return { retry: true, code: "NETWORK", message: "нет связи с Wazzup", notice: null, dropChannelCache: false, uncertain: true };
  const code = f.code ?? `HTTP_${f.status}`;
  const known = f.code ? KNOWN[f.code] : undefined;
  if (known) return { ...known, code, uncertain: false };
  if (f.status === 429) return { retry: true, code, message: "Wazzup просит подождать (частота запросов)", notice: null, dropChannelCache: false, uncertain: false };
  if (f.status >= 500) return { retry: true, code, message: "сбой на стороне Wazzup", notice: null, dropChannelCache: false, uncertain: true };
  if (f.status === 401)
    return {
      retry: true,
      code,
      message: "Wazzup не принял ключ API",
      notice: { key: "tariff:unauthorized", text: "Wazzup не принимает ключ API: проверьте WAZZUP_API_KEY на сервере. Сообщения клиентам не уходят." },
      dropChannelCache: true,
      uncertain: false,
    };
  return {
    retry: false,
    code,
    message: `Wazzup отказал (${code})`,
    notice: { key: `tariff:${code}`, text: `Wazzup отказал в отправке сообщения клиенту с кодом ${code}. Сообщение не ушло, код передайте разработчику.` },
    dropChannelCache: false,
    uncertain: false,
  };
}
