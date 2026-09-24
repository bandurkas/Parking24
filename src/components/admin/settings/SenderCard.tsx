"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { expireStaleOutboxAction, saveSenderAction, setFakeModeAction, setProviderAction, setSenderModeAction } from "@/app/admin/actions/sender";

type Mode = "off" | "dry" | "on";
type FakeMode = "ok" | "fail" | "bad" | "down";

// Все времена — уже по Москве (fmtDateTime на сервере), телефоны — уже отформатированы
export type SenderCardProps = {
  mode: Mode;
  enabled: boolean;
  provider: string;
  providerLabel: string;
  providerMissing: boolean;
  options: { code: string; label: string }[];
  fakeMode: FakeMode | null;
  maxAgeHours: number;
  allowlistOnly: boolean;
  allowlist: string[];
  envAllowlist: string[];
  queue: { pending: number; oldest: string | null; waiting: number; stale: number };
  day: { sent: number; failed: number; skipped: number; expired: number };
  lastTick: string | null;
  dry: { at: string; wouldSend: number; items: { number: number | null; code: string; channel: string; phone: string; outcome: string }[] } | null;
  failStreak: number;
  stopAfterFails: number;
};

const MODE_LABEL: Record<Mode, string> = { off: "Выключено", dry: "Пробно", on: "Включено" };
const FAKE_LABEL: Record<FakeMode, string> = { ok: "успех", fail: "сбой сети (повтор)", bad: "номера нет (без повтора)", down: "канал недоступен" };

