import "server-only";
import { prisma } from "@/server/db/prisma";
import { audit } from "./audit";
import { fmtDateTime } from "@/server/lib/dates";
import { ruleWhen } from "@/lib/crm/automation-labels";
import { validateTemplateBody, validateTitle } from "@/lib/settings-validate";
import { TEMPLATE_VARS } from "@/server/automations/preview";

// Всё для клиентской карточки — уже строками по Москве
export type TemplateView = {
  code: string;
  name: string;
  body: string;
  isActive: boolean;
  version: string; // updatedAt, прочитанный формой: вторая вкладка не затрёт первую молча
  defaultName: string | null;
  defaultBody: string | null;
  edited: { at: string; by: string | null } | null;
  rules: { code: string; name: string; isActive: boolean; when: string }[];
};

export async function templatesForSettings(): Promise<TemplateView[]> {
  const rows = await prisma.messageTemplate.findMany({
    orderBy: { code: "asc" },
    include: { editedBy: { select: { name: true } }, rules: { orderBy: { code: "asc" } } },
  });
  return rows.map((t) => ({
    code: t.code,
    name: t.name,
    body: t.body,
    isActive: t.isActive,
    version: t.updatedAt.toISOString(),
    defaultName: t.defaultName,
    defaultBody: t.defaultBody,
    edited: t.editedAt ? { at: fmtDateTime(t.editedAt), by: t.editedBy?.name ?? null } : null,
    rules: t.rules.map((r) => ({ code: r.code, name: r.name, isActive: r.isActive, when: ruleWhen(r.trigger, r.triggerParams) })),
  }));
}

export type SaveResult = { ok: true; changed: boolean } | { ok: false; error: string; confirm?: boolean };

export async function saveTemplate(actorId: string, code: string, input: { name: string; body: string; version: string; force?: boolean }): Promise<SaveResult> {
  const name = validateTitle(input.name, "Название");
  if (!name.ok) return name;
  const body = input.body.replace(/\r\n/g, "\n");
  const row = await prisma.messageTemplate.findUnique({ where: { code } });
  if (!row) return { ok: false, error: "Шаблон не найден" };
  if (row.updatedAt.toISOString() !== input.version) return { ok: false, error: "Шаблон изменили в другом окне — обновите страницу" };
  if (row.name === name.value && row.body === body) return { ok: true, changed: false };
  const check = validateTemplateBody(body, TEMPLATE_VARS, row.body);
  if (check.errors.length) return { ok: false, error: check.errors.join(". ") };
  if (check.warnings.length && !input.force) return { ok: false, error: check.warnings.join(". "), confirm: true };
  const res = await prisma.messageTemplate.updateMany({
    where: { code, updatedAt: row.updatedAt },
    data: { name: name.value, body, editedAt: new Date(), editedById: actorId },
  });
  if (res.count === 0) return { ok: false, error: "Шаблон изменили в другом окне — обновите страницу" };
  await audit(actorId, "UPDATE", "MessageTemplate", row.id, { code, before: { name: row.name, body: row.body }, after: { name: name.value, body } });
  return { ok: true, changed: true };
}

// Текст по умолчанию обратно, и шаблон снова ведёт seed
export async function restoreTemplate(actorId: string, code: string, version: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.messageTemplate.findUnique({ where: { code } });
  if (!row) return { ok: false, error: "Шаблон не найден" };
  if (row.defaultBody === null || row.defaultName === null) return { ok: false, error: "Текст по умолчанию не записан — вернуть нечего" };
  const res = await prisma.messageTemplate.updateMany({
    where: { code, updatedAt: new Date(version) },
    data: { name: row.defaultName, body: row.defaultBody, editedAt: null, editedById: null },
  });
  if (res.count === 0) return { ok: false, error: "Шаблон изменили в другом окне — обновите страницу" };
  await audit(actorId, "UPDATE", "MessageTemplate", row.id, { code, restored: true, before: { name: row.name, body: row.body } });
  return { ok: true };
}
