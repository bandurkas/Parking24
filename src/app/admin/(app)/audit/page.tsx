import { requireUser } from "@/server/auth/guard";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requireUser(["OWNER"]);
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { name: true } } } });
  return (
    <div className="mx-auto max-w-5xl">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Безопасность</div>
      <h1 className="text-xl font-bold">Журнал действий</h1>
      <div className="adm-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-soft text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <tr><th className="px-3 py-2">Когда</th><th className="px-3 py-2">Кто</th><th className="px-3 py-2">Действие</th><th className="px-3 py-2">Объект</th><th className="px-3 py-2">Детали</th><th className="px-3 py-2">IP</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-1.5 font-mono text-xs tnum text-ink-muted">{r.createdAt.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="px-3 py-1.5">{r.user?.name ?? "—"}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-1.5 text-xs">{r.entity} <span className="font-mono text-ink-muted">{r.entityId?.slice(0, 8)}</span></td>
                <td className="max-w-xs truncate px-3 py-1.5 font-mono text-[11px] text-ink-muted">{r.diff ? JSON.stringify(r.diff) : ""}</td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-ink-muted">{r.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
