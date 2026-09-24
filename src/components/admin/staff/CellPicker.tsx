"use client";

// Выбор сотрудника для клетки: вчерашний в этой колонке → сотрудники должности → остальные; «Нет в списке? Добавить»
import { useState, useTransition } from "react";
import { quickAddEmployeeAction } from "@/app/admin/actions/staff";
import type { BoardPerson } from "@/server/services/staff";
import { REASON_MIN, type EditCheck } from "@/lib/workshift";
import { Modal } from "./ShiftGrid";

export default function CellPicker({
  title, check, people, positionId, prevIds, onPick, onAdded, onClose,
}: {
  title: string;
  check: EditCheck;
  people: BoardPerson[];
  positionId: string;
  prevIds: string[];
  onPick: (p: BoardPerson, reason?: string) => void;
  onAdded: (p: BoardPerson) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const need = check.ok && check.needReason;
  const blocked = need && reason.trim().length < REASON_MIN;
  const rank = (p: BoardPerson) => (prevIds.includes(p.id) ? 0 : p.positionId === positionId ? 1 : 2);
  const list = people
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru"));
  const pick = (p: BoardPerson) => onPick(p, reason.trim() || undefined);

  function add() {
    setErr(null);
    start(async () => {
      const r = await quickAddEmployeeAction({ name: name.trim(), positionId });
      if (!r.ok) return setErr(r.error);
      onAdded(r.data);
      pick(r.data);
    });
  }

  return (
    <Modal label="Кто работал" onClose={onClose}>
      <div className="font-semibold">{title}</div>
      {!check.ok ? (
        <p className="mt-3 text-sm text-ink-muted">{check.error}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {need && (
            <input className="adm-input" placeholder="Причина (обязательна для даты старше вчерашней)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Причина" autoFocus />
          )}
          {people.length > 10 && <input className="adm-input" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />}
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {list.length === 0 && <li className="py-2 text-sm text-ink-muted">Сотрудников нет</li>}
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={blocked} onClick={() => pick(p)} className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-soft">
                  {p.name}
                  {rank(p) === 0 && <span className="ml-auto text-xs text-ink-muted">вчера</span>}
                </button>
              </li>
            ))}
          </ul>
          {adding ? (
            <div className="flex gap-2">
              <input className="adm-input" placeholder="Имя сотрудника" value={name} onChange={(e) => setName(e.target.value)} aria-label="Имя нового сотрудника" autoFocus />
              <button className="adm-btn-primary" disabled={pending || blocked || name.trim().length < 2} onClick={add}>Добавить</button>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="text-sm font-semibold text-primary underline">Нет в списке? Добавить</button>
          )}
          {err && <p className="adm-err">{err}</p>}
        </div>
      )}
    </Modal>
  );
}
