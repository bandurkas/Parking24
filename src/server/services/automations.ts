import "server-only";
import { prisma } from "@/server/db/prisma";
import { audit } from "./audit";
import { parkingSettings } from "./settings";
import { fmtDateTime } from "@/server/lib/dates";
import { ruleIsTimed, ruleWhen } from "@/lib/crm/automation-labels";
import { isRejectRule, rejectRuleWarning } from "@/lib/settings-validate";

export type RuleView = {
  code: string;
  name: string;
  isActive: boolean;
  when: string;
  timed: boolean;
  reject: boolean;
  template: { code: string; name: string; isActive: boolean } | null;
  edited: { at: string; by: string | null } | null;
  sameGroup: string[]; // правила той же группы дублей: клиент получает одно сообщение на бронь
};

export async function rulesForSettings(): Promise<RuleView[]> {
  const rows = await prisma.automationRule.findMany({
    orderBy: { code: "asc" },
    include: { template: { select: { code: true, name: true, isActive: true } }, editedBy: { select: { name: true } } },
  });
  const group = (p: unknown) => (p && typeof p === "object" ? (p as { dedupGroup?: unknown }).dedupGroup : undefined);
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    isActive: r.isActive,
    when: ruleWhen(r.trigger, r.triggerParams),
    timed: ruleIsTimed(r.trigger),
    reject: isRejectRule(r.trigger, r.triggerParams),
    template: r.template,
    edited: r.editedAt ? { at: fmtDateTime(r.editedAt), by: r.editedBy?.name ?? null } : null,
    sameGroup: group(r.triggerParams) ? rows.filter((o) => o.code !== r.code && group(o.triggerParams) === group(r.triggerParams)).map((o) => o.name) : [],
  }));
}

export type ToggleResult = { ok: true } | { ok: false; error: string; confirm?: boolean };

// Выключатель ставит editedAt: seed после этого isActive правила не трогает (МФ-2 Р8)
export async function setRuleActive(actorId: string, code: string, isActive: boolean, force = false): Promise<ToggleResult> {
  const row = await prisma.automationRule.findUnique({ where: { code } });
  if (!row) return { ok: false, error: "Правило не найдено" };
  if (row.isActive === isActive) return { ok: true };
  const warn = rejectRuleWarning(row, isActive, (await parkingSettings()).autoConfirm);
  if (warn && !force) return { ok: false, error: warn, confirm: true };
  await prisma.automationRule.update({ where: { code }, data: { isActive, editedAt: new Date(), editedById: actorId } });
  await audit(actorId, "UPDATE", "AutomationRule", row.id, { code, isActive: { before: row.isActive, after: isActive } });
  return { ok: true };
}
