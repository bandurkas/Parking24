// Правила автоподтверждения заявок с сайта (МФ-1) — чистые, без базы.

export type AutoDecision =
  | { status: "AWAITING_PAYMENT"; reason: "auto" }
  | { status: "REJECTED"; reason: "no_space"; peak: number; limit: number }
  | { status: "NEW"; reason: "no_reject_message"; peak: number; limit: number }
  | { status: "NEW"; reason: "manual" | "off" | "truck" | "no_phone" | "no_price" | "overload" };

export const DECISION_OFF: AutoDecision = { status: "NEW", reason: "off" };
export const DECISION_OVERLOAD: AutoDecision = { status: "NEW", reason: "overload" };

export type LeadFacts = { autoConfirm: boolean; vehicleType: string | null; phone: string | null; amount: number };

// Решение без проверки мест; null — заявку можно решать по занятости
export function preDecision(f: LeadFacts): AutoDecision | null {
  if (!f.autoConfirm) return { status: "NEW", reason: "off" };
  if (f.vehicleType === "TRUCK") return { status: "NEW", reason: "truck" };
  if (!f.vehicleType) return { status: "NEW", reason: "manual" };
  if (!f.phone) return { status: "NEW", reason: "no_phone" };
  if (!(f.amount > 0)) return { status: "NEW", reason: "no_price" };
  return null;
}

// Мест нет: отказ только если клиенту есть чем его отправить, иначе заявка остаётся администратору
export function noSpaceDecision(peak: number, limit: number, canReject: boolean): AutoDecision {
  return canReject ? { status: "REJECTED", reason: "no_space", peak, limit } : { status: "NEW", reason: "no_reject_message", peak, limit };
}

export function decisionComment(d: AutoDecision): string {
  switch (d.reason) {
    case "auto":
      return "Место подтверждено автоматически: на выбранные даты есть свободные места";
    case "no_space":
      return `Автоотклонение: на выбранные даты нет мест (занято ${d.peak}, порог ${d.limit})`;
    case "no_reject_message":
      return `Мест нет (занято ${d.peak}, порог ${d.limit}), отказ клиенту отправить нечем — решает администратор`;
    case "truck":
      return "Грузовой транспорт — цена и место подтверждает администратор";
    case "no_phone":
      return "Телефон не распознан — автоподтверждение невозможно";
    case "no_price":
      return "Стоимость не рассчитана (тариф не найден) — подтверждает администратор";
    case "overload":
      return "Автоподтверждение не сработало (перегрузка) — проверьте места вручную";
    default:
      return "";
  }
}

export function rejectNoticeText(number: number, range: string, peak: number, limit: number): string {
  return `Заявка №${number} отклонена автоматически: на ${range} мест нет (занято ${peak}, порог ${limit})`;
}

// Ключ дедупликации уведомления (AdminNotice.dedupKey, Ф2б)
export function rejectNoticeKey(bookingId: string): string {
  return `reject-no-space:${bookingId}`;
}

// Пул занят, транзакция закрыта по времени, конфликт записи — один повтор без автоматики поможет.
// «Базы нет» (P1001, P1002, P1017) не повторяем: второй заход упадёт так же.
const TRANSIENT = new Set(["P2024", "P2028", "P2034"]);

export function isTransientDbError(e: unknown): boolean {
  const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : null;
  return typeof code === "string" && TRANSIENT.has(code);
}

// Заявка важнее автоматики: при временной ошибке — ровно один повтор с overload = true; остальные ошибки — наверх
export async function withOverloadFallback<T>(run: (overload: boolean) => Promise<T>, onFallback?: (e: unknown) => void): Promise<T> {
  try {
    return await run(false);
  } catch (e) {
    if (!isTransientDbError(e)) throw e;
    onFallback?.(e);
    return run(true);
  }
}
