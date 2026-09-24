"use client";

// Сетка табеля (Ф13 §8): месяц × колонки «должность + слот», оптимистичные отметки без revalidatePath (реш. 4.3.10)
import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { markShiftAction, unmarkShiftAction } from "@/app/admin/actions/staff";
import type { BoardMark, BoardPerson, StaffBoard } from "@/server/services/staff";
import { SLOT_LABEL, cellKey, countsOf, gridEditCheck, monthOf, slotHours, type Column } from "@/lib/workshift";
import CellPicker from "./CellPicker";
import MonthSummary from "./MonthSummary";

const ICON: Record<BoardMark["state"], string> = { open: "●", "no-leave": "!", late: "⏱", manual: "✎", closed: "" };
const ICON_TITLE: Record<BoardMark["state"], string> = { open: "на смене", "no-leave": "уход не отмечен", late: "отмечено позже", manual: "вручную", closed: "" };

type Cell = { col: Column; date: string };

export default function ShiftGrid({ board }: { board: StaffBoard }) {
  const [marks, setMarks] = useState(board.marks);
  const people = board.people;
  const [cell, setCell] = useState<Cell | null>(null);
  const [chip, setChip] = useState<BoardMark | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const role = board.isOwner ? "OWNER" : "ADMIN";
  const person = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const posName = useMemo(() => new Map(board.positions.map((p) => [p.id, p.name])), [board.positions]);
  const byCell = useMemo(() => {
    const map = new Map<string, BoardMark[]>();
    for (const m of marks) map.set(cellKey(m.positionId, m.slot, m.date), [...(map.get(cellKey(m.positionId, m.slot, m.date)) ?? []), m]);
    return map;
  }, [marks]);
  const summary = countsOf(
    marks.map((m) => ({ employeeId: m.employeeId, employee: person.get(m.employeeId)?.name ?? "—", positionId: m.positionId, position: posName.get(m.positionId) ?? "—", slot: m.slot, hours: m.hours })),
  );
  const groups = board.columns.reduce<{ positionId: string; name: string; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1];
    if (last?.positionId === c.positionId) last.span++;
    else acc.push({ positionId: c.positionId, name: c.name, span: 1 });
    return acc;
  }, []);
  const editable = (c: Column, date: string) => date <= board.today && c.configured && c.positionActive;

  async function mark(p: BoardPerson, c: Column, date: string) {
    setErr(null);
    const tmp: BoardMark = { id: `tmp-${p.id}-${date}-${c.slot}`, employeeId: p.id, positionId: c.positionId, date, slot: c.slot, state: "manual", hint: "Поставлено вручную", hours: slotHours(c.slot) };
    setMarks((ms) => [...ms, tmp]);
    const r = await markShiftAction({ employeeId: p.id, positionId: c.positionId, date, slot: c.slot });
    if (r.ok) setMarks((ms) => (ms.some((m) => m.id === r.data.id) ? ms.filter((m) => m.id !== tmp.id) : ms.map((m) => (m.id === tmp.id ? { ...m, id: r.data.id } : m))));
    else {
      setMarks((ms) => ms.filter((m) => m.id !== tmp.id));
      setErr(r.error);
    }
  }

  async function unmark(m: BoardMark) {
    setErr(null);
    setMarks((ms) => ms.filter((x) => x.id !== m.id));
    const r = await unmarkShiftAction({ id: m.id });
    if (!r.ok) {
      setMarks((ms) => [...ms, m]);
      setErr(r.error);
    }
  }

  const today = board.today;
  const thisMonth = monthOf(today);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-bold">Табель · {board.title}</h1>
        <Link href={`/admin/staff?m=${board.prev}`} className="adm-btn px-3" aria-label="Прошлый месяц">‹</Link>
        <Link href={`/admin/staff?m=${board.next}`} className="adm-btn px-3" aria-label="Следующий месяц">›</Link>
        {board.month !== thisMonth && <Link href={`/admin/staff?m=${thisMonth}`} className="adm-btn">Сегодня</Link>}
        <span className="flex-1" />
        <Link href="/admin/staff/report" className="adm-btn">Отчёт</Link>
        {board.isOwner && <Link href="/admin/staff/people" className="adm-btn">Справочник</Link>}
      </div>
      {err && <div className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" role="alert" data-grid-error>{err}</div>}

      <div>
        <div className="adm-card overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface-soft text-[11px] uppercase tracking-wide text-ink-muted">
              <tr>
                <th rowSpan={2} className="sticky left-0 z-10 bg-surface-soft px-2 py-1.5 text-left">Дата</th>
                {groups.map((g) => (
                  <th key={g.positionId} colSpan={g.span} className="border-l border-line px-2 py-1.5 text-center" data-pos={g.positionId} data-pos-name={g.name}>{g.name}</th>
                ))}
              </tr>
              <tr>
                {board.columns.map((c) => (
                  <th key={`${c.positionId}${c.slot}`} className="border-l border-line px-2 py-1 text-center font-medium">{SLOT_LABEL[c.slot].toLowerCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.days.map((d) => {
                const future = d.date > today;
                return (
                  <tr key={d.date} data-date={d.date} className={`border-t border-line ${d.date === today ? "bg-primary-soft" : d.weekend ? "bg-surface-soft/60" : ""}`}>
                    <td className={`sticky left-0 z-10 whitespace-nowrap px-2 py-1 font-mono text-xs tnum ${d.date === today ? "bg-primary-soft font-bold" : "bg-white"} ${d.weekend ? "text-danger" : ""}`}>
                      {Number(d.date.slice(8))} {d.weekday}
                    </td>
                    {board.columns.map((c) => {
                      const k = cellKey(c.positionId, c.slot, d.date);
                      const list = byCell.get(k) ?? [];
                      const can = editable(c, d.date);
                      return (
                        <td key={k} data-cell={k} className={`min-w-24 border-l border-line px-1 py-0.5 align-top ${future ? "bg-surface/60" : ""}`}>
                          <div className="flex flex-wrap items-center gap-1">
                            {list.map((m) => {
                              const p = person.get(m.employeeId);
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  data-chip={m.id}
                                  data-name={p?.name}
                                  data-state={m.state}
                                  title={`${p?.name ?? ""} · ${m.hint}`}
                                  onClick={() => setChip(m)}
                                  className="inline-flex max-w-40 items-center rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-900"
                                >
                                  <span className="truncate">{p?.name ?? "—"}</span>
                                  {ICON[m.state] && <span className={`ml-0.5 ${m.state === "open" ? "text-success" : m.state === "no-leave" ? "text-danger" : ""}`} aria-label={ICON_TITLE[m.state]}>{ICON[m.state]}</span>}
                                </button>
                              );
                            })}
                            {can && (
                              <button
                                type="button"
                                data-add={k}
                                onClick={() => setCell({ col: c, date: d.date })}
                                aria-label={`Отметить: ${c.name} · ${SLOT_LABEL[c.slot].toLowerCase()} · ${d.date}`}
                                className={`grid place-items-center rounded text-ink-muted hover:bg-surface ${list.length ? "size-6 opacity-50 hover:opacity-100 max-lg:opacity-100" : "h-6 w-full"}`}
                              >
                                {list.length ? <Plus size={14} /> : "·"}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <MonthSummary rows={summary} />
      </div>

      {cell && (
        <CellPicker
          title={`${cell.col.name} · ${SLOT_LABEL[cell.col.slot].toLowerCase()} · ${cell.date}`}
          people={people.filter(
            (p) => p.isActive && (board.isOwner || !p.self) && !(byCell.get(cellKey(cell.col.positionId, cell.col.slot, cell.date)) ?? []).some((m) => m.employeeId === p.id),
          )}
          positionId={cell.col.positionId}
          onPick={(p) => {
            const c = cell;
            setCell(null);
            void mark(p, c.col, c.date);
          }}
          onClose={() => setCell(null)}
        />
      )}
      {chip && (
        <ChipMenu
          mark={chip}
          name={person.get(chip.employeeId)?.name ?? "—"}
          denied={gridEditCheck({ actorRole: role, actorId: "me", empUserId: person.get(chip.employeeId)?.self ? "me" : null, date: chip.date, today })}
          onRemove={() => {
            const m = chip;
            setChip(null);
            void unmark(m);
          }}
          onClose={() => setChip(null)}
        />
      )}
    </div>
  );
}

function ChipMenu({ mark, name, denied, onRemove, onClose }: { mark: BoardMark; name: string; denied: string | null; onRemove: () => void; onClose: () => void }) {
  return (
    <Modal label="Отметка" onClose={onClose}>
      <div className="font-semibold">{name}</div>
      <div className="text-sm text-ink-muted">{mark.date} · {SLOT_LABEL[mark.slot].toLowerCase()}</div>
      <div className="mt-1 text-sm">{mark.hint}</div>
      {denied ? (
        <p className="mt-3 text-sm text-ink-muted">{denied}</p>
      ) : (
        <button className="adm-btn-danger mt-3 w-full" onClick={onRemove}>Снять отметку</button>
      )}
    </Modal>
  );
}

export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <button aria-label="Закрыть" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div tabIndex={-1} autoFocus className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none sm:rounded-2xl">{children}</div>
    </div>
  );
}
