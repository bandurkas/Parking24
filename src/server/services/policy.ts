import "server-only";
import { prisma } from "@/server/db/prisma";
import { audit } from "./audit";
import { LINKS, rawLinks, routeFallback, setSettings, type SiteLinks } from "./settings";
import { validateLink, validateNoShowHours } from "@/lib/settings-validate";

type Result = { ok: true } | { ok: false; error: string };

// Остальные поля CancellationPolicy ни одна строка кода не читает — их не показываем (МФ-2 Р14)
export async function policyForSettings() {
  const [policy, links, pending] = await Promise.all([
    prisma.cancellationPolicy.findUnique({ where: { id: "default" } }),
    rawLinks(),
    prisma.outbox.count({ where: { status: "PENDING" } }),
  ]);
  return { autoNoShowAfterHours: policy?.autoNoShowAfterHours ?? 24, links, routeFallback: routeFallback(), pendingOutbox: pending };
}

export async function saveLinks(actorId: string, input: SiteLinks): Promise<Result> {
  const next: Partial<SiteLinks> = {};
  for (const k of ["route", "review", "video"] as const) {
    const v = validateLink(input[k] ?? "");
    if (!v.ok) return { ok: false, error: `${LINKS[k].label}: ${v.error}` };
    next[k] = v.value;
  }
  const before = await rawLinks();
  const changed = (["route", "review", "video"] as const).filter((k) => before[k] !== next[k]);
  if (!changed.length) return { ok: true };
  await setSettings(Object.fromEntries(changed.map((k) => [LINKS[k].key, next[k] as string])));
  await audit(actorId, "UPDATE", "Setting", "links", { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, next[k]])) });
  return { ok: true };
}

export async function savePolicy(actorId: string, input: { autoNoShowAfterHours: number }): Promise<Result> {
  const h = validateNoShowHours(Number(input.autoNoShowAfterHours));
  if (!h.ok) return h;
  const before = await prisma.cancellationPolicy.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  if (before.autoNoShowAfterHours === h.value) return { ok: true };
  await prisma.cancellationPolicy.update({ where: { id: "default" }, data: { autoNoShowAfterHours: h.value } });
  await audit(actorId, "UPDATE", "CancellationPolicy", "default", { autoNoShowAfterHours: { before: before.autoNoShowAfterHours, after: h.value } });
  return { ok: true };
}
