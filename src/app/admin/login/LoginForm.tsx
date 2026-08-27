"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export default function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="rounded-2xl bg-white p-6 shadow-card-lg">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">Логин</label>
      <input name="login" autoComplete="username" autoFocus required className="adm-input mt-1" />
      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-muted">Пароль</label>
      <input name="password" type="password" autoComplete="current-password" required className="adm-input mt-1" />
      {state.error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="adm-btn-primary mt-5 w-full">
        {pending ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
