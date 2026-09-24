"use client";

// Сетка табеля (Ф13 §8): месяц × колонки «должность + слот», оптимистичные отметки без revalidatePath (реш. 4.3.10)
import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { markShiftAction, unmarkShiftAction } from "@/app/admin/actions/staff";
import type { BoardMark, BoardPerson, StaffBoard } from "@/server/services/staff";
import { SLOT_LABEL, cellKey, countsOf, gapsOf, gridEditCheck, monthOf, slotHours, type Column } from "@/lib/workshift";
import { addDays } from "@/server/lib/dates";
import CellPicker from "./CellPicker";
import MonthSummary from "./MonthSummary";
import PrintButton from "./PrintButton";

export const CHIP_BG = ["bg-sky-100 text-sky-900", "bg-emerald-100 text-emerald-900", "bg-amber-100 text-amber-900", "bg-violet-100 text-violet-900", "bg-rose-100 text-rose-900", "bg-teal-100 text-teal-900", "bg-lime-100 text-lime-900", "bg-orange-100 text-orange-900"];
const ICON: Record<BoardMark["state"], string> = { open: "●", "no-leave": "!", late: "⏱", manual: "✎", closed: "" };
const ICON_TITLE: Record<BoardMark["state"], string> = { open: "на смене", "no-leave": "уход не отмечен", late: "отмечено позже", manual: "вручную", closed: "" };

type Cell = { col: Column; date: string };

