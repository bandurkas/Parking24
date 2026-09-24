"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ShieldCheck, ShieldOff, X } from "lucide-react";
import { setAutoConfirmAction } from "@/app/admin/actions/settings";
import { gateBlockers, reserveText, type GateCheck } from "@/lib/autoconfirm-gate";
import { plural } from "@/lib/tariffs";

export type AutoConfirmPanelProps = {
  on: boolean;
  limit: number;
  capacity: number;
  checks: GateCheck[];
  changed: string | null; // «Включил Сергей Кулагин, 23 сентября, 14:05» — готовая строка по Москве
};

export default function AutoConfirmPanel({ on, limit, capacity, checks, changed }: AutoConfirmPanelProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blockers = gateBlockers(checks);
  const reserve = Math.max(0, capacity - limit);
  const rejectBlocked = blockers.some((b) => b.id !== "confirm_message");

  function apply(next: boolean) {
    setErr(null);
    start(async () => {
      const res = await setAutoConfirmAction(next, next ? ack : undefined);
      if (res.ok) {
        setOpen(false);
        setAck(false);
        router.refresh();
      } else setErr(res.error);
    });
  }

  const icon = (
    <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${on ? "bg-success/10 text-[#0b7a4c]" : "bg-surface text-ink-muted"}`}>
      {on ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
    </span>
  );

  return (
    <section className="adm-card mt-4 p-5" aria-label="Автоподтверждение">
      <div className="flex flex-wrap items-center gap-3">
        {icon}
        <div className="min-w-56 flex-1">
          <div className="font-semibold" data-testid="autoconfirm-state">
            {on
              ? `Автоподтверждение включено. Порог ${limit}, ${reserve > 0 ? `резерв ${reserve} ${plural(reserve, "место", "места", "мест")}` : "резерва нет"}`
              : "Автоподтверждение выключено"}
          </div>
          {!on && <div className="text-sm text-ink-muted">Каждую заявку с сайта подтверждает администратор.</div>}
          {changed && <div className="mt-0.5 text-xs text-ink-muted" data-testid="autoconfirm-changed">{changed}</div>}
        </div>
        {on ? (
          <button type="button" onClick={() => apply(false)} disabled={pending} className="adm-btn h-10 px-4 text-sm">
            {pending ? "…" : "Вернуть ручной режим"}
          </button>
        ) : (
          !open && (
            <button type="button" onClick={() => setOpen(true)} className="adm-btn-primary h-10 px-4 text-sm">
              Включить…
            </button>
          )
        )}
      </div>

      {on && blockers.length > 0 && (
        <div className="mt-4 rounded-lg bg-danger/5 p-3 text-sm text-danger">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={15} /> Не пройдено: {blockers.map((b) => b.title).join("; ")}
          </div>
          {rejectBlocked && <div className="mt-1">Отказ «мест нет» сейчас не уходит: такие заявки остаются администратору.</div>}
        </div>
      )}

      {!on && open && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="font-semibold">Что изменится после включения</div>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
            <li>Заявка, у которой на выбранные даты занято меньше {limit}, сразу получает статус «Ожидает оплаты». Администратор её не подтверждает.</li>
            <li>Клиенту без участия администратора уходит сообщение, что место забронировано.</li>
            <li>
              Если мест нет, заявка отклоняется автоматически, клиенту уходит отказ, администратор получает уведомление.{" "}
              <b>Отправленное сообщение отменить нельзя.</b>
            </li>
            <li>{reserveText(capacity, limit)}</li>
            <li>Грузовые, заявки без распознанного телефона и без рассчитанной цены всегда остаются администратору.</li>
          </ol>

          <div className="mt-4 font-semibold">Проверки</div>
          <ul className="mt-2 space-y-2 text-sm" aria-label="Проверки автоподтверждения">
            {checks.map((c) => (
              <li key={c.id} data-check={c.id} data-ok={c.ok ? "1" : "0"} className="flex gap-2">
                <span className={`mt-0.5 shrink-0 ${c.ok ? "text-[#0b7a4c]" : "text-danger"}`}>{c.ok ? <Check size={15} /> : <X size={15} />}</span>
                <span>
                  <span className={c.ok ? "" : "font-semibold text-danger"}>{c.title}</span>
                  {!c.ok && <span className="block text-xs text-ink-muted">{c.hint}</span>}
                </span>
              </li>
            ))}
          </ul>

          <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span>Понимаю: отказ клиенту уходит автоматически, отменить его нельзя</span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => apply(true)}
              disabled={pending || !ack || blockers.length > 0}
              className="adm-btn-primary h-10 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? "…" : "Включить автоподтверждение"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setAck(false); setErr(null); }} className="adm-btn-ghost h-10 px-3 text-sm">
              Отмена
            </button>
          </div>
          {blockers.length > 0 && <div className="mt-2 text-sm text-danger">Включить нельзя, пока не пройдены все проверки.</div>}
        </div>
      )}

      {err && (
        <div className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-danger">
          <AlertTriangle size={15} /> {err}
        </div>
      )}
    </section>
  );
}
