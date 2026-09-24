"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLinksAction } from "@/app/admin/actions/links";
import type { SiteLinks } from "@/server/services/settings";
import SaveNote, { type Note } from "./SaveNote";

type Field = { key: keyof SiteLinks; label: string; hint: string };

// Поля показывают сохранённое значение, а не подставленное: иначе «Сохранить» зашило бы запасной адрес навсегда (Р15)
export default function LinksForm({ links, fields }: { links: SiteLinks; fields: Field[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState<SiteLinks>(links);
  const [note, setNote] = useState<Note>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    start(async () => {
      const res = await saveLinksAction(v);
      setNote(res.ok ? { ok: true, text: "Сохранено" } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="adm-card mt-3 divide-y divide-line" aria-label="Ссылки для сообщений">
      {fields.map((f) => (
        <label key={f.key} className="block px-5 py-4">
          <span className="font-semibold">{f.label}</span>
          <span className="mt-0.5 block text-xs text-ink-muted">{f.hint}</span>
          <input
            value={v[f.key]}
            onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
            inputMode="url"
            placeholder="https://…"
            aria-label={f.label}
            className="adm-input mt-2 font-mono text-sm"
          />
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button type="submit" disabled={pending} className="adm-btn-primary h-11 px-5">{pending ? "Сохраняем…" : "Сохранить ссылки"}</button>
        <SaveNote note={note} />
      </div>
    </form>
  );
}
