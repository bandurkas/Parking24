"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { checkConnectionAction, setChatsAction, setProviderAction, setupWazzupAction } from "@/app/admin/actions/messaging";
import type { MessagingOverview } from "@/server/messaging/wazzup/status";

// Карточка «Сообщения» (Ф14): провайдер, каналы и их состояние, диалоги месяца, проверка связи. Только владелец
export default function MessagingCard(p: MessagingOverview) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const bad = p.providerOn && (!p.channels.length || p.channels.some((c) => !c.ok));

  function run(fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
      router.refresh();
    });
  }

  return (
    <section className="adm-card mt-4 p-4" aria-label="Сообщения" data-testid="messaging-card">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`grid size-10 place-items-center rounded-lg ${bad ? "bg-danger/10 text-danger" : "bg-primary-soft text-primary-deep"}`}>
          <MessageCircle size={18} />
        </span>
        <div className="min-w-48 flex-1">
          <div className="font-semibold">Сообщения клиентам · Wazzup</div>
          <div className={`text-sm ${p.keyPresent ? "text-ink-muted" : "text-danger"}`} data-testid="provider-state">
            {!p.keyPresent ? "Провайдер не подключён: на сервере нет ключа WAZZUP_API_KEY" : p.providerOn ? "Отправка через Wazzup включена" : "Отправка выключена — сообщения копятся в очереди"}
          </div>
        </div>
        <button type="button" disabled={pending || !p.keyPresent} onClick={() => run(() => setProviderAction(!p.providerOn))} className={`${p.providerOn ? "adm-btn" : "adm-btn-primary"} h-10 px-4 text-sm`}>
          {p.providerOn ? "Выключить отправку" : "Включить отправку"}
        </button>
      </div>

      {p.keyPresent && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <div>
            <div className="adm-label">Каналы{p.checkedAt && <span className="font-normal normal-case"> · проверено {p.checkedAt}</span>}</div>
            {p.channels.length === 0 ? (
              <p className="text-ink-muted">Список каналов ещё не получен — нажмите «Проверить связь».</p>
            ) : (
              <ul className="space-y-1">
                {p.channels.map((c) => (
                  <li key={c.id} className="flex items-center gap-2" data-testid="wz-channel">
                    <span className={`size-2 rounded-full ${c.ok ? "bg-success" : "bg-danger"}`} aria-hidden />
                    <span className="font-semibold">{c.name}</span>
                    {c.number && <span className="font-mono text-xs text-ink-muted">{c.number}</span>}
                    <span className={c.ok ? "text-ink-muted" : "font-semibold text-danger"}>{c.state}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span data-testid="wz-dialogs">Диалогов в этом месяце: <b className="font-mono">{p.dialogs.count}</b> из {p.dialogs.limit}</span>
            <span className={p.webhook.ok ? "text-ink-muted" : "text-warning"}>
              Вебхук: {p.webhook.ok ? (p.webhookAt ? `зарегистрирован ${p.webhookAt}` : "не зарегистрирован") : p.webhook.message}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={() => run(checkConnectionAction)} className="adm-btn h-9 px-3 text-sm">
              Проверить связь
            </button>
            <button type="button" disabled={pending || !p.webhook.ok} onClick={() => run(setupWazzupAction)} className="adm-btn h-9 px-3 text-sm">
              Подключить вебхук и пользователей
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => setChatsAction(!p.chatsOn))} className="adm-btn h-9 px-3 text-sm" data-testid="chats-toggle">
              {p.chatsOn ? "Выключить окно чатов" : "Включить окно чатов"}
            </button>
            {pending && <span className="text-ink-muted">…</span>}
          </div>
        </div>
      )}
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-success" : "text-danger"}`} role="status" data-testid="wz-result">
          {msg.text}
        </p>
      )}
    </section>
  );
}
