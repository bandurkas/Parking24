"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BookingStatus, Role } from "@prisma/client";
import { GUARD_TRANSITIONS, TRANSITIONS, TRANSITION_VERB } from "@/lib/crm/labels";
import { rejectNoSpaceAction, transitionAction } from "@/app/admin/actions/bookings";
import { overstayConfirmText, type OverstayDue } from "@/lib/overstay";

const PRIMARY: BookingStatus[] = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

// Время события ставит сервер (ТЗ 3.3): ни поля времени, ни параметра времени здесь нет.
// Забытый заезд или выезд — «Исправить статус» в карточке брони, датой без времени
export default function TransitionButtons({ bookingId, status, role, size = "md", primaryOnly = false, overstayDue = null }: {
  bookingId: string; status: BookingStatus; role: Role; size?: "md" | "lg"; primaryOnly?: boolean; overstayDue?: OverstayDue | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const targets = TRANSITIONS[status].filter((t) => role !== "GUARD" || GUARD_TRANSITIONS.includes(t)).filter((t) => !primaryOnly || PRIMARY.includes(t));
  if (targets.length === 0) return null;

  function run(to: BookingStatus, reason?: string, noSpace = false) {
    start(async () => {
      let res = noSpace ? await rejectNoSpaceAction(bookingId, reason) : await transitionAction(bookingId, to, reason);
      // Мест нет — владельцу предлагаем подтвердить сверх вместимости (Ф3)
      if (!res.ok && res.overCapacity?.canOverride && window.confirm(`${res.error}\n\nПодтвердить сверх вместимости?`)) res = await transitionAction(bookingId, to, reason, true);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  // noSpace — «Мест нет»: отказ с отметкой NO_SPACE, клиенту уходит текст «мест нет» (Ф5, DECISIONS §2)
  function go(to: BookingStatus, noSpace = false) {
    setErr(null);
    let reason: string | undefined;
    if (to === "CANCELLED" || to === "REJECTED") {
      const r = window.prompt(noSpace ? "Отклонить: на эти даты нет мест. Комментарий (необязательно):" : `Причина ${to === "CANCELLED" ? "отмены" : "отклонения"} (необязательно):`, "");
      if (r === null) return;
      reason = r || undefined;
    }
    if (to === "NO_SHOW" && !window.confirm("Отметить как «не приехал»?")) return;
    // Промах в перестое стоит денег — подтверждение; охрана работает в одно нажатие (§12 в.1)
    if (to === "CHECKED_OUT" && overstayDue && role !== "GUARD" && !window.confirm(overstayConfirmText(overstayDue))) return;
    run(to, reason, noSpace);
  }

  const h = size === "lg" ? "h-14 px-6 text-base" : "h-10 px-4 text-sm";

  return (
    <div className={`flex items-center gap-2 ${primaryOnly ? "flex-nowrap" : "flex-wrap"}`}>
      {targets.map((t) => (
        <Fragment key={t}>
          <button
            disabled={pending}
            onClick={() => go(t)}
            title={PRIMARY.includes(t) ? "Время события поставит система" : t === "REJECTED" ? "Отказ по другой причине: клиенту уйдёт общий текст отказа" : undefined}
            className={`${PRIMARY.includes(t) ? "adm-btn-primary" : t === "CANCELLED" || t === "NO_SHOW" || t === "REJECTED" ? "adm-btn-danger" : "adm-btn"} ${h}`}
          >
            {TRANSITION_VERB[t]}
          </button>
          {t === "REJECTED" && (
            <button disabled={pending} onClick={() => go(t, true)} title="Отказ: на эти даты нет мест — клиенту уйдёт текст «мест нет»" className={`adm-btn-danger ${h}`}>
              Мест нет
            </button>
          )}
        </Fragment>
      ))}
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
