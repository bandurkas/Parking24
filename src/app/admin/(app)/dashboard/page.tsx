import { requireUser } from "@/server/auth/guard";
import { prisma } from "@/server/db/prisma";
import { todayIso, toDate, addDays } from "@/server/lib/dates";
import { SOURCE_LABEL } from "@/lib/crm/labels";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireUser(["OWNER"]);
  const today = todayIso();
  const monthStart = toDate(today.slice(0, 8) + "01");
  const t = toDate(today);
  const [revenue, refunds, newCount, cancelled, onSite, bySource, upcoming] = await Promise.all([
    prisma.payment.aggregate({ where: { kind: "PAYMENT", status: "SUCCEEDED", paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { kind: "REFUND", status: "SUCCEEDED", paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.booking.count({ where: { status: "NEW" } }),
    prisma.booking.count({ where: { status: { in: ["CANCELLED", "NO_SHOW"] }, updatedAt: { gte: monthStart } } }),
    prisma.booking.count({ where: { status: "CHECKED_IN" } }),
    prisma.booking.groupBy({ by: ["source"], where: { createdAt: { gte: toDate(addDays(today, -90)) } }, _count: { _all: true }, _sum: { paidAmount: true } }),
    prisma.booking.count({ where: { dateFrom: { gt: t, lte: toDate(addDays(today, 7)) }, status: { in: ["CONFIRMED", "AWAITING_PAYMENT", "NEW"] } } }),
  ]);
  const tiles = [
    { label: "Выручка за месяц", value: `${((revenue._sum.amount ?? 0) - (refunds._sum.amount ?? 0)).toLocaleString("ru-RU")} ₽` },
    { label: "Сейчас на стоянке", value: onSite },
    { label: "Новых заявок", value: newCount, tone: newCount > 0 ? "text-primary-deep" : "" },
    { label: "Заездов за 7 дней", value: upcoming },
    { label: "Отмен / no-show за месяц", value: cancelled, tone: cancelled > 0 ? "text-danger" : "" },
  ];
  const total = bySource.reduce((s, r) => s + r._count._all, 0);
  return (
    <div className="mx-auto max-w-5xl">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Владелец</div>
      <h1 className="text-xl font-bold">Дашборд</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="adm-card p-4">
            <div className={`font-mono text-2xl font-bold tnum ${t.tone ?? ""}`}>{t.value}</div>
            <div className="mt-1 text-xs text-ink-muted">{t.label}</div>
          </div>
        ))}
      </div>
      <section className="adm-card mt-4">
        <h2 className="border-b border-line px-4 py-3 font-bold">Источники за 90 дней</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <tr><th className="px-4 py-2">Источник</th><th className="px-4 py-2 text-right">Заявок</th><th className="px-4 py-2 text-right">Доля</th><th className="px-4 py-2 text-right">Оплачено</th></tr>
          </thead>
          <tbody>
            {bySource.sort((a, b) => b._count._all - a._count._all).map((r) => (
              <tr key={r.source} className="border-t border-line">
                <td className="px-4 py-2 font-semibold">{SOURCE_LABEL[r.source]}</td>
                <td className="px-4 py-2 text-right font-mono tnum">{r._count._all}</td>
                <td className="px-4 py-2 text-right font-mono tnum text-ink-muted">{total ? Math.round((r._count._all / total) * 100) : 0}%</td>
                <td className="px-4 py-2 text-right font-mono tnum font-semibold">{(r._sum.paidAmount ?? 0).toLocaleString("ru-RU")} ₽</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
