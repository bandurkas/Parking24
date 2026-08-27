import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, MessageCircle } from "lucide-react";
import { prisma } from "@/server/db/prisma";
import { requireUser } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { formatPhone } from "@/lib/phone";
import { SOURCE_LABEL, VEHICLE_LABEL } from "@/lib/crm/labels";
import { fmtRange } from "@/server/lib/dates";
import Plate from "@/components/admin/Plate";
import StatusChip from "@/components/admin/StatusChip";
import NewBookingForClient from "@/components/admin/NewBookingForClient";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["OWNER", "ADMIN"]);
  const { id } = await params;
  const c = await prisma.client.findUnique({
    where: { id },
    include: {
      vehicles: { orderBy: { createdAt: "desc" } },
      bookings: { orderBy: { dateFrom: "desc" }, take: 50 },
      interactions: { orderBy: { occurredAt: "desc" }, take: 30, include: { user: { select: { name: true } }, booking: { select: { number: true } } } },
    },
  });
  if (!c) notFound();
  await audit(user.id, "VIEW", "Client", c.id);
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft size={15} /> Клиенты</Link>
      <div className="adm-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Клиент</div>
            <h1 className="text-2xl font-bold">{c.name ?? "Без имени"}</h1>
            <div className="mt-1 flex items-center gap-3 font-mono text-sm">
              <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-primary-deep"><Phone size={14} /> {formatPhone(c.phone)}</a>
              <a href={`https://wa.me/${c.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[#128c7e] hover:underline"><MessageCircle size={14} /> WhatsApp</a>
            </div>
            <div className="mt-1 text-xs text-ink-muted">Первое касание: {SOURCE_LABEL[c.firstSource]} · с {c.createdAt.toLocaleDateString("ru-RU")}</div>
          </div>
          <div className="ml-auto grid grid-cols-2 gap-4 text-center">
            <div><div className="font-mono text-2xl font-bold tnum">{c.bookings.length}</div><div className="text-[10px] uppercase tracking-wide text-ink-muted">броней</div></div>
            <div><div className="font-mono text-2xl font-bold tnum">{c.ltv.toLocaleString("ru-RU")} ₽</div><div className="text-[10px] uppercase tracking-wide text-ink-muted">LTV</div></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {c.vehicles.map((v) => (
            <span key={v.id} className="flex items-center gap-2 rounded-lg bg-surface-soft px-2 py-1 text-xs"><Plate plate={v.plate} size="sm" /> {VEHICLE_LABEL[v.type]}</span>
          ))}
          <NewBookingForClient phone={c.phone} />
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="adm-card">
          <h2 className="border-b border-line px-4 py-3 font-bold">Брони</h2>
          <ul className="divide-y divide-line">
            {c.bookings.map((b) => (
              <li key={b.id}>
                <Link href={`/admin/bookings/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-soft">
                  <span className="font-mono font-bold text-primary-deep">№{b.number}</span>
                  <StatusChip status={b.status} short />
                  <span className="font-mono text-xs tnum">{fmtRange(b.dateFrom, b.dateTo)}</span>
                  <span className="ml-auto font-mono text-xs tnum font-semibold">{b.amount.toLocaleString("ru-RU")} ₽</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="adm-card">
          <h2 className="border-b border-line px-4 py-3 font-bold">Взаимодействия</h2>
          <ul className="divide-y divide-line">
            {c.interactions.map((i) => (
              <li key={i.id} className="px-4 py-2.5 text-sm">
                <div>{i.text}</div>
                <div className="font-mono text-[11px] text-ink-muted">
                  {i.occurredAt.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {i.booking && ` · №${i.booking.number}`}{i.user && ` · ${i.user.name}`}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
