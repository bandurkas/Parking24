"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { markNoticesReadAction } from "@/app/admin/actions/settings";

export type Notice = { id: string; text: string; at: string; bookingId: string | null; bookingNumber: number | null };

// Уведомления администратору: первое применение — автоотклонение заявки, когда нет мест.
export default function NoticeBell({ notices }: { notices: Notice[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function readAll() {
    start(async () => {
      await markNoticesReadAction();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
        aria-label={notices.length ? `Уведомления: ${notices.length}` : "Уведомлений нет"}
        aria-expanded={open}
      >
        <Bell size={18} />
        {notices.length > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[10px] font-bold leading-4 text-white">
            {notices.length > 9 ? "9+" : notices.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Закрыть" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-80 overflow-hidden rounded-xl bg-white shadow-card-lg ring-1 ring-line">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="font-semibold">Уведомления</span>
              {notices.length > 0 && (
                <button onClick={readAll} disabled={pending} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary-deep hover:underline">
                  <Check size={13} /> {pending ? "…" : "Прочитано"}
                </button>
              )}
            </div>
            {notices.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">Новых уведомлений нет</p>
            ) : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto">
                {notices.map((n) => (
                  <li key={n.id} className="px-4 py-3 text-sm">
                    {n.bookingId ? (
                      <Link href={`/admin/bookings/${n.bookingId}`} onClick={() => setOpen(false)} className="font-medium hover:underline">
                        {n.text}
                      </Link>
                    ) : (
                      <span className="font-medium">{n.text}</span>
                    )}
                    <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{n.at}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
