import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/server/db/prisma";
import { SLUG_KIND, KIND_LABEL } from "@/lib/crm/labels";
import { todayIso, addDays, toDate } from "@/server/lib/dates";
import { occupancyToday } from "@/server/services/occupancy";
import KanbanBoard, { type KanbanItem } from "@/components/admin/kanban/KanbanBoard";
import BookingsTable from "@/components/admin/kanban/BookingsTable";
import TodayStrip from "@/components/admin/TodayStrip";
import { LayoutGrid, Table2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BoardPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ view?: string }> }) {
  const { kind: slug } = await params;
  const { view = "kanban" } = await searchParams;
  const kind = SLUG_KIND[slug];
  if (!kind) notFound();

  const today = todayIso();
  const t = toDate(today);
  const [rows, occ, arrivals, departures] = await Promise.all([
    prisma.booking.findMany({
      where: {
        kind,
        OR: [
          { status: { in: ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"] } },
          { status: { in: ["CHECKED_OUT", "CANCELLED", "NO_SHOW"] }, updatedAt: { gte: toDate(addDays(today, -14)) } },
        ],
      },
      include: { client: { select: { name: true, phone: true } } },
      orderBy: [{ dateFrom: "asc" }, { number: "asc" }],
    }),
    kind === "PARKING" ? occupancyToday(today) : Promise.resolve([]),
    prisma.booking.count({ where: { kind, dateFrom: t, status: { in: ["CONFIRMED", "AWAITING_PAYMENT", "NEW"] } } }),
    prisma.booking.count({ where: { kind, dateTo: t, status: "CHECKED_IN" } }),
  ]);

  const items: KanbanItem[] = rows.map((b) => ({
    id: b.id,
    number: b.number,
    status: b.status,
    name: b.contactName ?? b.client?.name ?? null,
    phone: b.contactPhone ?? b.client?.phone ?? null,
    plate: b.plate,
    vehicleType: b.vehicleType,
    roomType: b.roomType,
    dateFrom: b.dateFrom.toISOString().slice(0, 10),
    dateTo: b.dateTo.toISOString().slice(0, 10),
    timeFrom: b.timeFrom,
    days: b.days,
    amount: b.amount,
    paidAmount: b.paidAmount,
    source: b.source,
    transferNeeded: b.transferNeeded,
  }));

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Доска</div>
          <h1 className="text-xl font-bold leading-tight">{KIND_LABEL[kind]}</h1>
        </div>
        <TodayStrip today={today} occupancy={occ} arrivals={arrivals} departures={departures} />
        <div className="ml-auto flex rounded-lg bg-surface p-1">
          <Link href={`?view=kanban`} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${view === "kanban" ? "bg-white shadow-card" : "text-ink-muted"}`}>
            <LayoutGrid size={15} /> Канбан
          </Link>
          <Link href={`?view=table`} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${view === "table" ? "bg-white shadow-card" : "text-ink-muted"}`}>
            <Table2 size={15} /> Таблица
          </Link>
        </div>
      </div>
      {view === "table" ? <BookingsTable items={items} /> : <KanbanBoard items={items} kind={kind} />}
    </div>
  );
}
