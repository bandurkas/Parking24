// Условия событийных правил (STATUS_CHANGED) в одном месте, без базы (Ф5): диспетчер зовёт, юнит-тесты проверяют
import type { RejectKind } from "@prisma/client";

export type StatusRuleParams = {
  status?: string;
  source?: string; // только заявки из этого источника (on_new_lead — сайт)
  rejectKind?: RejectKind; // вид отказа: «мест нет» и общий — разные тексты (ТЗ 1.2, 2)
  dedupGroup?: string; // правила одной группы шлют одно сообщение на бронь
  delayMinutes?: number; // «спасибо и отзыв» — через 2 часа после выезда
};

export type StatusEvent = { status: string; source: string; rejectKind: RejectKind | null };

export function statusRuleMatches(p: StatusRuleParams, e: StatusEvent): boolean {
  if (p.status !== e.status) return false;
  if (p.source && p.source !== e.source) return false;
  // Пустой вид отказа — общий: «мест нет» наугад не уходит
  if (p.rejectKind && p.rejectKind !== (e.rejectKind ?? "OTHER")) return false;
  return true;
}

export function scheduledFor(p: StatusRuleParams, now: Date): Date {
  const m = p.delayMinutes;
  return typeof m === "number" && Number.isFinite(m) && m > 0 ? new Date(now.getTime() + Math.round(m) * 60_000) : now;
}
