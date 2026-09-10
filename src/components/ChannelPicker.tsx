"use client";

import { Check } from "lucide-react";
import { CHANNEL_NAME, channelAvailable, type SiteChannel } from "@/lib/tariffs";

const ORDER: SiteChannel[] = ["WHATSAPP", "TELEGRAM", "MAX"];

export function ChannelLogo({ c, className = "size-5" }: { c: SiteChannel; className?: string }) {
  if (c === "WHATSAPP")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.6 1.1 2.7.1.2 1.9 2.9 4.6 4 1.7.7 2.3.8 3.1.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z" />
      </svg>
    );
  if (c === "TELEGRAM")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path fill="currentColor" d="M21.9 4.6 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 8.8-8c.4-.3-.1-.5-.6-.2L6.6 13.2l-4.7-1.5c-1-.3-1-1 .2-1.5l18.4-7.1c.9-.3 1.6.2 1.4 1.5Z" />
      </svg>
    );
  return (
    <span className={`grid place-items-center rounded-[6px] bg-current text-[11px] font-black leading-none ${className}`} aria-hidden>
      <span className="text-white">M</span>
    </span>
  );
}

// Один канал = куда придёт подтверждение. Радио-карточки с названием, выбранная — с галочкой.
export default function ChannelPicker({ value, onChange, invalid }: { value: SiteChannel | null; onChange: (c: SiteChannel) => void; invalid?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Куда прислать подтверждение" aria-invalid={invalid || undefined}>
      {ORDER.map((c) => {
        const on = value === c;
        const ok = channelAvailable(c);
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!ok}
            onClick={() => ok && onChange(c)}
            className={`relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 py-2.5 text-center transition-[border-color,background-color,color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              on
                ? "border-primary bg-primary-soft text-primary-deep shadow-[0_6px_18px_rgba(240,133,33,0.18)]"
                : ok
                  ? `bg-white text-ink hover:border-primary/50 hover:bg-primary-soft/40 ${invalid ? "border-danger/60" : "border-line"}`
                  : "cursor-not-allowed border-line bg-surface-soft text-ink-muted/60"
            }`}
          >
            {on && (
              <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-primary text-ink ring-2 ring-white" aria-hidden>
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
            <ChannelLogo c={c} className={`size-6 ${on ? "text-primary-dark" : ok ? "text-steel" : ""}`} />
            <span className="text-[13px] font-semibold leading-none">{CHANNEL_NAME[c]}</span>
            {!ok && <span className="text-[10px] font-medium uppercase tracking-wide">скоро</span>}
          </button>
        );
      })}
    </div>
  );
}
