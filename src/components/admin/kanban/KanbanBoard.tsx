"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { BookingSource, BookingStatus, ResourceKind, VehicleType } from "@prisma/client";
import { PIPELINE, STATUS_LABEL, STATUS_DOT, TRANSITIONS, SOURCE_LABEL, VEHICLE_SHORT } from "@/lib/crm/labels";
import { transitionAction } from "@/app/admin/actions/bookings";
import BookingCard from "./BookingCard";

export type KanbanItem = {
  id: string; number: number; status: BookingStatus; name: string | null; phone: string | null; plate: string | null;
  vehicleType: VehicleType | null; roomType: string | null; dateFrom: string; dateTo: string; timeFrom: string | null; days: number;
  amount: number; paidAmount: number; source: BookingSource; transferNeeded: boolean;
};

const COLUMNS: BookingStatus[] = [...PIPELINE, "CANCELLED"];

export default function KanbanBoard({ items: initial, kind }: { items: KanbanItem[]; kind: ResourceKind }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [active, setActive] = useState<KanbanItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  // клик без перетаскивания открывает бронь; после drag клик глотаем
  const dragged = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }));

  // синхронизация после router.refresh()
  const serverKey = useMemo(() => initial.map((i) => i.id + i.status + i.paidAmount).join("|"), [initial]);
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
    if (to === "CANCELLED") {
      const r = window.prompt("Причина отмены (необязательно):", "");
      if (r === null) return;
      reason = r || undefined;
    }
    const prev = items;
    setItems(prev.map((i) => (i.id === it.id ? { ...i, status: to } : i)));
    start(async () => {
      const res = await transitionAction(it.id, to, reason);
      if (!res.ok) {
        setItems(prev);
        setError(res.error);
        setTimeout(() => setError(null), 3000);
      } else router.refresh();
    });
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {error && (
        <div role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-white shadow-card-lg">
          {error}
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
  return (
    <section
      ref={setNodeRef}
      className={`flex w-[272px] shrink-0 flex-col rounded-xl transition ${
        isTerminal ? "bg-surface/60" : "bg-surface"
      } ${activeFrom && !allowed ? "opacity-40" : ""} ${isOver && allowed ? "ring-2 ring-primary" : ""}`}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
        <h2 className="text-sm font-bold">{isTerminal ? "Отменена / No-show" : STATUS_LABEL[status]}</h2>
        <span className="ml-auto font-mono text-xs text-ink-muted">{items.length}</span>
      </header>
      {!isTerminal && sum > 0 && (
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
