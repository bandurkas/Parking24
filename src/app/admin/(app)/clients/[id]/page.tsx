import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, MessageCircle, Send, CalendarPlus, Bus } from "lucide-react";
import { prisma } from "@/server/db/prisma";
import { requireUser } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { formatPhone } from "@/lib/phone";
import { CLIENT_STATUS_CHIP, CLIENT_STATUS_LABEL, SOURCE_LABEL, VEHICLE_LABEL } from "@/lib/crm/labels";
import { fmtDate, fmtDateTime, fmtRange, todayIso, toIso } from "@/server/lib/dates";
import Plate from "@/components/admin/Plate";
import StatusChip from "@/components/admin/StatusChip";
import NewBookingForClient from "@/components/admin/NewBookingForClient";
import ClientDetails from "@/components/admin/client/ClientDetails";
import ClientFeed from "@/components/admin/client/ClientFeed";
import VehiclesPanel from "@/components/admin/client/VehiclesPanel";
import ConsentPanel from "@/components/admin/client/ConsentPanel";

export const dynamic = "force-dynamic";

const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

function initials(name: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["OWNER", "ADMIN"]);
  const { id } = await params;
  const c = await prisma.client.findUnique({
    where: { id },
    include: {
      vehicles: { orderBy: { createdAt: "desc" }, include: { _count: { select: { bookings: true } }, bookings: { orderBy: { dateFrom: "desc" }, take: 1, select: { dateFrom: true } } } },
      bookings: { orderBy: { dateFrom: "desc" }, include: { payments: { select: { kind: true, amount: true } } } },
      interactions: { orderBy: { occurredAt: "desc" }, take: 200, include: { user: { select: { name: true } }, booking: { select: { id: true, number: true } } } },
      outbox: { orderBy: { scheduledAt: "desc" }, take: 20, include: { booking: { select: { number: true } } } },
    },
  });
  if (!c) notFound();
  await audit(user.id, "VIEW", "Client", c.id);

  const today = todayIso();
  const done = c.bookings.filter((b) => b.status === "CHECKED_OUT" || b.status === "CHECKED_IN");
  const paidBookings = c.bookings.filter((b) => b.paidAmount > 0);
  const paidTotal = c.bookings.reduce((s, b) => s + b.paidAmount, 0);
  const refunds = c.bookings.reduce((s, b) => s + b.payments.filter((p) => p.kind === "REFUND").reduce((x, p) => x + p.amount, 0), 0);
  const unpaid = c.bookings.filter((b) => ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"].includes(b.status)).reduce((s, b) => s + Math.max(0, b.amount - b.paidAmount), 0);
  const cancelled = c.bookings.filter((b) => b.status === "CANCELLED" || b.status === "NO_SHOW").length;
  const nights = done.reduce((s, b) => s + b.days, 0);
  const lastVisit = done.map((b) => b.dateTo).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const upcoming = c.bookings.filter((b) => ["NEW", "AWAITING_PAYMENT", "CONFIRMED"].includes(b.status) && toIso(b.dateFrom) >= today).sort((a, b) => a.dateFrom.getTime() - b.dateFrom.getTime())[0] ?? null;
  const onSite = c.bookings.find((b) => b.status === "CHECKED_IN") ?? null;
  const vtCount = new Map<string, number>();
  for (const b of c.bookings) if (b.vehicleType) vtCount.set(b.vehicleType, (vtCount.get(b.vehicleType) ?? 0) + 1);
  const favVt = [...vtCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as keyof typeof VEHICLE_LABEL | undefined;
  const transfers = c.bookings.filter((b) => b.transferNeeded).length;
  const utm = (c.firstUtm ?? {}) as Record<string, string>;
  const utmLine = ["utm_source", "utm_medium", "utm_campaign"].map((k) => utm[k]).filter(Boolean).join(" / ");
  const lastViews = user.role === "OWNER"
    ? await prisma.auditLog.findMany({ where: { entity: "Client", entityId: c.id, action: "VIEW", NOT: { userId: user.id } }, orderBy: { createdAt: "desc" }, take: 3, include: { user: { select: { name: true } } } })
    : [];

  const kpi = [
    { l: "LTV", v: rub(c.ltv), sub: refunds ? `возвраты ${rub(refunds)}` : null },
    { l: "Визитов", v: String(done.length), sub: nights ? `${nights} сут. всего` : null },
    { l: "Средний чек", v: paidBookings.length ? rub(Math.round(paidTotal / paidBookings.length)) : "—", sub: null },
    { l: "Броней", v: String(c.bookings.length), sub: cancelled ? `${cancelled} отмен / no-show` : null, tone: "" },
    { l: "К оплате", v: unpaid ? rub(unpaid) : "—", sub: null, tone: unpaid ? "text-warning" : "" },
    { l: "Последний визит", v: lastVisit ? fmtDate(lastVisit, { day: "numeric", month: "short", year: "2-digit" }) : "—", sub: null },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft size={15} /> Клиенты</Link>

      <header className="adm-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-navy-deep font-mono text-lg font-bold text-white">{initials(c.name)}</div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Клиент</div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{c.name ?? <span className="text-ink-muted">Без имени</span>}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${CLIENT_STATUS_CHIP[c.status]}`}>{CLIENT_STATUS_LABEL[c.status]}</span>
              {c.tags.map((t) => <span key={t} className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-deep">{t}</span>)}
              {c.doNotDisturb && <span className="rounded-full bg-danger/8 px-2 py-0.5 text-xs font-semibold text-danger">не беспокоить</span>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm">
              <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-primary-deep"><Phone size={14} /> {formatPhone(c.phone)}</a>
              <a href={`https://wa.me/${c.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[#128c7e] hover:underline"><MessageCircle size={14} /> WhatsApp</a>
              {c.telegram && <a href={`https://t.me/${c.telegram}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[#2AABEE] hover:underline"><Send size={14} /> @{c.telegram}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="text-ink-muted hover:underline">{c.email}</a>}
            </div>
            <div className="mt-1 text-xs text-ink-muted">
              Источник: {SOURCE_LABEL[c.firstSource]}{utmLine && ` (${utmLine})`} · в базе с {fmtDate(c.createdAt, { day: "numeric", month: "short", year: "numeric" })}
              {favVt && ` · обычно ${VEHICLE_LABEL[favVt].toLowerCase()}`}{transfers > 0 && ` · трансфер ×${transfers}`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <NewBookingForClient phone={c.phone} />
            <a href={`tel:${c.phone}`} className="adm-btn h-8 gap-1 px-3 text-xs"><Phone size={13} /> Позвонить</a>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {kpi.map((k) => (
            <div key={k.l} className="rounded-xl bg-surface-soft px-3 py-2.5">
              <div className={`font-mono text-lg font-bold tnum leading-tight ${k.tone ?? ""}`}>{k.v}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-muted">{k.l}</div>
              {k.sub && <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{k.sub}</div>}
            </div>
          ))}
        </div>

        {(onSite || upcoming) && (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {onSite && (
              <Link href={`/admin/bookings/${onSite.id}`} className="flex items-center gap-2 rounded-lg bg-success/12 px-3 py-1.5 font-semibold text-[#0b7a4c] hover:underline">
                Сейчас на стоянке · №{onSite.number} · до {fmtDate(onSite.dateTo)}
              </Link>
            )}
            {upcoming && (
              <Link href={`/admin/bookings/${upcoming.id}`} className="flex items-center gap-2 rounded-lg bg-primary-soft px-3 py-1.5 font-semibold text-primary-deep hover:underline">
                <CalendarPlus size={14} /> Ближайший заезд · №{upcoming.number} · {fmtRange(upcoming.dateFrom, upcoming.dateTo)}
              </Link>
            )}
          </div>
        )}
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_minmax(20rem,26rem)]">
        <div className="space-y-4">
          <ClientDetails
            form={{ clientId: c.id, name: c.name ?? "", status: c.status, email: c.email ?? "", messenger: c.messenger ?? "", telegram: c.telegram ?? "", birthday: c.birthday ? toIso(c.birthday) : "", company: c.company ?? "", inn: c.inn ?? "", tags: c.tags, note: c.note ?? "" }}
            view={{ birthday: c.birthday ? fmtDate(c.birthday, { day: "numeric", month: "long", year: "numeric" }) : "", created: fmtDateTime(c.createdAt) }}
          />

          <VehiclesPanel clientId={c.id} vehicles={c.vehicles.map((v) => ({ id: v.id, plate: v.plate, type: v.type, model: v.model, bookings: v._count.bookings, lastDate: v.bookings[0] ? fmtDate(v.bookings[0].dateFrom) : null }))} />

          <section className="adm-card">
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="font-bold">Брони</h2>
              <span className="font-mono text-xs text-ink-muted">{c.bookings.length}</span>
              <span className="ml-auto font-mono text-xs text-ink-muted">оплачено {rub(paidTotal)}</span>
            </header>
            <ul className="divide-y divide-line">
              {c.bookings.map((b) => {
                const due = Math.max(0, b.amount - b.paidAmount);
                return (
                  <li key={b.id}>
                    <Link href={`/admin/bookings/${b.id}`} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-surface-soft sm:grid-cols-[3.5rem_8rem_1fr_auto_auto]">
                      <span className="font-mono font-bold text-primary-deep">№{b.number}</span>
                      <StatusChip status={b.status} short />
                      <span className="flex flex-wrap items-center gap-2 font-mono text-xs tnum">
                        {fmtRange(b.dateFrom, b.dateTo)} <span className="text-ink-muted">· {b.days}д</span>
                        {b.plate && <Plate plate={b.plate} size="sm" />}
                        {b.vehicleType && <span className="text-ink-muted">{VEHICLE_LABEL[b.vehicleType]}</span>}
                        {b.roomType && <span className="text-ink-muted">{b.roomType}</span>}
                        {b.transferNeeded && <Bus size={12} className="text-primary-deep" />}
                      </span>
                      <span className="text-right font-mono text-xs tnum font-semibold">{rub(b.amount)}</span>
                      <span className={`text-right font-mono text-[11px] tnum ${due > 0 && !["CANCELLED", "NO_SHOW"].includes(b.status) ? "text-warning" : "text-success"}`}>
                        {["CANCELLED", "NO_SHOW"].includes(b.status) ? "" : due > 0 ? `долг ${rub(due)}` : "оплачено"}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {c.bookings.length === 0 && <li className="px-4 py-4 text-sm text-ink-muted">—</li>}
            </ul>
          </section>

          <ConsentPanel
            clientId={c.id}
            personal={{ on: !!c.consentPersonalAt, at: c.consentPersonalAt ? fmtDateTime(c.consentPersonalAt) : null, source: c.consentSource }}
            marketing={{ on: !!c.consentMarketingAt, at: c.consentMarketingAt ? fmtDateTime(c.consentMarketingAt) : null }}
            dnd={c.doNotDisturb}
            campaigns={0}
          />

          {c.outbox.length > 0 && (
            <section className="adm-card">
              <header className="border-b border-line px-4 py-3"><h2 className="font-bold">Сообщения клиенту</h2></header>
              <ul className="divide-y divide-line">
                {c.outbox.map((o) => (
                  <li key={o.id} className="px-4 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
                      <span className="uppercase">{o.templateCode}</span> · {o.channel}{o.booking && ` · №${o.booking.number}`}
                      <span className={`ml-auto rounded px-1.5 py-0.5 font-semibold ${o.status === "SENT" ? "bg-success/12 text-[#0b7a4c]" : o.status === "FAILED" ? "bg-danger/8 text-danger" : "bg-warning/15 text-[#8a5a00]"}`}>
                        {o.status === "SENT" && o.sentAt ? `отправлено ${fmtDateTime(o.sentAt)}` : o.status === "PENDING" ? `запланировано ${fmtDateTime(o.scheduledAt)}` : o.status.toLowerCase()}
                      </span>
                    </div>
                    <div className="mt-1 text-ink">{o.renderedText}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lastViews.length > 0 && (
            <div className="px-1 font-mono text-[11px] text-ink-muted">
              Смотрели карточку: {lastViews.map((v) => `${v.user?.name ?? "—"} ${fmtDateTime(v.createdAt)}`).join(" · ")}
            </div>
          )}
        </div>

        <ClientFeed
          clientId={c.id}
          items={c.interactions.map((i) => ({ id: i.id, type: i.type, text: i.text, at: fmtDateTime(i.occurredAt), user: i.user?.name ?? null, channel: i.channel, bookingId: i.booking?.id ?? null, bookingNumber: i.booking?.number ?? null }))}
        />
      </div>
    </div>
  );
}
