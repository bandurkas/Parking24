"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { BookingSource, BookingStatus, ResourceKind, Role, VehicleType } from "@prisma/client";
import { PIPELINE, STATUS_LABEL, STATUS_DOT, TRANSITIONS, SOURCE_LABEL, VEHICLE_SHORT } from "@/lib/crm/labels";
import { correctStatusAction, transitionAction } from "@/app/admin/actions/bookings";
import BookingCard from "./BookingCard";
import type { OverstayView } from "../OverstayChip";
import { overstayConfirmText } from "@/lib/overstay";
import { CLOSED_STATUSES } from "@/lib/correction";

export type KanbanItem = {
  id: string; number: number; status: BookingStatus; name: string | null; phone: string | null; plate: string | null;
  vehicleType: VehicleType | null; roomType: string | null; dateFrom: string; dateTo: string; timeFrom: string | null; days: number;
  amount: number; paidAmount: number; source: BookingSource; transferNeeded: boolean;
  overstay: OverstayView | null;
};

// «Отклонена» — своей колонкой: из неё бронь возвращают в «Ожидает оплаты» за счёт резерва
const COLUMNS: BookingStatus[] = [...PIPELINE, "REJECTED", "CANCELLED"];

export default function KanbanBoard({ items: initial, kind, role }: { items: KanbanItem[]; kind: ResourceKind; role: Role }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [active, setActive] = useState<KanbanItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  // «Отменить» после перетаскивания: возврат в прежний статус с записью в ленту
  const [undo, setUndo] = useState<{ id: string; number: number; from: BookingStatus; to: BookingStatus } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, start] = useTransition();
  // клик без перетаскивания открывает бронь; после drag клик глотаем
  const dragged = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }));

  // синхронизация после router.refresh()
  // сумма и перестой — в ключе: иначе после выезда с начислением или в новые сутки карточка застынет
  const serverKey = useMemo(() => initial.map((i) => [i.id, i.status, i.paidAmount, i.amount, i.dateTo, i.overstay?.days ?? 0, i.overstay?.shown ?? 0].join(":")).join("|"), [initial]);
  const [seenKey, setSeenKey] = useState(serverKey);
  if (serverKey !== seenKey) {
    setSeenKey(serverKey);
    setItems(initial);
  }

  const byStatus = useMemo(() => {
    const m = new Map<BookingStatus, KanbanItem[]>();
    for (const c of COLUMNS) m.set(c, []);
    for (const it of items) {
      const col = it.status === "NO_SHOW" ? "CANCELLED" : it.status;
      m.get(col)?.push(it);
    }
    return m;
  }, [items]);

  function onDragStart(e: DragStartEvent) {
    dragged.current = true;
    setActive(items.find((i) => i.id === e.active.id) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    setTimeout(() => (dragged.current = false), 150);
    const to = e.over?.id as BookingStatus | undefined;
    const it = items.find((i) => i.id === e.active.id);
    if (!to || !it || it.status === to) return;
    if (!TRANSITIONS[it.status].includes(to)) {
      setError(`Нельзя: «${STATUS_LABEL[it.status]}» → «${STATUS_LABEL[to]}»`);
      setTimeout(() => setError(null), 2500);
      return;
    }
    let reason: string | undefined;
    if (to === "CANCELLED" || to === "REJECTED") {
      const r = window.prompt(`Причина ${to === "CANCELLED" ? "отмены" : "отклонения"} (необязательно):`, "");
      if (r === null) return;
      reason = r || undefined;
    }
    // Выезд брони в перестое — то же подтверждение с суммой долга, что в карточке (§12 в.1)
    if (to === "CHECKED_OUT" && it.overstay && role !== "GUARD" && !window.confirm(overstayConfirmText({ days: it.overstay.days, rate: it.overstay.rate || null }))) return;
    const prev = items;
    setItems(prev.map((i) => (i.id === it.id ? { ...i, status: to } : i)));
    start(async () => {
      const res = await transitionAction(it.id, to, reason);
      if (!res.ok) {
        setItems(prev);
        setError(res.error);
        setTimeout(() => setError(null), 6000);
      } else {
        router.refresh();
        setUndo({ id: it.id, number: it.number, from: it.status, to });
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndo(null), 8000);
      }
    });
  }

  function doUndo() {
    if (!undo) return;
    const u = undo;
    setUndo(null);
    start(async () => {
      const res = await correctStatusAction(u.id, u.from, "отмена перетаскивания на доске");
      if (!res.ok) { setError(res.error); setTimeout(() => setError(null), 3000); }
      else router.refresh();
    });
  }

  // Из закрытых статусов вернуть может только владелец (DECISIONS §2) — администратору тост без «Отменить»
  const canUndo = undo != null && (role === "OWNER" || !CLOSED_STATUSES.includes(undo.to));

  return (
    <DndContext id={`kanban-${kind}`} sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {error && (
        <div role="alert" className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-white shadow-card-lg lg:bottom-4">
          {error}
        </div>
      )}
      {undo && !error && (
        <div role="status" className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-navy-deep px-4 py-2.5 text-sm text-white shadow-card-lg lg:bottom-4">
          <span>№{undo.number}: {STATUS_LABEL[undo.from]} → <b>{STATUS_LABEL[undo.to]}</b></span>
          {canUndo ? (
            <button onClick={doUndo} className="rounded-lg bg-white/15 px-3 py-1 font-semibold hover:bg-white/25">Отменить</button>
          ) : (
            <span className="text-xs text-white/70">вернуть может владелец — „Исправить статус“</span>
          )}
        </div>
      )}
      <div className="kanban-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((status) => (
          <Column key={status} status={status} items={byStatus.get(status) ?? []} activeFrom={active?.status ?? null} kind={kind} onOpen={(id) => { if (!dragged.current) router.push(`/admin/bookings/${id}`); }} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <BookingCard item={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, items, activeFrom, kind, onOpen }: { status: BookingStatus; items: KanbanItem[]; activeFrom: BookingStatus | null; kind: ResourceKind; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const allowed = activeFrom ? TRANSITIONS[activeFrom].includes(status) : true;
  const sum = items.reduce((s, i) => s + i.amount, 0);
  const isTerminal = status === "CANCELLED";
  const muted = isTerminal || status === "REJECTED";
  return (
    <section
      ref={setNodeRef}
      className={`flex w-[272px] shrink-0 flex-col rounded-xl transition ${
        muted ? "bg-surface/60" : "bg-surface"
      } ${activeFrom && !allowed ? "opacity-40" : ""} ${isOver && allowed ? "ring-2 ring-primary" : ""}`}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
        <h2 className="text-sm font-bold">{isTerminal ? "Отменена / No-show" : STATUS_LABEL[status]}</h2>
        <span className="ml-auto font-mono text-xs text-ink-muted">{items.length}</span>
      </header>
      {!muted && sum > 0 && (
        <div className="px-3 pb-2 font-mono text-[11px] tnum text-ink-muted">{sum.toLocaleString("ru-RU")} ₽</div>
      )}
      <div className="kanban-scroll flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {items.map((it, i) => (
          <Draggable key={it.id} item={it} index={i} kind={kind} onOpen={onOpen} />
        ))}
        {items.length === 0 && <div className="grid flex-1 place-items-center py-6 text-xs text-ink-muted/70">пусто</div>}
      </div>
    </section>
  );
}

function Draggable({ item, index, kind, onOpen }: { item: KanbanItem; index: number; kind: ResourceKind; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  void kind;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`Открыть бронь №${item.number}`}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(item.id); }}
      style={{ transform: CSS.Translate.toString(transform), animationDelay: `${Math.min(index, 12) * 30}ms` }}
      className={`board-row cursor-pointer touch-manipulation ${isDragging ? "opacity-30" : ""}`}
    >
      <BookingCard item={item} />
    </div>
  );
}

export { SOURCE_LABEL, VEHICLE_SHORT };
