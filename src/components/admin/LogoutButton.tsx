"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { logoutAction } from "@/app/admin/login/actions";

export type OpenShiftBrief = { number: number; admin: string } | null;

// Выход смену не закрывает; при открытой смене — напоминание со ссылкой на закрытие (PLAN §1, ответ 4 раздела 8)
export default function LogoutButton({ shift, className, label, children }: { shift: OpenShiftBrief; className: string; label?: string; children: React.ReactNode }) {
  const [ask, setAsk] = useState(false);
  if (!shift) {
    return (
      <form action={logoutAction}>
        <button className={className} aria-label={label} title="Выйти">{children}</button>
      </form>
    );
  }
  return (
    <>
      <button type="button" className={className} aria-label={label} title="Выйти" onClick={() => setAsk(true)}>{children}</button>
      {/* В body: у шапки backdrop-filter, внутри неё fixed-окно сжалось бы до высоты шапки */}
      {ask && createPortal(
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Смена открыта">
          <button aria-label="Отмена" className="absolute inset-0 bg-black/40" onClick={() => setAsk(false)} />
          <div className="relative w-full max-w-sm rounded-xl bg-white p-4 text-ink shadow-card">
            <div className="font-semibold">Кассовая смена №{shift.number} открыта ({shift.admin})</div>
            <p className="mt-1 text-sm text-ink-muted">Выход из аккаунта смену не закрывает. Закрыть смену можно в разделе «Касса».</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/admin/cash#close" onClick={() => setAsk(false)} className="adm-btn-primary h-10 px-4 text-sm">Закрыть смену</Link>
              <form action={logoutAction}>
                <button className="adm-btn h-10 px-4 text-sm">Всё равно выйти</button>
              </form>
              <button type="button" onClick={() => setAsk(false)} className="adm-btn-ghost h-10 px-3 text-sm">Отмена</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
