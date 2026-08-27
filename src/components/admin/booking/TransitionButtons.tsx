"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BookingStatus, Role } from "@prisma/client";
import { GUARD_TRANSITIONS, TRANSITIONS, TRANSITION_VERB } from "@/lib/crm/labels";
import { transitionAction } from "@/app/admin/actions/bookings";

const PRIMARY: BookingStatus[] = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

export default function TransitionButtons({ bookingId, status, role, size = "md", primaryOnly = false }: { bookingId: string; status: BookingStatus; role: Role; size?: "md" | "lg"; primaryOnly?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const targets = TRANSITIONS[status].filter((t) => role !== "GUARD" || GUARD_TRANSITIONS.includes(t)).filter((t) => !primaryOnly || PRIMARY.includes(t));
  if (targets.length === 0) return null;

  function go(to: BookingStatus) {
    let reason: string | undefined;
    if (to === "CANCELLED") {
      const r = window.prompt("Причина отмены (необязательно):", "");
      if (r === null) return;
      reason = r || undefined;
    }
    if (to === "NO_SHOW" && !window.confirm("Отметить как «не приехал»?")) return;
    start(async () => {
      const res = await transitionAction(bookingId, to, reason);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  const h = size === "lg" ? "h-14 px-6 text-base" : "h-10 px-4 text-sm";
  return (
    <div className={`flex items-center gap-2 ${primaryOnly ? "flex-nowrap" : "flex-wrap"}`}>
      {targets.map((t) => (
        <button
          key={t}
          disabled={pending}
          onClick={() => go(t)}
          className={`${PRIMARY.includes(t) ? "adm-btn-primary" : t === "CANCELLED" || t === "NO_SHOW" ? "adm-btn-danger" : "adm-btn"} ${h}`}
        >
          {TRANSITION_VERB[t]}
        </button>
      ))}
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
