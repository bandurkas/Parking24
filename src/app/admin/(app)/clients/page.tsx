import Link from "next/link";
import { prisma } from "@/server/db/prisma";
import { formatPhone } from "@/lib/phone";
import { CLIENT_STATUS_CHIP, CLIENT_STATUS_LABEL, SOURCE_LABEL } from "@/lib/crm/labels";
import { fmtDate } from "@/server/lib/dates";
import Plate from "@/components/admin/Plate";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const digits = q.replace(/\D/g, "");
  const clients = await prisma.client.findMany({
    where: q
      ? { OR: [...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []), { name: { contains: q, mode: "insensitive" } }, { vehicles: { some: { plate: { contains: q.toUpperCase() } } } }] }
      : undefined,
    include: { vehicles: { take: 2, orderBy: { createdAt: "desc" } }, _count: { select: { bookings: true } }, bookings: { take: 1, orderBy: { dateFrom: "desc" }, select: { dateFrom: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">База</div>
          <h1 className="text-xl font-bold">Клиенты</h1>
        </div>
        <form className="ml-auto">
          <input name="q" defaultValue={q} placeholder="Телефон, имя, номер авто" className="adm-input h-10 w-72 text-sm" />
        </form>
      </div>
      <div className="adm-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-soft text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">Клиент</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Авто</th>
              <th className="px-3 py-2 text-right">Броней</th>
              <th className="px-3 py-2 text-right">LTV</th>
              <th className="px-3 py-2">Источник</th>
              <th className="px-3 py-2">Последний визит</th>
              <th className="px-3 py-2">Рассылки</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-t border-line hover:bg-surface-soft">
                <td className="px-3 py-2">
                  <Link href={`/admin/clients/${c.id}`} className="font-semibold hover:underline">{c.name ?? <span className="text-ink-muted">Без имени</span>}</Link>
                  <div className="font-mono text-xs text-ink-muted">{formatPhone(c.phone)}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CLIENT_STATUS_CHIP[c.status]}`}>{CLIENT_STATUS_LABEL[c.status]}</span>
                  {c.tags.length > 0 && <div className="mt-1 text-[11px] text-ink-muted">{c.tags.join(", ")}</div>}
                </td>
                <td className="px-3 py-2"><div className="flex gap-1">{c.vehicles.map((v) => <Plate key={v.id} plate={v.plate} size="sm" />)}</div></td>
                <td className="px-3 py-2 text-right font-mono tnum">{c._count.bookings}</td>
                <td className="px-3 py-2 text-right font-mono tnum font-semibold">{c.ltv.toLocaleString("ru-RU")} ₽</td>
                <td className="px-3 py-2 text-xs text-ink-muted">{SOURCE_LABEL[c.firstSource]}</td>
                <td className="px-3 py-2 font-mono text-xs tnum text-ink-muted">{c.bookings[0] ? fmtDate(c.bookings[0].dateFrom, { day: "numeric", month: "short", year: "2-digit" }) : "—"}</td>
                <td className="px-3 py-2 text-xs">{c.doNotDisturb ? <span className="text-danger">не беспокоить</span> : c.consentMarketingAt ? <span className="text-[#0b7a4c]">можно</span> : <span className="text-ink-muted">—</span>}</td>
              </tr>
            ))}
            {clients.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-ink-muted">Клиентов пока нет</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
