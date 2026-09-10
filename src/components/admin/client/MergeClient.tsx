"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, X } from "lucide-react";
import { searchClientsAction, type ClientHit } from "@/app/admin/actions/bookings";
import { mergeClientsAction } from "@/app/admin/actions/clients";
import { formatPhone } from "@/lib/phone";

// Объединить ЭТУ карточку с другой: текущая (source) вливается в выбранную (target)
export default function MergeClient({ clientId, phone, name }: { clientId: string; phone: string; name: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [target, setTarget] = useState<ClientHit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => (q.trim().length < 3 ? setHits([]) : searchClientsAction(q).then((r) => setHits(r.filter((h) => h.id !== clientId)))), 250);
    return () => clearTimeout(t);
  }, [q, open, clientId]);

  function merge() {
    if (!target) return;
    if (!window.confirm(`Объединить ${name ?? "без имени"} ${formatPhone(phone)} с ${target.name ?? "без имени"} ${formatPhone(target.phone)}?\nБрони, авто и история перейдут во вторую карточку, номер ${formatPhone(phone)} станет дополнительным. Отменить нельзя.`)) return;
    start(async () => {
      const r = await mergeClientsAction(clientId, target.id);
      if (!r.ok) return setErr(r.error);
      router.push(`/admin/clients/${r.data.targetId}`);
    });
  }

  if (!open) return <button onClick={() => setOpen(true)} className="adm-btn-ghost h-8 gap-1.5 px-2.5 text-xs text-ink-muted"><GitMerge size={13} /> Объединить с другим клиентом</button>;

  return (
    <div className="rounded-xl border border-line bg-surface-soft p-3">
      <div className="flex items-center gap-2">
        <GitMerge size={14} className="text-steel" />
        <span className="text-sm font-semibold">С кем объединить (дубль этого клиента)</span>
        <button onClick={() => { setOpen(false); setTarget(null); setQ(""); }} className="adm-btn-ghost ml-auto size-8 p-0" aria-label="Закрыть"><X size={14} /></button>
      </div>
      {!target ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Телефон, имя или госномер другой карточки" className="adm-input mt-2 h-10 text-sm" autoFocus />
          {hits.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
              {hits.map((h) => (
                <li key={h.id}>
                  <button onClick={() => setTarget(h)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-soft">
                    <span className="font-semibold">{h.name ?? "Без имени"}</span>
                    <span className="font-mono text-xs text-ink-muted">{formatPhone(h.phone)}</span>
                    <span className="ml-auto font-mono text-[11px] text-ink-muted">{h.bookings} бр.{h.vehicles[0]?.plate ? ` · ${h.vehicles[0].plate}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>Эта карточка → <b>{target.name ?? "Без имени"}</b> <span className="font-mono text-xs">{formatPhone(target.phone)}</span></span>
          <button disabled={pending} onClick={merge} className="adm-btn-primary h-9 px-3 text-sm">{pending ? "…" : "Объединить"}</button>
          <button onClick={() => setTarget(null)} className="adm-btn-ghost h-9 px-3 text-sm">Другой</button>
        </div>
      )}
      {err && <p className="adm-err mt-1">{err}</p>}
    </div>
  );
}
