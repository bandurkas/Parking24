"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setConsentAction } from "@/app/admin/actions/clients";

type Consent = { on: boolean; at: string | null; source?: string | null };

function Toggle({ on, label, hint, danger = false, disabled, onChange }: { on: boolean; label: string; hint: string; danger?: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? (danger ? "bg-danger" : "bg-success") : "bg-line"}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block font-mono text-[11px] text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

export default function ConsentPanel({ clientId, personal, marketing, dnd, campaigns }: { clientId: string; personal: Consent; marketing: Consent; dnd: boolean; campaigns: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (kind: "personal" | "marketing" | "dnd", on: boolean) =>
    start(async () => { const r = await setConsentAction({ clientId, kind, on }); if (r.ok) router.refresh(); });
  const canMail = marketing.on && !dnd && personal.on;
  return (
    <section className="adm-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="font-bold">Согласия и рассылки</h2>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${canMail ? "bg-success/12 text-[#0b7a4c] ring-success/40" : "bg-surface text-ink-muted ring-line"}`}>
          {canMail ? "можно писать об акциях" : "рассылки запрещены"}
        </span>
      </header>
      <div className="divide-y divide-line px-4">
        <Toggle on={personal.on} disabled={pending} onChange={(v) => set("personal", v)} label="Согласие на обработку ПД" hint={personal.on ? `с ${personal.at}${personal.source ? ` · ${personal.source}` : ""}` : "не получено"} />
        <Toggle on={marketing.on} disabled={pending} onChange={(v) => set("marketing", v)} label="Согласие на рассылки об акциях" hint={marketing.on ? `с ${marketing.at}` : "не получено"} />
        <Toggle on={dnd} danger disabled={pending} onChange={(v) => set("dnd", v)} label="Не беспокоить" hint={dnd ? "клиент просил не писать" : "ограничений нет"} />
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-line px-4 py-3 text-sm">
        <div><div className="text-ink-muted">Кампании</div><div className="font-mono tnum">{campaigns || "—"}</div></div>
        <div><div className="text-ink-muted">Сегменты</div><div className="text-ink-muted">— <span className="text-[11px]">(появятся с модулем рассылок)</span></div></div>
      </div>
    </section>
  );
}
