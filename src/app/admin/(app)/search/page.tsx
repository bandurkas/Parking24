import Link from "next/link";
import { findByPhoneOrPlate } from "@/server/services/bookings";
import StatusChip from "@/components/admin/StatusChip";
import Plate from "@/components/admin/Plate";
import { formatPhone } from "@/lib/phone";
import { fmtRange } from "@/server/lib/dates";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const rows = q.trim() ? await findByPhoneOrPlate(q.trim()) : [];
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-bold">Поиск: <span className="font-mono">{q}</span></h1>
      <div className="adm-card mt-4 divide-y divide-line">
        {rows.length === 0 && <div className="px-4 py-10 text-center text-ink-muted">Ничего не найдено</div>}
        {rows.map((b) => (
          <Link key={b.id} href={`/admin/bookings/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-soft">
            <span className="font-mono text-sm font-bold text-primary-deep">№{b.number}</span>
            <StatusChip status={b.status} short />
            <Plate plate={b.plate} size="sm" />
            <span className="text-sm font-semibold">{b.contactName ?? b.client?.name ?? "—"}</span>
            <span className="font-mono text-xs text-ink-muted">{formatPhone(b.contactPhone)}</span>
            <span className="ml-auto font-mono text-xs tnum text-ink-muted">{fmtRange(b.dateFrom, b.dateTo)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