export default function ShiftGrid({ board }: { board: StaffBoard }) {
  const [marks, setMarks] = useState(board.marks);
  const [people, setPeople] = useState(board.people);
  const [cell, setCell] = useState<Cell | null>(null);
  const [chip, setChip] = useState<BoardMark | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const role = board.isOwner ? "OWNER" : "ADMIN";
  const person = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const posName = useMemo(() => new Map(board.positions.map((p) => [p.id, p.name])), [board.positions]);
  const from = board.days[0].date;
  const inMonth = marks.filter((m) => m.date >= from);
  const byCell = useMemo(() => {
    const map = new Map<string, BoardMark[]>();
    for (const m of marks) map.set(cellKey(m.positionId, m.slot, m.date), [...(map.get(cellKey(m.positionId, m.slot, m.date)) ?? []), m]);
    return map;
  }, [marks]);
  const gaps = gapsOf(board.columns, board.days.map((d) => d.date), inMonth, board.today);
  const summary = countsOf(
    inMonth.map((m) => ({ employeeId: m.employeeId, employee: person.get(m.employeeId)?.name ?? "—", positionId: m.positionId, position: posName.get(m.positionId) ?? "—", slot: m.slot, hours: m.hours, manual: m.state === "manual" })),
  );
  const groups = board.columns.reduce<{ positionId: string; name: string; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1];
    if (last?.positionId === c.positionId) last.span++;
    else acc.push({ positionId: c.positionId, name: c.name, span: 1 });
    return acc;
  }, []);
  const editable = (c: Column, date: string) => date <= board.today && c.configured && (c.positionActive || board.isOwner);

  async function mark(p: BoardPerson, c: Column, date: string, reason?: string) {
    setErr(null);
    const tmp: BoardMark = { id: `tmp-${p.id}-${date}-${c.slot}`, employeeId: p.id, positionId: c.positionId, date, slot: c.slot, state: "manual", hint: "Поставлено вручную", hours: slotHours(c.slot) };
    setMarks((ms) => [...ms, tmp]);
    const r = await markShiftAction({ employeeId: p.id, positionId: c.positionId, date, slot: c.slot, reason });
    if (r.ok) setMarks((ms) => (ms.some((m) => m.id === r.data.id) ? ms.filter((m) => m.id !== tmp.id) : ms.map((m) => (m.id === tmp.id ? { ...m, id: r.data.id } : m))));
    else {
      setMarks((ms) => ms.filter((m) => m.id !== tmp.id));
      setErr(r.error);
    }
  }

  async function unmark(m: BoardMark, reason?: string) {
    setErr(null);
    setMarks((ms) => ms.filter((x) => x.id !== m.id));
    const r = await unmarkShiftAction({ id: m.id, reason });
    if (!r.ok) {
      setMarks((ms) => [...ms, m]);
      setErr(r.error);
    }
  }

  const today = board.today;
  const thisMonth = monthOf(today);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <h1 className="mr-2 text-lg font-bold">Табель · {board.title}</h1>
        <Link href={`/admin/staff?m=${board.prev}`} className="adm-btn px-3" aria-label="Прошлый месяц">‹</Link>
        <Link href={`/admin/staff?m=${board.next}`} className="adm-btn px-3" aria-label="Следующий месяц">›</Link>
        {board.month !== thisMonth && <Link href={`/admin/staff?m=${thisMonth}`} className="adm-btn">Сегодня</Link>}
        <span className="flex-1" />
        <PrintButton />
        <Link href="/admin/staff/report" className="adm-btn">Отчёт</Link>
        {board.isOwner && <Link href="/admin/staff/people" className="adm-btn">Справочник</Link>}
      </div>
      {err && <div className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" role="alert" data-grid-error>{err}</div>}

      <div id="staff-print">
        <h1 className="hidden text-lg font-bold print:block">Табель · {board.title}</h1>
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
                        <td key={k} data-cell={k} className={`min-w-24 border-l border-line px-1 py-0.5 align-top ${future ? "bg-surface/60" : ""} ${gaps.has(k) ? "outline-1 -outline-offset-2 outline-dashed outline-warning" : ""}`}>
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
                                  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${CHIP_BG[p?.color ?? 0]}`}
                                >
                                  {p?.short ?? "—"}
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
                                className={`grid place-items-center rounded text-ink-muted hover:bg-surface print:hidden ${list.length ? "size-6 opacity-50 hover:opacity-100 max-lg:opacity-100" : "h-6 w-full"}`}
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
        {gaps.size > 0 && <p className="mt-2 text-sm text-warning print:hidden" data-gaps={gaps.size}>Не заполнено обязательных клеток за прошедшие дни: {gaps.size}</p>}
        <MonthSummary rows={summary} />
      </div>

      {cell && (
        <CellPicker
          title={`${cell.col.name} · ${SLOT_LABEL[cell.col.slot].toLowerCase()} · ${cell.date}`}
          check={gridEditCheck({ actorRole: role, actorId: "me", empUserId: null, date: cell.date, today, op: "mark" })}
          people={people.filter(
            (p) => p.isActive && (board.isOwner || !p.self) && !(byCell.get(cellKey(cell.col.positionId, cell.col.slot, cell.date)) ?? []).some((m) => m.employeeId === p.id),
          )}
          positionId={cell.col.positionId}
          prevIds={(byCell.get(cellKey(cell.col.positionId, cell.col.slot, addDays(cell.date, -1))) ?? []).map((m) => m.employeeId)}
          onAdded={(p) => setPeople((ps) => [...ps, p])}
          onPick={(p, reason) => {
            const c = cell;
            setCell(null);
            void mark(p, c.col, c.date, reason);
          }}
          onClose={() => setCell(null)}
        />
      )}
      {chip && (
        <ChipMenu
          mark={chip}
          name={person.get(chip.employeeId)?.name ?? "—"}
          check={gridEditCheck({ actorRole: role, actorId: "me", empUserId: person.get(chip.employeeId)?.self ? "me" : null, date: chip.date, today, op: "unmark", selfMade: chip.state !== "manual" })}
          onRemove={(reason) => {
            const m = chip;
            setChip(null);
            void unmark(m, reason);
          }}
          onClose={() => setChip(null)}
        />
      )}
    </div>
  );
}

function ChipMenu({ mark, name, check, onRemove, onClose }: { mark: BoardMark; name: string; check: ReturnType<typeof gridEditCheck>; onRemove: (reason?: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const need = check.ok && check.needReason;
  return (
    <Modal label="Отметка" onClose={onClose}>
      <div className="font-semibold">{name}</div>
      <div className="text-sm text-ink-muted">{mark.date} · {SLOT_LABEL[mark.slot].toLowerCase()}</div>
      <div className="mt-1 text-sm">{mark.hint}</div>
      {!check.ok ? (
        <p className="mt-3 text-sm text-ink-muted">{check.error}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {need && <input className="adm-input" placeholder="Причина (обязательна)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Причина" />}
          <button className="adm-btn-danger w-full" disabled={need && reason.trim().length < 3} onClick={() => onRemove(reason.trim() || undefined)}>Снять отметку</button>
        </div>
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