export default function SenderCard(p: SenderCardProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [only, setOnly] = useState(p.allowlistOnly);
  const [list, setList] = useState(p.allowlist.join("\n"));
  const [age, setAge] = useState(String(p.maxAgeHours));

  function run(fn: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>, done: string | ((data: unknown) => string)) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ ok: true, text: typeof done === "string" ? done : done(res.data) });
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });
  }

  const state =
    p.mode === "off" ? "Выключено · сообщения копятся в очереди, клиентам ничего не уходит"
    : p.mode === "dry" ? `Пробно · клиентам ничего не уходит${p.dry ? `, в последнем тике ушло бы ${p.dry.wouldSend}` : ""}`
    : p.enabled ? `Включено · отправляет через «${p.providerLabel}»`
    : `Включено · ${p.provider === "none" || p.providerMissing ? "канал не подключён" : p.allowlistOnly || p.envAllowlist.length ? "только на разрешённые номера, реальным клиентам не уходит" : "канал не отвечает или ещё не было тика"}`;
  const warn = p.mode === "on" && !p.enabled;

  return (
    <section className="adm-card mt-4 divide-y divide-line" aria-label="Отправка сообщений">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className={`grid size-10 place-items-center rounded-lg ${warn ? "bg-warning/15 text-[#8a5a00]" : "bg-primary-soft text-primary-deep"}`}>
          <Send size={18} />
        </span>
        <div className="min-w-48 flex-1">
          <div className="font-semibold">Отправка сообщений</div>
          <div className={`text-sm ${warn ? "text-[#8a5a00]" : "text-ink-muted"}`} data-testid="sender-state">{state}</div>
          {p.failStreak > 0 && p.stopAfterFails > 0 && (
            <div className="mt-1 text-xs text-danger">Ошибок канала подряд: {p.failStreak} из {p.stopAfterFails} — после {p.stopAfterFails} отправка выключится сама</div>
          )}
        </div>
        <div className="flex overflow-hidden rounded-lg ring-1 ring-line" role="group" aria-label="Режим отправки">
          {(["off", "dry", "on"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={p.mode === m}
              disabled={pending || p.mode === m}
              onClick={() => run(() => setSenderModeAction(m), `Режим: ${MODE_LABEL[m].toLowerCase()}`)}
              className={`h-10 px-3 text-sm font-semibold ${p.mode === m ? "bg-navy-deep text-white" : "bg-white hover:bg-surface-soft"}`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <span className="min-w-48 flex-1">
          <span className="font-semibold">Канал</span>
          <span className="block text-xs text-ink-muted">
            {p.providerMissing ? "Выбранный провайдер на этом сервере недоступен — сообщения не уходят" : "Через какого провайдера уходят сообщения (WhatsApp, Telegram, MAX)"}
          </span>
        </span>
        <select value={p.providerMissing ? "none" : p.provider} disabled={pending} onChange={(e) => run(() => setProviderAction(e.target.value), "Провайдер сохранён")} className="adm-input h-10 w-auto text-sm" aria-label="Провайдер">
          {p.options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        {p.fakeMode && (
          <select value={p.fakeMode} disabled={pending} onChange={(e) => run(() => setFakeModeAction(e.target.value as FakeMode), "Ответ заглушки сохранён")} className="adm-input h-10 w-auto text-sm" aria-label="Ответ заглушки">
            {(Object.keys(FAKE_LABEL) as FakeMode[]).map((m) => <option key={m} value={m}>Заглушка: {FAKE_LABEL[m]}</option>)}
          </select>
        )}
      </div>

      <form
        className="space-y-3 px-4 py-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveSenderAction({ allowlistOnly: only, allowlist: list, maxAgeHours: Number(age) }), "Предохранители сохранены");
        }}
      >
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="mt-1" />
          <span>
            <span className="font-semibold">Только на номера из списка (режим теста)</span>
            <span className="block text-xs text-ink-muted">Пока включено и список пуст, не уходит ни одно сообщение. Выключить — когда тест закончен и заказчик согласен.</span>
          </span>
        </label>
        <textarea value={list} onChange={(e) => setList(e.target.value)} rows={3} placeholder={"+7 999 000-00-00\nпо номеру на строку"} className="adm-input w-full font-mono text-sm" aria-label="Разрешённые номера" />
        {p.envAllowlist.length > 0 && (
          <div className="text-xs text-[#8a5a00]">На сервере задан OUTBOX_ALLOWLIST — сообщения уходят только на: {p.envAllowlist.join(", ")}</div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span>Не отправлять сообщения старше</span>
          <input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="adm-input h-10 w-20 font-mono" aria-label="Порог по возрасту, часов" />
          <span>ч от назначенного времени</span>
          <button type="submit" disabled={pending} className="adm-btn-primary ml-auto h-10 px-4">{pending ? "…" : "Сохранить"}</button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid="sender-queue">
        <div className="min-w-48 flex-1">
          <div>
            В очереди <b className="font-mono">{p.queue.pending}</b>
            {p.queue.oldest && <>, самое раннее — {p.queue.oldest}</>}
            {p.queue.waiting > 0 && <>, не отправлено с причиной — {p.queue.waiting}</>}
          </div>
          <div className="text-xs text-ink-muted">
            За сутки: отправлено {p.day.sent} · не доставлено {p.day.failed} · пропущено {p.day.skipped} · устарело {p.day.expired}
            {p.lastTick && <> · последний тик {p.lastTick}</>}
          </div>
        </div>
        <button
          type="button"
          disabled={pending || p.queue.stale === 0}
          onClick={() => run(() => expireStaleOutboxAction(), (d) => `Убрано из очереди: ${(d as { count: number }).count}`)}
          className="adm-btn h-10 px-4 text-sm"
        >
          Убрать устаревшие из очереди ({p.queue.stale})
        </button>
      </div>

      {p.mode === "dry" && p.dry && (
        <div className="px-4 py-3 text-sm" data-testid="sender-dry">
          <div className="adm-label">Пробный проход {p.dry.at}: ушло бы {p.dry.wouldSend}</div>
          {p.dry.items.length === 0 ? (
            <div className="text-xs text-ink-muted">Очередь пуста</div>
          ) : (
            <ul className="space-y-1 font-mono text-xs">
              {p.dry.items.map((i, k) => (
                <li key={k}>{i.number ? `№${i.number}` : "без брони"} · {i.code} · {i.channel} · {i.phone} — {i.outcome}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg && <div className={`px-4 py-2 text-xs ${msg.ok ? "text-success" : "text-danger"}`} role="status">{msg.text}</div>}
    </section>
  );
}
