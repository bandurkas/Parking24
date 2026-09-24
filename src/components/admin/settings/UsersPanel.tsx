"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import type { Role } from "@prisma/client";
import { createUserAction, setUserPasswordAction, updateUserAction } from "@/app/admin/actions/users";
import type { UserView } from "@/server/services/users";
import SaveNote, { type Note } from "./SaveNote";

export type RoleOption = { value: Role; label: string; hint: string };

export default function UsersPanel({ users, roles }: { users: UserView[]; roles: RoleOption[] }) {
  const [adding, setAdding] = useState(false);
  const label = (r: Role) => roles.find((x) => x.value === r)?.label ?? r;
  return (
    <section className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Пользователи</h2>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="adm-btn-primary h-10 px-4 text-sm">
            <UserPlus size={16} /> Добавить
          </button>
        )}
      </div>
      {adding && <AddUser roles={roles} onClose={() => setAdding(false)} />}
      <ul className="adm-card mt-3 divide-y divide-line">
        {users.map((u) => (
          <UserRow key={u.id} u={u} roles={roles} roleLabel={label(u.role)} />
        ))}
      </ul>
    </section>
  );
}

function RoleSelect({ value, onChange, roles, disabled }: { value: Role; onChange: (r: Role) => void; roles: RoleOption[]; disabled?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Role)} disabled={disabled} aria-label="Роль" className="adm-input">
      {roles.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label} — {r.hint}
        </option>
      ))}
    </select>
  );
}

function AddUser({ roles, onClose }: { roles: RoleOption[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("ADMIN");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<Note>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    start(async () => {
      const res = await createUserAction({ login, name, role, password });
      if (res.ok) {
        router.refresh();
        onClose();
      } else setNote({ ok: false, text: res.error });
    });
  }

  return (
    <form onSubmit={submit} className="adm-card mt-3 grid gap-3 p-4 sm:grid-cols-2" aria-label="Новый пользователь">
      <label>
        <span className="adm-label">Логин</span>
        <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" autoCapitalize="none" className="adm-input font-mono" name="new-login" />
      </label>
      <label>
        <span className="adm-label">Имя</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="adm-input" name="new-name" />
      </label>
      <label>
        <span className="adm-label">Роль</span>
        <RoleSelect value={role} onChange={setRole} roles={roles} />
      </label>
      <label>
        <span className="adm-label">Пароль (от 10 символов)</span>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" className="adm-input" name="new-password" />
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Завести"}</button>
        <button type="button" onClick={onClose} className="adm-btn h-10 px-4 text-sm">Отмена</button>
        <SaveNote note={note} />
      </div>
    </form>
  );
}

function UserRow({ u, roles, roleLabel }: { u: UserView; roles: RoleOption[]; roleLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"view" | "edit" | "password">("view");
  const [name, setName] = useState(u.name);
  const [role, setRole] = useState<Role>(u.role);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<Note>(null);

  function save(input: { name: string; role: Role; isActive: boolean }, done: string) {
    setNote(null);
    start(async () => {
      const res = await updateUserAction(u.id, input);
      setNote(res.ok ? { ok: true, text: done } : { ok: false, text: res.error });
      if (res.ok) {
        setMode("view");
        router.refresh();
      }
    });
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    start(async () => {
      const res = await setUserPasswordAction(u.id, password);
      setNote(res.ok ? { ok: true, text: "Пароль задан, прежние входы закрыты" } : { ok: false, text: res.error });
      if (res.ok) {
        setPassword("");
        setMode("view");
      }
    });
  }

  return (
    <li className="px-4 py-3 sm:px-5" data-user={u.login}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-40 flex-1">
          <div className={`font-semibold ${u.isActive ? "" : "text-ink-muted line-through"}`}>
            {u.name} {u.self && <span className="text-xs font-normal text-ink-muted no-underline">(это вы)</span>}
          </div>
          <div className="text-xs text-ink-muted">
            <span className="font-mono">{u.login}</span> · {roleLabel} · {u.isActive ? (u.lastLogin ? `входил ${u.lastLogin}` : "ещё не входил") : "выключен"}
          </div>
        </div>
        {mode === "view" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode("edit")} className="adm-btn h-9 px-3 text-sm">Изменить</button>
            {u.self ? (
              <Link href="/admin/account" className="adm-btn h-9 px-3 text-sm">Мой пароль</Link>
            ) : (
              <>
                <button type="button" onClick={() => setMode("password")} className="adm-btn h-9 px-3 text-sm">Задать пароль</button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => save({ name: u.name, role: u.role, isActive: !u.isActive }, u.isActive ? "Выключен, вышел со всех устройств" : "Включён")}
                  className={`${u.isActive ? "adm-btn-danger" : "adm-btn"} h-9 px-3 text-sm`}
                >
                  {u.isActive ? "Выключить" : "Включить"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {mode === "edit" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className="adm-label">Имя</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="adm-input" />
          </label>
          <label>
            <span className="adm-label">Роль{u.self ? " (себе не меняется)" : ""}</span>
            <RoleSelect value={role} onChange={setRole} roles={roles} disabled={u.self} />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" disabled={pending} onClick={() => save({ name, role, isActive: u.isActive }, "Сохранено")} className="adm-btn-primary h-9 px-4 text-sm">Сохранить</button>
            <button type="button" onClick={() => { setMode("view"); setName(u.name); setRole(u.role); }} className="adm-btn h-9 px-3 text-sm">Отмена</button>
          </div>
        </div>
      )}

      {mode === "password" && (
        <form onSubmit={savePassword} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1">
            <span className="adm-label">Новый пароль для {u.login} (от 10 символов)</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" className="adm-input" aria-label="Новый пароль" />
          </label>
          <button type="submit" disabled={pending} className="adm-btn-primary h-11 px-4 text-sm">Сохранить пароль</button>
          <button type="button" onClick={() => { setMode("view"); setPassword(""); }} className="adm-btn h-11 px-3 text-sm">Отмена</button>
        </form>
      )}
      <SaveNote note={note} className="mt-1" />
    </li>
  );
}
