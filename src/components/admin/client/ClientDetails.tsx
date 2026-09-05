"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import type { Channel, ClientStatus } from "@prisma/client";
import { updateClientAction } from "@/app/admin/actions/clients";
import { CHANNEL_LABEL, CLIENT_STATUS_LABEL, CLIENT_TAGS } from "@/lib/crm/labels";

export type ClientForm = {
  clientId: string; name: string; status: ClientStatus; email: string; messenger: Channel | ""; telegram: string; birthday: string; company: string; inn: string; tags: string[]; note: string;
};

const STATUSES: ClientStatus[] = ["LEAD", "ACTIVE", "VIP", "LOST", "BLOCKED"];
const CHANNELS: Channel[] = ["WHATSAPP", "TELEGRAM", "MAX", "PHONE", "SMS", "EMAIL"];

function Row({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2 text-sm">
      <div className="text-ink-muted">{k}</div>
      <div className={`min-w-0 break-words ${mono ? "font-mono tnum" : ""} ${v === "—" ? "text-ink-muted" : ""}`}>{v}</div>
    </div>
  );
}

export default function ClientDetails({ form, view }: { form: ClientForm; view: { birthday: string; created: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(form);
  const [tagInput, setTagInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof ClientForm>(k: K, v: ClientForm[K]) => setF((p) => ({ ...p, [k]: v }));

  function addTag(t: string) {
    const tag = t.trim().toLowerCase();
    if (!tag || f.tags.includes(tag)) return setTagInput("");
    set("tags", [...f.tags, tag]);
    setTagInput("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    start(async () => {
      const res = await updateClientAction(f);
      if (!res.ok) return setErrors(res.fieldErrors ?? { _: res.error });
      setOpen(false);
      router.refresh();
    });
  }

  const dash = (s: string) => (s ? s : "—");

  if (!open) {
    return (
      <section className="adm-card">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="font-bold">Данные</h2>
          <button onClick={() => { setF(form); setOpen(true); }} className="adm-btn-ghost ml-auto h-8 gap-1.5 px-2.5 text-xs"><Pencil size={13} /> Изменить</button>
        </header>
        <div className="divide-y divide-line px-4">
          <Row k="Email" v={form.email ? <a href={`mailto:${form.email}`} className="hover:underline">{form.email}</a> : "—"} />
          <Row k="Мессенджер" v={form.messenger ? CHANNEL_LABEL[form.messenger] : "—"} />
          <Row k="Telegram" v={form.telegram ? <a href={`https://t.me/${form.telegram}`} target="_blank" rel="noreferrer" className="hover:underline">@{form.telegram}</a> : "—"} />
          <Row k="День рождения" v={dash(view.birthday)} mono />
          <Row k="Компания" v={dash(form.company)} />
          <Row k="ИНН" v={dash(form.inn)} mono />
          <Row k="Заметка" v={form.note ? <span className="whitespace-pre-wrap">{form.note}</span> : "—"} />
          <Row k="В базе с" v={view.created} mono />
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="adm-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="font-bold">Данные</h2>
        <button type="button" onClick={() => setOpen(false)} className="adm-btn-ghost ml-auto size-8 p-0" aria-label="Закрыть"><X size={15} /></button>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <label className="adm-label">Имя</label>
          <input value={f.name} onChange={(e) => set("name", e.target.value)} className="adm-input h-10" placeholder="Имя Фамилия" />
        </div>
        <div>
          <label className="adm-label">Статус</label>
          <select value={f.status} onChange={(e) => set("status", e.target.value as ClientStatus)} className="adm-input h-10 text-sm">
            {STATUSES.map((s) => <option key={s} value={s}>{CLIENT_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="adm-label">Email</label>
          <input value={f.email} onChange={(e) => set("email", e.target.value)} className="adm-input h-10" type="email" aria-invalid={!!errors.email} />
          {errors.email && <p className="adm-err">{errors.email}</p>}
        </div>
        <div>
          <label className="adm-label">Предпочитаемый канал</label>
          <select value={f.messenger} onChange={(e) => set("messenger", e.target.value as Channel | "")} className="adm-input h-10 text-sm">
            <option value="">—</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="adm-label">Telegram</label>
          <input value={f.telegram} onChange={(e) => set("telegram", e.target.value)} className="adm-input h-10 font-mono" placeholder="@username" />
        </div>
        <div>
          <label className="adm-label">День рождения</label>
          <input value={f.birthday} onChange={(e) => set("birthday", e.target.value)} type="date" className="adm-input h-10 font-mono text-sm" aria-invalid={!!errors.birthday} />
        </div>
        <div>
          <label className="adm-label">Компания</label>
          <input value={f.company} onChange={(e) => set("company", e.target.value)} className="adm-input h-10" placeholder="ООО / ИП" />
        </div>
        <div>
          <label className="adm-label">ИНН</label>
          <input value={f.inn} onChange={(e) => set("inn", e.target.value.replace(/\D/g, "").slice(0, 12))} className="adm-input h-10 font-mono" inputMode="numeric" aria-invalid={!!errors.inn} />
          {errors.inn && <p className="adm-err">{errors.inn}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="adm-label">Теги</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white p-2">
            {f.tags.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-deep">
                {t}<button type="button" onClick={() => set("tags", f.tags.filter((x) => x !== t))} aria-label={`Убрать ${t}`}><X size={11} /></button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); } }}
              onBlur={() => addTag(tagInput)}
              placeholder="тег + Enter"
              className="h-7 min-w-32 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {CLIENT_TAGS.filter((t) => !f.tags.includes(t)).map((t) => (
              <button key={t} type="button" onClick={() => addTag(t)} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted hover:border-primary hover:text-primary-deep">+ {t}</button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="adm-label">Заметка</label>
          <textarea value={f.note} onChange={(e) => set("note", e.target.value)} rows={3} className="adm-input h-auto py-2 text-sm" placeholder="Особенности, пожелания, договорённости" />
        </div>
        {errors._ && <p className="adm-err sm:col-span-2">{errors._}</p>}
      </div>
      <div className="flex gap-2 border-t border-line px-4 py-3">
        <button type="submit" disabled={pending} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Сохранить"}</button>
        <button type="button" onClick={() => setOpen(false)} className="adm-btn-ghost h-10 px-3 text-sm">Отмена</button>
      </div>
    </form>
  );
}
