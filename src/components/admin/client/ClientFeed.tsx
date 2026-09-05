"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Phone, MessageSquare, Globe, MessageCircle, ArrowRightLeft, CreditCard, Settings2, Send } from "lucide-react";
import type { Channel, InteractionType } from "@prisma/client";
import { addClientNoteAction } from "@/app/admin/actions/clients";

export type FeedItem = { id: string; type: InteractionType; text: string; at: string; user: string | null; channel: Channel | null; bookingId: string | null; bookingNumber: number | null };

const ICON: Record<InteractionType, typeof Phone> = {
  CALL: Phone, MESSAGE: MessageSquare, SITE_LEAD: Globe, COMMENT: MessageCircle, STATUS_CHANGE: ArrowRightLeft, PAYMENT: CreditCard, SYSTEM: Settings2,
};
const TONE: Record<InteractionType, string> = {
  CALL: "bg-steel/15 text-navy", MESSAGE: "bg-steel/15 text-navy", SITE_LEAD: "bg-primary-soft text-primary-deep", COMMENT: "bg-warning/15 text-[#8a5a00]",
  STATUS_CHANGE: "bg-navy-deep text-white", PAYMENT: "bg-success/15 text-[#0b7a4c]", SYSTEM: "bg-surface text-ink-muted",
};
const FILTERS: { id: string; label: string; types: InteractionType[] | null }[] = [
  { id: "all", label: "Всё", types: null },
  { id: "notes", label: "Заметки", types: ["COMMENT"] },
  { id: "status", label: "Статусы", types: ["STATUS_CHANGE"] },
  { id: "pay", label: "Оплаты", types: ["PAYMENT"] },
  { id: "msg", label: "Сообщения и звонки", types: ["MESSAGE", "CALL", "SITE_LEAD"] },
  { id: "sys", label: "Система", types: ["SYSTEM"] },
];

export default function ClientFeed({ clientId, items }: { clientId: string; items: FeedItem[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("all");
  const [pending, start] = useTransition();
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter);
    return f?.types ? items.filter((i) => f.types!.includes(i.type)) : items;
  }, [items, filter]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    start(async () => {
      const res = await addClientNoteAction(clientId, text);
      if (res.ok) { setText(""); router.refresh(); }
    });
  }

  return (
    <aside className="adm-card flex flex-col lg:max-h-[calc(100vh-9rem)]">
      <div className="border-b border-line px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Лента</div>
        <h2 className="font-bold">История клиента</h2>
      </div>
      <form onSubmit={submit} className="flex gap-2 border-b border-line p-3">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Заметка о клиенте… (Enter — сохранить)" className="adm-input h-10 text-sm" />
        <button type="submit" disabled={pending || !text.trim()} className="adm-btn-primary h-10 w-10 shrink-0 p-0" aria-label="Сохранить заметку"><Send size={16} /></button>
      </form>
      <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${filter === f.id ? "bg-navy-deep text-white" : "text-ink-muted hover:bg-surface"}`}>{f.label}</button>
        ))}
      </div>
      <ol className="flex-1 space-y-3 overflow-y-auto p-4">
        {shown.map((i, idx) => {
          const Icon = ICON[i.type];
          return (
            <li key={i.id} className="board-row flex gap-3" style={{ animationDelay: `${Math.min(idx, 10) * 30}ms` }}>
              <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${TONE[i.type]}`}><Icon size={13} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-snug">{i.text}</div>
                <div className="mt-0.5 font-mono text-[11px] text-ink-muted">
                  {i.at}{i.bookingId && i.bookingNumber && <> · <Link href={`/admin/bookings/${i.bookingId}`} className="text-primary-deep hover:underline">№{i.bookingNumber}</Link></>}{i.user && ` · ${i.user}`}{i.channel && ` · ${i.channel}`}
                </div>
              </div>
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">Пока пусто</li>}
      </ol>
    </aside>
  );
}
