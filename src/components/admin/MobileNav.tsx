"use client";

// Нижняя панель + лист «Ещё» для телефона (МФ-UI §5.8). Видна только < lg.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, Plus } from "lucide-react";
import type { SessionUser } from "@/server/auth/session";
import { ROLE_LABEL } from "@/lib/crm/labels";
import LogoutButton, { type OpenShiftBrief } from "./LogoutButton";
import { openQuickBooking } from "./QuickBookingDrawer";
import GlobalSearch from "./GlobalSearch";
import { GUARD_SCREEN, NAV } from "./nav";

// Панель — выборка из NAV (ревью №2 п.5): переименование пункта в nav.ts не разъедется с баром
const flat = NAV.flatMap((g) => g.items);
const pick = (href: string) => {
  const item = flat.find((n) => n.href === href);
  if (!item) throw new Error(`nav.ts: нет пункта ${href} для нижней панели`); // fail-fast с говорящим текстом (ревью р.2)
  return item;
};
const BAR = [pick("/admin/boards/parking"), pick("/admin/today"), pick("/admin/clients")];
const BAR_HREFS = new Set(BAR.map((b) => b.href));

export default function MobileNav({ user, shift = null }: { user: SessionUser; shift?: OpenShiftBrief }) {
  const path = usePathname();
  const [sheet, setSheet] = useState(false);
  const close = () => setSheet(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Переход по любой ссылке закрывает лист: сравнение пути прямо в рендере,
  // без setState в эффекте (паттерн serverKey из KanbanBoard)
  const [seenPath, setSeenPath] = useState(path);
  if (path !== seenPath) {
    setSeenPath(path);
    if (sheet) setSheet(false);
  }

  useEffect(() => {
    if (!sheet) return;
    // Фокус внутрь диалога (как у QuickBookingDrawer), возврат на «Ещё» при закрытии
    (panel.current?.querySelector("input") ?? panel.current)?.focus();
    const back = moreBtn.current; // копия для cleanup: ref к моменту закрытия может смениться
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      back?.focus();
    };
  }, [sheet]);

  // Шторка заявки открылась откуда угодно (хоткей N, топбар) — лист закрывается: двух диалогов не бывает
  useEffect(() => {
    const onDrawer = () => setSheet(false);
    window.addEventListener("p24:quick-booking", onDrawer); // EVT из QuickBookingDrawer
    return () => window.removeEventListener("p24:quick-booking", onDrawer);
  }, []);

  // «+»: сначала закрыть лист — на экране не может быть двух role="dialog"
  function onPlus() {
    setSheet(false);
    openQuickBooking();
  }

  const isActive = (href: string) => path === href || path.startsWith(href + "/");

  // Группы для листа: без пунктов, уже вынесенных на панель
  const groups = NAV.filter((g) => !g.ownerOnly || user.role === "OWNER")
    .map((g) => ({ ...g, items: g.items.filter((n) => !BAR_HREFS.has(n.href)) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      {sheet && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true" aria-label="Меню">
          <button aria-label="Закрыть" className="absolute inset-0 bg-black/40" onClick={close} />
          <div ref={panel} tabIndex={-1} className="relative max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] outline-none">
            <GlobalSearch inSheet onNavigate={close} />
            {groups.map((g, gi) => (
              <div key={g.title ?? gi} className="mt-3">
                {g.title && (
                  <div className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-steel">{g.title}</div>
                )}
                {g.items.map((n) =>
                  n.ready ? (
                    <Link key={n.href} href={n.href} onClick={close} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-surface-soft">
                      <n.icon size={19} strokeWidth={1.8} className="text-steel" /> {n.label}
                    </Link>
                  ) : (
                    <span key={n.href} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-muted opacity-50">
                      <n.icon size={19} strokeWidth={1.8} /> {n.label}
                      <span className="ml-auto rounded bg-surface px-1.5 text-[10px] uppercase">скоро</span>
                    </span>
                  ),
                )}
              </div>
            ))}
            <div className="mt-3 border-t border-line pt-3">
              <Link href={GUARD_SCREEN.href} onClick={close} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-surface-soft">
                <GUARD_SCREEN.icon size={19} strokeWidth={1.8} className="text-steel" /> {GUARD_SCREEN.label}
              </Link>
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-ink-muted">
                <span className="truncate font-semibold text-ink">{user.name}</span>
                <span className="shrink-0">{ROLE_LABEL[user.role]}</span>
              </div>
              <LogoutButton shift={shift} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-danger hover:bg-danger/8">
                <LogOut size={19} strokeWidth={1.8} /> Выйти
              </LogoutButton>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Навигация">
        <div className="grid grid-cols-5">
          {BAR.slice(0, 2).map((b) => (
            <BarLink key={b.href} item={b} active={isActive(b.href)} onGo={close} />
          ))}
          <button type="button" onClick={onPlus} className="flex flex-col items-center py-1" aria-label="Новая заявка">
            <span className="-mt-4 grid size-11 place-items-center rounded-full bg-primary text-navy-deep shadow-card">
              <Plus size={24} strokeWidth={2.5} />
            </span>
          </button>
          <BarLink item={BAR[2]} active={isActive(BAR[2].href)} onGo={close} />
          <button
            ref={moreBtn}
            type="button"
            onClick={() => setSheet((s) => !s)}
            className={`flex flex-col items-center gap-0.5 py-2 ${sheet ? "text-primary" : "text-ink-muted"}`}
            aria-label="Ещё"
            aria-expanded={sheet}
          >
            <Menu size={22} strokeWidth={1.8} />
            <span className="text-[10px] font-medium">Ещё</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function BarLink({ item, active, onGo }: { item: (typeof BAR)[number]; active: boolean; onGo: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onGo}
      className={`flex flex-col items-center gap-0.5 py-2 ${active ? "text-primary" : "text-ink-muted"}`}
    >
      <item.icon size={22} strokeWidth={active ? 2.2 : 1.8} />
      <span className="text-[10px] font-medium">{item.label}</span>
    </Link>
  );
}
