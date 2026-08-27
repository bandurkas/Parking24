"use client";

import { Plus } from "lucide-react";
import { openQuickBooking } from "./QuickBookingDrawer";

export default function NewBookingForClient({ phone }: { phone: string }) {
  return (
    <button onClick={() => openQuickBooking({ phone })} className="adm-btn h-8 gap-1 px-3 text-xs">
      <Plus size={14} /> Новая бронь
    </button>
  );
}
