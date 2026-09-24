"use client";

// Справочник табеля (только владелец): должности и карточки сотрудников
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/admin/actions/bookings";
import { deleteEmployeeAction, deletePositionAction, saveEmployeeAction, savePositionAction } from "@/app/admin/actions/staff";
import type { PeopleData } from "@/server/services/staff";
import { SLOT_LABEL, SLOT_ORDER, type Slot } from "@/lib/workshift";

type Pos = PeopleData["positions"][number];
type Emp = PeopleData["employees"][number];

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, done?: () => void) => {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setErr(r.error);
      done?.();
      router.refresh();
    });
  };
  return { pending, err, run };
}

export default function PeopleEditor({ data }: { data: PeopleData }) {
  const [editPos, setEditPos] = useState<string | null>(null);
  const [editEmp, setEditEmp] = useState<string | null>(null);
  const posName = new Map(data.positions.map((p) => [p.id, p.name]));

  return (
    <div className="mt-4 space-y-6">
      <section>
        <h2 className="mb-2 font-semibold">Должности</h2>
        <p className="mb-2 text-xs text-ink-muted">Не переименовывайте должность под другую работу — выключите её и заведите новую, иначе прошлые месяцы покажут не то.</p>
        <ul className="space-y-2">
          {data.positions.map((p) =>
            editPos === p.id ? (
              <li key={p.id}><PositionForm initial={p} onDone={() => setEditPos(null)} /></li>
            ) : (
              <li key={p.id} className="adm-card flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-position={p.name}>
                <span className={`font-semibold ${p.isActive ? "" : "text-ink-muted line-through"}`}>{p.name}</span>
                <span className="text-ink-muted">{p.slots.map((s) => SLOT_LABEL[s].toLowerCase()).join(", ")}</span>
                <span className="ml-auto text-xs text-ink-muted">сотрудников {p.employees} · смен {p.shifts}</span>
                <button className="adm-btn-ghost h-8" onClick={() => setEditPos(p.id)}>Изменить</button>
              </li>
            ),
          )}
          <li>{editPos === "new" ? <PositionForm onDone={() => setEditPos(null)} /> : <button className="adm-btn" onClick={() => setEditPos("new")}>Добавить должность</button>}</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Сотрудники</h2>
        <ul className="space-y-2">
          {data.employees.map((e) =>
            editEmp === e.id ? (
              <li key={e.id}><EmployeeForm data={data} initial={e} onDone={() => setEditEmp(null)} /></li>
            ) : (
              <li key={e.id} className="adm-card flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-employee={e.name}>
                <span className={`font-semibold ${e.isActive ? "" : "text-ink-muted line-through"}`}>{e.name}</span>
                <span className="text-ink-muted">{posName.get(e.positionId)}</span>
                {e.login ? (
                  <span className="rounded bg-surface-soft px-1.5 text-xs">
                    логин {e.login.login} · {e.login.role}{e.login.isActive ? "" : " · логин выключен"}
                  </span>
                ) : (
                  <span className="text-xs text-ink-muted">без логина</span>
                )}
                <span className="ml-auto text-xs text-ink-muted">смен {e.shifts}</span>
                <button className="adm-btn-ghost h-8" onClick={() => setEditEmp(e.id)}>Изменить</button>
              </li>
            ),
          )}
          <li>
            {data.positions.length === 0 ? (
              <p className="text-sm text-ink-muted">Сначала заведите должность.</p>
            ) : editEmp === "new" ? (
              <EmployeeForm data={data} onDone={() => setEditEmp(null)} />
            ) : (
              <button className="adm-btn" onClick={() => setEditEmp("new")}>Добавить сотрудника</button>
            )}
          </li>
        </ul>
      </section>
    </div>
  );
}

function SlotBoxes({ label, value, onChange }: { label: string; value: Slot[]; onChange: (v: Slot[]) => void }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-sm">
      <legend className="adm-label">{label}</legend>
      {SLOT_ORDER.map((s) => (
        <label key={s} className="flex items-center gap-1.5">
          <input type="checkbox" checked={value.includes(s)} onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))} />
          {SLOT_LABEL[s]}
        </label>
      ))}
    </fieldset>
  );
}

function PositionForm({ initial, onDone }: { initial?: Pos; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slots, setSlots] = useState<Slot[]>(initial?.slots ?? ["DAY", "NIGHT"]);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const { pending, err, run } = useRun();
  const save = () =>
    run(
      () => savePositionAction({ id: initial?.id, name, slots, isActive }),
      onDone,
    );
  return (
    <div className="adm-card space-y-3 p-3" aria-label="Должность">
      <label className="block">
        <span className="adm-label">Название</span>
        <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название должности" />
      </label>
      <SlotBoxes label="Смены" value={slots} onChange={setSlots} />
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Активна
      </label>
      {err && <p className="adm-err">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="adm-btn-primary" disabled={pending} onClick={save}>Сохранить</button>
        <button className="adm-btn" onClick={onDone}>Отмена</button>
        {initial && <button className="adm-btn-danger ml-auto" disabled={pending} onClick={() => run(() => deletePositionAction(initial.id), onDone)}>Удалить</button>}
      </div>
    </div>
  );
}

function EmployeeForm({ data, initial, onDone }: { data: PeopleData; initial?: Emp; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [positionId, setPositionId] = useState(initial?.positionId ?? data.positions.find((p) => p.isActive)?.id ?? "");
  const [userId, setUserId] = useState(initial?.userId ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const { pending, err, run } = useRun();
  // Свободные логины: активные без карточки и логин этой карточки
  const logins = data.users.filter((u) => u.id === initial?.userId || (u.isActive && !u.cardId));
  const save = () =>
    run(
      () =>
        saveEmployeeAction({ id: initial?.id, name, positionId, userId: userId || null, isActive }),
      onDone,
    );
  return (
    <div className="adm-card grid gap-3 p-3 sm:grid-cols-2" aria-label="Сотрудник">
      <label className="block">
        <span className="adm-label">Имя</span>
        <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Имя" />
      </label>
      <label className="block">
        <span className="adm-label">Должность</span>
        <select className="adm-input" value={positionId} onChange={(e) => setPositionId(e.target.value)} aria-label="Должность">
          {data.positions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.isActive ? "" : " (выключена)"}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="adm-label">Логин CRM</span>
        <select className="adm-input" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Логин">
          <option value="">— без логина —</option>
          {logins.map((u) => (
            <option key={u.id} value={u.id}>{u.login} — {u.name} ({u.role}){u.isActive ? "" : ", выключен"}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Активен
      </label>
      {err && <p className="adm-err sm:col-span-2">{err}</p>}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button className="adm-btn-primary" disabled={pending} onClick={save}>Сохранить</button>
        <button className="adm-btn" onClick={onDone}>Отмена</button>
        {initial && <button className="adm-btn-danger ml-auto" disabled={pending} onClick={() => run(() => deleteEmployeeAction(initial.id), onDone)}>Удалить</button>}
      </div>
    </div>
  );
}
