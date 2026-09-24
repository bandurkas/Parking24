"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { markNoticesReadAction } from "@/app/admin/actions/settings";

export type Notice = { id: string; kind: string; text: string; at: string; bookingId: string | null; bookingNumber: number | null };

const POLL_MS = 60_000;
const URGENT = new Set(["OVERSTAY", "UNPAID_CHECKOUT"]);

// Уведомления администратору. Начальный список — из AdminShell; дальше опрос /api/admin/notices раз в минуту
// и при открытии панели: layout при переходах между страницами не перерисовывается, и бейдж застывал бы
export default function NoticeBell({ notices }: { notices: Notice[] }) {
  const [items, setItems] = useState(notices);
  // Новые пропсы (router.refresh) заменяют состояние — без эффекта, сверкой при рендере
  const [fromProps, setFromProps] = useState(notices);
  if (fromProps !== notices) {
    setFromProps(notices);
    setItems(notices);
  }
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState(false);
  // Ответ опроса, ушедшего до «Прочитано», вернул бы погашенные — такой ответ отбрасываем
  const gen = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const g = gen.current;
    try {
      const res = await fetch("/api/admin/notices", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notices?: Notice[] };
      if (g === gen.current && Array.isArray(data.notices)) setItems(data.notices);
    } catch {}
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  // Шапка с backdrop-blur — контейнер для fixed-потомков, подложка на весь экран не работала: закрываем по клику снаружи
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  function toggle() {
    if (!open) void load();
    setOpen((v) => !v);
  }

  function readShown() {
    const ids = items.map((n) => n.id);
    setErr(false);
    start(async () => {
      const res = await markNoticesReadAction(ids);
      if (!res.ok) {
        setErr(true);
        return;
      }
      gen.current++;
      const read = new Set(ids);
      setItems((cur) => cur.filter((n) => !read.has(n.id)));
      await load();
    });
  }

  return (
    <div className="relative" ref={box}>
      <button
        onClick={toggle}
        className="relative grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
        aria-label={items.length ? `Уведомления: ${items.length}` : "Уведомлений нет"}
        aria-expanded={open}
      >
        <Bell size={18} />
        {items.length > 0 && (
          <span data-testid="notice-badge" className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[10px] font-bold leading-4 text-white">
            {items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </button>

      {open && (
        // На телефоне колокольчик не у края шапки — панель на всю ширину под шапкой, иначе уезжала за левый край
        <div role="region" aria-label="Уведомления" className="fixed inset-x-2 top-14 z-50 mt-1 overflow-hidden rounded-xl bg-white shadow-card-lg ring-1 ring-line sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:w-80">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="font-semibold">Уведомления</span>
            {items.length > 0 && (
              <button onClick={readShown} disabled={pending} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary-deep hover:underline">
                <Check size={13} /> {pending ? "…" : "Прочитано"}
              </button>
            )}
          </div>
          {err && <p className="px-4 pt-2 text-xs text-danger">Не удалось отметить, попробуйте ещё раз</p>}
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Новых уведомлений нет</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className={`px-4 py-3 text-sm ${URGENT.has(n.kind) ? "border-l-2 border-danger" : ""}`}>
                  {n.bookingId ? (
                    <Link href={`/admin/bookings/${n.bookingId}`} onClick={() => setOpen(false)} className="font-medium hover:underline">
                      {n.text}
                    </Link>
                  ) : (
                    <span className="font-medium">{n.text}</span>
                  )}
                  <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{n.at}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
