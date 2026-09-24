"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTariffAction } from "@/app/admin/actions/tariffs";
import type { TariffView } from "@/server/services/tariff-admin";
import SaveNote, { type Note } from "./SaveNote";

const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

export default function TariffsForm({ title, rows, unitLabel }: { title: string; rows: TariffView[]; unitLabel: Record<string, string> }) {
  return (
    <section className="mt-4">
      <h2 className="font-semibold">{title}</h2>
      <ul className="adm-card mt-2 divide-y divide-line">
        {rows.map((t) => (
          <TariffRow key={t.id} t={t} unit={unitLabel[t.unit] ?? t.unit} />
        ))}
      </ul>
    </section>
  );
}

function TariffRow({ t, unit }: { t: TariffView; unit: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState(t.label);
  const [price, setPrice] = useState(String(t.price));
  const [active, setActive] = useState(t.isActive);
  const [note, setNote] = useState<Note>(null);

  const [seen, setSeen] = useState(t.version);
  if (t.version !== seen) {
    setSeen(t.version);
    setLabel(t.label);
    setPrice(String(t.price));
    setActive(t.isActive);
  }

  const dirty = label !== t.label || price !== String(t.price) || active !== t.isActive;
  const mismatch = t.sitePrice !== null && t.sitePrice !== Number(price);

  function save() {
    setNote(null);
    start(async () => {
      const res = await saveTariffAction(t.id, { label, price: Number(price), isActive: active, version: t.version });
      setNote(res.ok ? { ok: true, text: "Сохранено" } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5" data-tariff={t.code}>
      <div className="min-w-48 flex-1">
        <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label={`Название тарифа ${t.code}`} className="adm-input h-10" />
        <div className="mt-0.5 font-mono text-[11px] text-ink-muted">
          {t.code} · {unit}
          {t.minDays ? ` · от ${t.minDays} суток` : ""}
        </div>
      </div>
      <div>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          aria-label={`Цена ${t.code}`}
          className="adm-input h-10 w-28 font-mono tnum"
        />
        <div className={`mt-0.5 text-[11px] ${mismatch ? "font-semibold text-danger" : "text-ink-muted"}`} data-testid="site-price">
          {t.sitePrice === null ? "на сайте нет" : `на сайте: ${rub(t.sitePrice)}`}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-primary" aria-label={`Действует ${t.code}`} />
        действует
      </label>
      <button type="button" onClick={save} disabled={pending || !dirty} className="adm-btn-primary h-10 px-4 text-sm">
        {pending ? "…" : "Сохранить"}
      </button>
      {note && <SaveNote note={note} className="basis-full" />}
    </li>
  );
}
