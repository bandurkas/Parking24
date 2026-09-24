"use client";

// Выбор сотрудника для клетки: сначала сотрудники этой должности, потом остальные (подмена)
import type { BoardPerson } from "@/server/services/staff";
import { Modal } from "./ShiftGrid";

export default function CellPicker({
  title, people, positionId, onPick, onClose,
}: {
  title: string;
  people: BoardPerson[];
  positionId: string;
  onPick: (p: BoardPerson) => void;
  onClose: () => void;
}) {
  const rank = (p: BoardPerson) => (p.positionId === positionId ? 0 : 1);
  const list = [...people].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru"));
  return (
    <Modal label="Кто работал" onClose={onClose}>
      <div className="font-semibold">{title}</div>
      <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
        {list.length === 0 && <li className="py-2 text-sm text-ink-muted">Сотрудников нет — их заводит владелец в справочнике</li>}
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)} className="flex h-10 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-surface-soft">
              {p.name}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
