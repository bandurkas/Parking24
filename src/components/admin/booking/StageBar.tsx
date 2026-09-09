import { Check, Clock, X } from "lucide-react";

export type Stage = { key: string; label: string; at: string | null; by?: string | null; state: "done" | "current" | "todo" | "bad" };

// Полоса этапов брони: время каждого шага по факту (МСК)
export default function StageBar({ stages }: { stages: Stage[] }) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 px-5 py-3">
      {stages.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1">
          <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${s.state === "current" ? "bg-primary-soft ring-1 ring-primary/40" : s.state === "bad" ? "bg-danger/8" : s.state === "done" ? "bg-surface-soft" : "bg-transparent"}`}>
            <span className={`grid size-5 place-items-center rounded-full text-white ${s.state === "done" ? "bg-success" : s.state === "current" ? "bg-primary" : s.state === "bad" ? "bg-danger" : "bg-line"}`}>
              {s.state === "bad" ? <X size={11} /> : s.state === "todo" ? <Clock size={11} /> : <Check size={11} />}
            </span>
            <span className="leading-tight">
              <span className={`block text-xs font-semibold ${s.state === "todo" ? "text-ink-muted" : ""}`}>{s.label}</span>
              <span className="block font-mono text-[11px] tnum text-ink-muted">{s.at ?? "—"}{s.by && s.at ? ` · ${s.by}` : ""}</span>
            </span>
          </div>
          {i < stages.length - 1 && <span className="mx-0.5 h-px w-4 bg-line" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
