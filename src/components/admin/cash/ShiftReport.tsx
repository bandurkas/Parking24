import Link from "next/link";
import { METHOD_LABEL } from "@/lib/crm/labels";
import { collectionLine, reportRows } from "@/lib/cash";
import type { ShiftView } from "@/server/services/cash";
import type { PaymentMethod } from "@prisma/client";
import CopyReport from "./CopyReport";

// Отчёт смены (ТЗ 7.2 / 7.5): открытая — на сейчас, закрытая — снимок; ниже операции смены
export default function ShiftReport({ view }: { view: ShiftView }) {
  const mismatch = view.actual != null && view.actual !== view.expected;
  return (
    <>
      <section className="adm-card mt-4 p-4" data-testid="shift-report">
        <div className="text-sm font-semibold">Смена №{view.number} · {view.date}</div>
        <div className="text-xs text-ink-muted">
          Открыта {view.opened}{view.closed ? ` · закрыта ${view.closed}${view.closedBy ? ` (${view.closedBy})` : ""}` : " · не закрыта"}
        </div>
        <dl className="mt-3 divide-y divide-line text-sm">
          {reportRows(view).map(([label, value]) => (
            <div key={label} data-testid="report-row">
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-ink-muted">{label}</dt>
                <dd className={`font-mono tnum ${label === "Расхождение" && mismatch ? "font-semibold text-danger" : ""}`}>{value}</dd>
              </div>
              {label === "Инкассация" && view.collections.length > 0 && (
                <ul className="pb-1.5 text-xs text-ink-muted" data-testid="collections">
                  {view.collections.map((c, i) => <li key={i}>{collectionLine(c)}</li>)}
                </ul>
              )}
            </div>
          ))}
        </dl>
        <CopyReport text={view.text} />
      </section>
      <section className="adm-card mt-4 p-4">
        <h2 className="text-sm font-semibold">Операции смены</h2>
        {view.operations.length === 0 ? (
          <p className="mt-1 text-xs text-ink-muted">Оплат и возвратов в этой смене нет.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs" data-testid="shift-operations">
            {view.operations.map((o) => (
              <li key={o.id} className={`flex justify-between gap-2 font-mono tnum ${o.outOfTotals ? "text-ink-muted line-through" : ""}`}>
                <span className="min-w-0">
                  {o.at} · <Link href={`/admin/bookings/${o.bookingId}`} className="underline">№{o.bookingNumber}</Link> · {o.reversal ? "Сторно" : o.kind === "PAYMENT" ? "Оплата" : "Возврат"} · {METHOD_LABEL[o.method as PaymentMethod]}{o.by ? ` · ${o.by}` : ""}
                </span>
                <span className={`shrink-0 whitespace-nowrap ${o.kind === "PAYMENT" ? "text-success" : "text-danger"}`}>{o.kind === "PAYMENT" ? "+" : "−"}{o.amount.toLocaleString("ru-RU")} ₽</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
