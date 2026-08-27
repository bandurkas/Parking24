import type { BookingStatus } from "@prisma/client";
import { STATUS_CHIP, STATUS_DOT, STATUS_LABEL, STATUS_SHORT } from "@/lib/crm/labels";

export default function StatusChip({ status, short = false, className = "" }: { status: BookingStatus; short?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_CHIP[status]} ${className}`}>
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {short ? STATUS_SHORT[status] : STATUS_LABEL[status]}
    </span>
  );
}
