"use client";
import { useState, useTransition } from "react";
import { changeOwnPasswordAction } from "@/app/admin/actions/users";
import SaveNote, { type Note } from "./SaveNote";

export default function PasswordCard({ login }: { login: string }) {
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [note, setNote] = useState<Note>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    start(async () => {
      const res = await changeOwnPasswordAction({ current, next, repeat });
      if (res.ok) {
        setCurrent("");
        setNext("");
        setRepeat("");
        setNote({ ok: true, text: "Пароль изменён. На других устройствах нужно войти заново" });
      } else setNote({ ok: false, text: res.error });
    });
  }

  return (
    <form onSubmit={submit} className="adm-card mt-4 grid gap-3 p-4 sm:p-5" aria-label="Мой пароль">
      <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />
      <label>
        <span className="adm-label">Текущий пароль</span>
        <input value={current} onChange={(e) => setCurrent(e.target.value)} type="password" autoComplete="current-password" className="adm-input" name="current-password" />
      </label>
      <label>
        <span className="adm-label">Новый пароль (от 10 символов)</span>
        <input value={next} onChange={(e) => setNext(e.target.value)} type="password" autoComplete="new-password" className="adm-input" name="new-password" />
      </label>
      <label>
        <span className="adm-label">Новый пароль ещё раз</span>
        <input value={repeat} onChange={(e) => setRepeat(e.target.value)} type="password" autoComplete="new-password" className="adm-input" name="repeat-password" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="adm-btn-primary h-11 px-5">{pending ? "Сохраняем…" : "Сменить пароль"}</button>
        <SaveNote note={note} />
      </div>
    </form>
  );
}
