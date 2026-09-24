"use client";

// «Моя смена»: приход, уход, отмена, свои смены за месяц (Ф13 §8). dark — таблетка в шапке экрана поля + лист снизу,
// card — карточка вверху табеля. Всё приходит готовыми строками с сервера (MyShiftState), без ставок и чужих имён
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/admin/actions/bookings";
import { endMyShiftAction, myMonthAction, startMyShiftAction, undoMyShiftAction } from "@/app/admin/actions/staff";
import type { MyMonth, MyShiftResult, MyShiftState } from "@/server/services/staff";

const NO_CARD = "Вас ещё нет в табеле. Попросите владельца связать ваш логин с карточкой сотрудника";

export default function MyShift({ state: initial, variant }: { state: MyShiftState; variant: "dark" | "card" }) {
  const [state, setState] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setState(initial);
  }
  const [sheet, setSheet] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sheet) return;
    panel.current?.focus();
    const back = pill.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      back?.focus();
    };
  }, [sheet]);

  if (variant === "card")
    return (
      <section className="adm-card mb-4 p-4" aria-label="Моя рабочая смена">
        <Body state={state} setState={setState} />
      </section>
    );

  const open = state.linked ? state.open : null;
  return (
    <>
      <button
        ref={pill}
        type="button"
        onClick={() => setSheet(true)}
        aria-label={open ? `На смене с ${open.hhmm}` : "Моя смена"}
        className={`h-11 max-w-[88px] shrink-0 truncate rounded-full px-3 text-sm font-semibold ${
          open ? "bg-success text-navy-deep" : state.linked ? "bg-white/10 text-white" : "bg-white/10 text-white/50"
        }`}
      >
        {open ? `● ${open.hhmm}` : "Смена"}
      </button>
      {sheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Моя смена">
          <button aria-label="Закрыть" className="absolute inset-0 bg-black/50" onClick={() => setSheet(false)} />
          <div ref={panel} tabIndex={-1} className="relative max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink outline-none">
            <Body state={state} setState={setState} />
          </div>
        </div>
      )}
    </>
  );
}

function Body({ state, setState }: { state: MyShiftState; setState: (s: MyShiftState) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [pick, setPick] = useState<number>(-1);
  const [month, setMonth] = useState<MyMonth | null>(null);

  if (!state.linked)
    return (
      <div>
        <h2 className="text-base font-bold">Моя рабочая смена</h2>
        <p className="mt-1 text-sm text-ink-muted">{NO_CARD}</p>
      </div>
    );

  const run = (fn: () => Promise<ActionResult<MyShiftResult>>) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setMsg({ text: r.error, err: true });
      } else {
        setState(r.data.state);
        setMonth(null);
        setPick(-1);
        if (r.data.notice) setMsg({ text: r.data.notice, err: false });
      }
      router.refresh();
    });
  };
  const goMonth = (m: string) =>
    start(async () => {
      const r = await myMonthAction({ month: m });
      if (r.ok) setMonth(r.data);
      else setMsg({ text: r.error, err: true });
    });

  const { options, open, undo } = state;
  const selIdx = pick >= 0 && pick < options.length ? pick : Math.max(0, options.findIndex((o) => o.suggested));
  const sel = options[selIdx];
  const mon = month ?? state.month;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-bold">Моя рабочая смена</h2>
        <div className="text-sm text-ink-muted">
          {state.name} · {state.position}
        </div>
      </div>

      {msg && <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${msg.err ? "bg-danger/10 text-danger" : "bg-surface-soft"}`} role="status">{msg.text}</div>}

      {open ? (
        <div className="space-y-2">
          <div className="text-sm">
            <span className="font-semibold">На смене:</span> {open.label}, с {open.hhmm}
          </div>
          <button disabled={pending} onClick={() => run(() => endMyShiftAction())} className="h-12 w-full rounded-xl bg-primary font-semibold text-navy-deep disabled:opacity-50">
            Отметить уход
          </button>
        </div>
      ) : state.blocked ? (
        <p className="text-sm text-ink-muted">{state.blocked}</p>
      ) : options.length === 0 ? (
        <p className="text-sm text-ink-muted">Сейчас нет смены, которую можно отметить самому. Обратитесь к администратору</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Какую смену отметить">
            {options.map((o, i) => (
              <button
                key={`${o.date}${o.slot}`}
                type="button"
                aria-pressed={i === selIdx}
                onClick={() => setPick(i)}
                className={`h-10 rounded-full px-3 text-sm font-semibold ring-1 ring-inset ${i === selIdx ? "bg-navy-deep text-white ring-navy-deep" : "ring-line"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {sel?.late && <p className="text-xs text-ink-muted">Смена уже закончилась — приход запишется временем нажатия, с пометкой «отмечено позже».</p>}
          <button
            disabled={pending || !sel}
            onClick={() => sel && run(() => startMyShiftAction({ date: sel.date, slot: sel.slot }))}
            className="h-12 w-full rounded-xl bg-success font-semibold text-navy-deep disabled:opacity-50"
          >
            Отметить приход
          </button>
        </div>
      )}

      {undo && (
        <button disabled={pending} onClick={() => run(() => undoMyShiftAction())} className="text-sm font-semibold text-primary underline disabled:opacity-50">
          Отменить {undo.kind === "start" ? "приход" : "уход"}
        </button>
      )}

      <div className="border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(mon.prev)} disabled={pending} className="grid size-9 place-items-center rounded-full bg-surface-soft" aria-label="Прошлый месяц">‹</button>
          <span className="text-sm font-semibold">{mon.title}</span>
          {mon.next && (
            <button onClick={() => goMonth(mon.next!)} disabled={pending} className="grid size-9 place-items-center rounded-full bg-surface-soft" aria-label="Следующий месяц">›</button>
          )}
          <span className="ml-auto text-sm" data-my-count={mon.count}>Смен: {mon.count}</span>
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {mon.items.length === 0 && <li className="text-ink-muted">Смен нет</li>}
          {mon.items.map((it) => (
            <li key={it.key} className="flex gap-2">
              <span className="w-14 shrink-0 font-mono tnum">{it.label}</span>
              <span className="w-12 shrink-0">{it.slot}</span>
              <span className={it.state === "open" ? "font-semibold text-success" : it.state === "no-leave" || it.state === "late" ? "text-warning" : "text-ink-muted"}>{it.times}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
