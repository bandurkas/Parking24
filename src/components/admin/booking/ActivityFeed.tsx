"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageSquare, Globe, MessageCircle, ArrowRightLeft, CreditCard, Settings2, Send } from "lucide-react";
import type { Channel, InteractionType } from "@prisma/client";
import { addCommentAction } from "@/app/admin/actions/bookings";

type Item = { id: string; type: InteractionType; text: string; at: string; user: string | null; channel: Channel | null };

const ICON: Record<InteractionType, typeof Phone> = {
  CALL: Phone, MESSAGE: MessageSquare, SITE_LEAD: Globe, COMMENT: MessageCircle, STATUS_CHANGE: ArrowRightLeft, PAYMENT: CreditCard, SYSTEM: Settings2,
};
const TONE: Record<InteractionType, string> = {
  CALL: "bg-steel/15 text-navy", MESSAGE: "bg-steel/15 text-navy", SITE_LEAD: "bg-primary-soft text-primary-deep", COMMENT: "bg-surface text-ink",
  STATUS_CHANGE: "bg-navy-deep text-white", PAYMENT: "bg-success/15 text-[#0b7a4c]", SYSTEM: "bg-surface text-ink-muted",
};

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
}

export default function ActivityFeed({ bookingId, items, createdBy, createdAt }: { bookingId: string; items: Item[]; createdBy: string | null; createdAt: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    start(async () => {
      const res = await addCommentAction(bookingId, text);
      if (res.ok) {
        setText("");
        router.refresh();
      }
    });
  }

  return (
    <aside className="adm-card flex max-h-[calc(100vh-9rem)] flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Лента</div>
        <h2 className="font-bold">История</h2>
      </div>
      <form onSubmit={submit} className="flex gap-2 border-b border-line p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Комментарий… (Enter — отправить)"
          className="adm-input h-10 text-sm"
        />
        <button type="submit" disabled={pending || !text.trim()} className="adm-btn-primary h-10 w-10 shrink-0 p-0" aria-label="Отправить">
          <Send size={16} />
        </button>
      </form>
      <ol className="flex-1 space-y-3 overflow-y-auto p-4">
        {items.map((i, idx) => {
          const Icon = ICON[i.type];
          return (
            <li key={i.id} className="board-row flex gap-3" style={{ animationDelay: `${Math.min(idx, 10) * 30}ms` }}>
              <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${TONE[i.type]}`}>
                <Icon size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-snug">{i.text}</div>
                <div className="mt-0.5 font-mono text-[11px] text-ink-muted">
                  {when(i.at)}{i.user && ` · ${i.user}`}{i.channel && ` · ${i.channel}`}
                </div>
              </div>
            </li>
          );
        })}
        <li className="flex gap-3 text-xs text-ink-muted">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface"><Settings2 size={13} /></span>
          <div>Создано {when(createdAt)}{createdBy && ` · ${createdBy}`}</div>
        </li>
      </ol>
    </aside>
  );
}
