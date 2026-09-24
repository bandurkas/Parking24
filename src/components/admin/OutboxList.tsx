import Link from "next/link";
import type { Channel, OutboxStatus } from "@prisma/client";
import { CHANNEL_LABEL } from "@/lib/crm/labels";
import { fmtDateTime } from "@/server/lib/dates";
import { outboxStatusText } from "@/server/automations/sender-core";
import { deliveryLabel } from "@/server/messaging/wazzup/status";
import DeliveryMark from "./DeliveryMark";

// Очередь сообщений клиенту в карточке брони и клиента. Серверный компонент: время по Москве считается здесь.
// Подписи держат e2e Ф5; Ф14 дописывает к строке «доставлено» / «прочитано»
export type OutboxListItem = {
  id: string;
  templateCode: string;
  channel: Channel;
  status: OutboxStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  sendingAt: Date | null;
  attempts: number;
  lastError: string | null;
  renderedText: string;
  deliveredAt?: Date | null;
  readAt?: Date | null;
  failCode?: string | null;
  booking?: { id: string; number: number } | null;
};

const TONE: Record<OutboxStatus, string> = {
  PENDING: "bg-warning/15 text-[#8a5a00]",
  SENT: "bg-success/12 text-[#0b7a4c]",
  FAILED: "bg-danger/8 text-danger",
  CANCELLED: "bg-surface text-ink-muted",
  SKIPPED_NO_PROVIDER: "bg-surface text-ink-muted",
  EXPIRED: "bg-surface text-ink-muted",
  SKIPPED: "bg-surface text-ink-muted",
};

export default function OutboxList({ items, showBooking = false }: { items: OutboxListItem[]; showBooking?: boolean }) {
  const now = new Date();
  return (
    <ul className="space-y-2" data-testid="outbox-list">
      {items.map((o) => (
        <li key={o.id} className="rounded-lg bg-surface-soft p-3 text-sm" data-testid="outbox-item" data-status={o.status}>
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted">
            <span className="font-mono font-semibold" data-testid="outbox-code">{o.templateCode}</span>
            <span>· {CHANNEL_LABEL[o.channel]}</span>
            {showBooking && o.booking && (
              <Link href={`/admin/bookings/${o.booking.id}`} className="font-mono hover:underline">· №{o.booking.number}</Link>
            )}
            <span className={`ml-auto rounded px-1.5 py-0.5 font-semibold ${TONE[o.status]}`} data-testid="outbox-status">
              {outboxStatusText(o, now, fmtDateTime)}
            </span>
            <DeliveryMark mark={deliveryLabel({ deliveredAt: o.deliveredAt ?? null, readAt: o.readAt ?? null, failCode: o.failCode ?? null })} />
          </div>
          <div className="whitespace-pre-line text-ink">{o.renderedText}</div>
        </li>
      ))}
    </ul>
  );
}
