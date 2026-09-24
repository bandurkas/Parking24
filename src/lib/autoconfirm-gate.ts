// Предохранитель включения автоподтверждения (МФ-1) — чистый, без базы.
import { plural } from "./tariffs";

export type GateCheckId = "confirm_message" | "reject_message" | "sender";
export type GateCheck = { id: GateCheckId; ok: boolean; title: string; hint: string };
export type GateFacts = { confirmRule: boolean; rejectRule: boolean; senderEnabled: boolean };
export type GateRule = { triggerParams: unknown; kind: string | null; templateActive: boolean };

type Params = { status?: unknown; source?: unknown; rejectKind?: unknown };

// Сработает ли правило на заявку с сайта в этом статусе — по тем же условиям, что диспетчер.
// Отказ: правило без rejectKind или именно на «нет мест» (тексты отказа различает Ф5).
export function ruleFires(rule: GateRule, status: "AWAITING_PAYMENT" | "REJECTED"): boolean {
  if (!rule.templateActive) return false;
  if (rule.kind && rule.kind !== "PARKING") return false;
  const p = (rule.triggerParams ?? {}) as Params;
  if (p.status !== status) return false;
  if (p.source && p.source !== "SITE") return false;
  if (status === "REJECTED" && p.rejectKind && p.rejectKind !== "NO_SPACE") return false;
  return true;
}

export function gateFacts(rules: GateRule[], senderValue: unknown): GateFacts {
  return {
    confirmRule: rules.some((r) => ruleFires(r, "AWAITING_PAYMENT")),
    rejectRule: rules.some((r) => ruleFires(r, "REJECTED")),
    senderEnabled: senderValue === true,
  };
}

export function gateChecks(f: GateFacts): GateCheck[] {
  return [
    {
      id: "confirm_message",
      ok: f.confirmRule,
      title: "Клиенту есть чем ответить на подтверждение",
      hint: "Нужно включённое правило «Ожидает оплаты → место забронировано» с включённым текстом.",
    },
    {
      id: "reject_message",
      ok: f.rejectRule,
      title: "Клиенту есть чем ответить на отказ «мест нет»",
      hint: "Нужно включённое правило на отказ «мест нет» с включённым текстом (Настройки → Автоматизации).",
    },
    {
      id: "sender",
      ok: f.senderEnabled,
      title: "Отправщик сообщений включён",
      hint: "Сейчас сообщения клиентам не отправляются, а копятся в очереди. Включается после подключения мессенджера.",
    },
  ];
}

export function gateBlockers(checks: GateCheck[]): GateCheck[] {
  return checks.filter((c) => !c.ok);
}

// В момент решения: отказывать автоматически можно, только если отказ дойдёт до клиента
export function canRejectNow(f: GateFacts): boolean {
  return f.rejectRule && f.senderEnabled;
}

export function reserveText(capacity: number, limit: number): string {
  const r = Math.max(0, capacity - limit);
  if (r === 0) return "Резерва нет: автоподтверждение работает до последнего места.";
  return `Последние ${r} ${plural(r, "место", "места", "мест")} остаются резервом: такие заявки по-прежнему ждут администратора.`;
}
