import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bus, Phone, MessageCircle, User } from "lucide-react";
import { prisma } from "@/server/db/prisma";
import { bookingInclude } from "@/server/services/bookings";
import { requireUser } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { fmtDate, fmtRange } from "@/server/lib/dates";
import { KIND_LABEL, SOURCE_LABEL, VEHICLE_LABEL } from "@/lib/crm/labels";
import { formatPhone } from "@/lib/phone";
import Plate from "@/components/admin/Plate";
import StatusChip from "@/components/admin/StatusChip";
import ChannelLinks from "@/components/admin/ChannelLinks";
import TransitionButtons from "@/components/admin/booking/TransitionButtons";
import PaymentPanel from "@/components/admin/booking/PaymentPanel";
import ActivityFeed from "@/components/admin/booking/ActivityFeed";
import EditBooking from "@/components/admin/booking/EditBooking";
import StatusCorrect from "@/components/admin/booking/StatusCorrect";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fix?: string }> }) {
  const user = await requireUser(["OWNER", "ADMIN"]);
  const { id } = await params;
  const { fix } = await searchParams;
  const b = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!b) notFound();
  await audit(user.id, "VIEW", "Booking", b.id);

  const unpaid = Math.max(0, b.amount - b.paidAmount);
  const wa = b.contactPhone ? `https://wa.me/${b.contactPhone.replace(/\D/g, "")}` : null;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href={`/admin/boards/${b.kind === "PARKING" ? "parking" : "rooms"}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft size={15} /> {KIND_LABEL[b.kind]}
      </Link>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        {/* Посадочный талон */}
        <section className="adm-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-dashed border-line bg-surface-soft px-5 py-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Бронь</div>
              <div className="font-mono text-3xl font-bold leading-none">№{b.number}</div>
            </div>
            <StatusChip status={b.status} className="text-sm" />
            <span className="rounded bg-white px-2 py-1 text-xs font-semibold text-ink-muted ring-1 ring-line">{SOURCE_LABEL[b.source]}</span>
            <div className="ml-auto">
              <TransitionButtons bookingId={b.id} status={b.status} role={user.role} />
            </div>
            <div className="flex w-full justify-end">
              <StatusCorrect bookingId={b.id} status={b.status} autoOpen={fix === "1"} />
            </div>
          </div>

          <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
            <div>
              <div className="adm-label">Заезд → выезд</div>
              <div className="font-mono text-xl font-bold tnum">{fmtRange(b.dateFrom, b.dateTo)}</div>
              <div className="text-sm text-ink-muted">
                {b.days} сут.{b.timeFrom && ` · заезд ${b.timeFrom}`}{b.timeTo && ` · выезд ${b.timeTo}`}
              </div>
            </div>
            <div>
              <div className="adm-label">Транспорт</div>
              <div className="flex items-center gap-3">
                <Plate plate={b.plate} size="md" />
                <span className="text-sm font-semibold">{b.vehicleType ? VEHICLE_LABEL[b.vehicleType] : b.roomType ?? "—"}</span>
              </div>
              {b.transferNeeded && (
                <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-primary-deep"><Bus size={13} /> Трансфер до терминала</div>
              )}
            </div>
            <div>
              <div className="adm-label">Клиент</div>
              <div className="flex items-center gap-2">
                <User size={16} className="text-steel" />
                {b.client ? (
                  <Link href={`/admin/clients/${b.client.id}`} className="font-semibold hover:underline">{b.client.name ?? b.contactName ?? "Без имени"}</Link>
                ) : (
                  <span className="font-semibold">{b.contactName ?? "Без имени"}</span>
                )}
                {b.client && b.client._count.bookings > 1 && (
                  <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-[#0b7a4c]">{b.client._count.bookings} броней</span>
                )}
              </div>
              {b.client && (
                <Link href={`/admin/clients/${b.client.id}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary-deep hover:underline">
                  Карточка клиента →
                </Link>
              )}
              <div className="mt-1 flex items-center gap-3 font-mono text-sm">
                <a href={`tel:${b.contactPhone ?? ""}`} className="flex items-center gap-1 hover:text-primary-deep"><Phone size={14} /> {formatPhone(b.contactPhone)}</a>
                {b.client ? (
                  <ChannelLinks phone={b.client.phone} channels={b.client.channels} preferred={b.client.messenger} telegram={b.client.telegram} size="md" />
                ) : (
                  wa && <a href={wa} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[#128c7e] hover:underline"><MessageCircle size={14} /> WhatsApp</a>
                )}
              </div>
            </div>
            <div>
              <div className="adm-label">Оплата</div>
              <div className="flex items-baseline gap-2 font-mono tnum">
                <span className="text-2xl font-bold">{b.amount.toLocaleString("ru-RU")} ₽</span>
                {unpaid === 0 && b.amount > 0 ? (
                  <span className="text-sm font-semibold text-success">оплачено</span>
                ) : b.paidAmount > 0 ? (
                  <span className="text-sm font-semibold text-warning">не хватает {unpaid.toLocaleString("ru-RU")} ₽</span>
                ) : (
                  <span className="text-sm text-ink-muted">не оплачено</span>
                )}
              </div>
              <PaymentPanel bookingId={b.id} unpaid={unpaid} paid={b.paidAmount} payments={b.payments.map((p) => ({ id: p.id, kind: p.kind, method: p.method, amount: p.amount, paidAt: p.paidAt.toISOString(), note: p.note }))} />
            </div>
          </div>

          {b.comment && (
            <div className="mx-5 mb-5 rounded-lg bg-surface-warm px-3 py-2 text-sm">{b.comment}</div>
          )}

          <EditBooking
            booking={{
              id: b.id, name: b.contactName ?? "", plate: b.plate ?? "", vehicleType: b.vehicleType, dateFrom: b.dateFrom.toISOString().slice(0, 10), dateTo: b.dateTo.toISOString().slice(0, 10),
              timeFrom: b.timeFrom ?? "", timeTo: b.timeTo ?? "", amount: b.amount, transferNeeded: b.transferNeeded, source: b.source, comment: b.comment ?? "",
            }}
          />

          {b.outbox.length > 0 && (
            <div className="border-t border-line px-5 py-4">
              <div className="adm-label">Сообщения клиенту</div>
              <ul className="space-y-2">
                {b.outbox.map((o) => (
                  <li key={o.id} className="rounded-lg bg-surface-soft p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-muted">
                      <span className="font-semibold">{o.templateCode}</span>
                      <span>· {o.channel}</span>
                      <span className={`ml-auto rounded px-1.5 py-0.5 font-semibold ${o.status === "SENT" ? "bg-success/12 text-[#0b7a4c]" : o.status === "PENDING" ? "bg-warning/15 text-[#8a5a00]" : "bg-surface text-ink-muted"}`}>
                        {o.status === "SKIPPED_NO_PROVIDER" ? "канал не подключён" : o.status === "PENDING" ? `запланировано ${fmtDate(o.scheduledAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : o.status}
                      </span>
                    </div>
                    {o.renderedText}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <ActivityFeed
          bookingId={b.id}
          items={b.interactions.map((i) => ({ id: i.id, type: i.type, text: i.text, at: i.occurredAt.toISOString(), user: i.user?.name ?? null, channel: i.channel }))}
          createdBy={b.createdBy?.name ?? null}
          createdAt={b.createdAt.toISOString()}
        />
      </div>
    </div>
  );
}
