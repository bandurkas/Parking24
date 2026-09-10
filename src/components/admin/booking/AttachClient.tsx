"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { attachClientAction } from "@/app/admin/actions/clients";

// Заявка без телефона (сайт → WhatsApp): привязать к клиенту по номеру из чата
export default function AttachClient({ bookingId, name }: { bookingId: string; name: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [n, setN] = useState(name ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button onClick={() => setOpen(true)} className="adm-btn h-8 gap-1.5 px-2.5 text-xs"><Link2 size={13} /> Привязать к клиенту</button>;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setErr(null); start(async () => { const r = await attachClientAction(bookingId, phone, n); if (!r.ok) setErr(r.error); else router.refresh(); }); }}
      className="mt-1 grid gap-2 rounded-lg border border-line bg-surface-soft p-3 sm:grid-cols-[11rem_1fr_auto]"
    >
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 9xx xxx-xx-xx" className="adm-input h-10 font-mono text-sm" inputMode="tel" autoFocus aria-label="Телефон клиента" />
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Имя (если знаем)" className="adm-input h-10 text-sm" />
      <button type="submit" disabled={pending || phone.replace(/\D/g, "").length < 10} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Привязать"}</button>
      <p className="text-[11px] text-ink-muted sm:col-span-3">Если клиент с таким номером уже есть, заявка попадёт в его карточку.</p>
      {err && <p className="adm-err sm:col-span-3">{err}</p>}
    </form>
  );
}
