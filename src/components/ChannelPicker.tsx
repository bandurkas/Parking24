"use client";

import { CHANNEL_NAME, channelAvailable, type SiteChannel } from "@/lib/tariffs";

const ORDER: SiteChannel[] = ["WHATSAPP", "TELEGRAM", "MAX"];

function Logo({ c }: { c: SiteChannel }) {
  if (c === "WHATSAPP")
    return (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.6 1.1 2.7.1.2 1.9 2.9 4.6 4 1.7.7 2.3.8 3.1.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z" />
      </svg>
    );
  if (c === "TELEGRAM")
    return (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <path fill="currentColor" d="M21.9 4.6 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 8.8-8c.4-.3-.1-.5-.6-.2L6.6 13.2l-4.7-1.5c-1-.3-1-1 .2-1.5l18.4-7.1c.9-.3 1.6.2 1.4 1.5Z" />
      </svg>
    );
  return (
    <span className="grid size-5 place-items-center rounded-[5px] bg-current text-[10px] font-black leading-none" aria-hidden>
      <span className="text-white">M</span>
    </span>
  );
}

// Мультивыбор с «основным»: первый выбранный — основной; клик по другому выбранному делает основным его; клик по основному снимает его.
export default function ChannelPicker({ channels, primary, onChange }: { channels: SiteChannel[]; primary: SiteChannel | null; onChange: (channels: SiteChannel[], primary: SiteChannel | null) => void }) {
  function tap(c: SiteChannel) {
    if (!channelAvailable(c)) return;
    if (!channels.includes(c)) return onChange([...channels, c], primary ?? c);
    if (primary !== c) return onChange(channels, c);
    const rest = channels.filter((x) => x !== c);
    onChange(rest, rest[0] ?? null);
  }
  return (
    <div className="flex flex-col items-end gap-1.5 pb-2.5">
      <span className="text-xs font-medium text-ink-muted">Куда написать</span>
      <div className="flex gap-1.5" role="group" aria-label="Мессенджер для связи">
        {ORDER.map((c) => {
          const on = channels.includes(c);
          const main = primary === c;
          const ok = channelAvailable(c);
          return (
            <button
              key={c}
              type="button"
              disabled={!ok}
              onClick={() => tap(c)}
              aria-pressed={on}
              aria-label={`${CHANNEL_NAME[c]}${main ? ", основной" : on ? ", выбран" : ""}${ok ? "" : ", скоро"}`}
              title={ok ? CHANNEL_NAME[c] : `${CHANNEL_NAME[c]} — скоро`}
              className={`relative flex h-11 min-w-11 flex-col items-center justify-center rounded-xl border px-2 transition ${
                main ? "border-primary bg-primary-soft text-primary-deep ring-2 ring-primary/30"
                : on ? "border-primary/60 bg-white text-primary-deep"
                : ok ? "border-line bg-surface-soft text-ink-muted hover:border-primary/60 hover:text-primary-deep"
                : "border-line bg-surface-soft text-ink-muted/50"
              }`}
            >
              <Logo c={c} />
              {main && <span className="absolute -bottom-2 rounded-full bg-primary px-1.5 text-[9px] font-bold uppercase tracking-wide text-ink">основной</span>}
              {!ok && <span className="absolute -bottom-2 rounded-full bg-line px-1.5 text-[9px] font-semibold text-ink-muted">скоро</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
