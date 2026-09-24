"use client";

import { useState, useTransition } from "react";
import { MessagesSquare, RefreshCw } from "lucide-react";
import { chatFrameAction } from "@/app/admin/actions/messaging";

type Target = { bookingId?: string; clientId?: string } | null;

// Окно переписки Wazzup. Ссылку отдаёт сервер (ключ в браузер не попадает); в карточке окно открывается
// по кнопке, чтобы карточка не ждала Wazzup. «Обновить окно» — если ссылка протухла при долгой работе вкладки
export default function ChatPanel({ target, title, initialUrl = null, initialError = null, tall = false }: { target: Target; title: string; initialUrl?: string | null; initialError?: string | null; tall?: boolean }) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [err, setErr] = useState<string | null>(initialError);
  const [pending, start] = useTransition();

  function open() {
    setErr(null);
    start(async () => {
      const r = await chatFrameAction(target);
      if (r.ok) setUrl(r.url);
      else setErr(r.error);
    });
  }

  return (
    <section className="adm-card overflow-hidden" aria-label={title} data-testid="chat-panel">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <MessagesSquare size={16} className="text-steel" />
        <h2 className="font-bold">{title}</h2>
        {url ? (
          <button type="button" onClick={open} disabled={pending} className="adm-btn ml-auto h-8 gap-1 px-3 text-xs">
            <RefreshCw size={13} className={pending ? "animate-spin" : ""} /> Обновить окно
          </button>
        ) : (
          <button type="button" onClick={open} disabled={pending} className="adm-btn-primary ml-auto h-8 px-3 text-xs">
            {pending ? "…" : "Открыть чат"}
          </button>
        )}
      </header>
      {err && <p className="px-4 py-3 text-sm text-danger" role="alert">{err}</p>}
      {url && (
        <iframe
          key={url}
          src={url}
          title={title}
          allow="microphone *; clipboard-write *"
          className={`block w-full border-0 ${tall ? "h-[calc(100vh-12rem)] min-h-[32rem]" : "h-[36rem]"}`}
          data-testid="chat-frame"
        />
      )}
    </section>
  );
}
