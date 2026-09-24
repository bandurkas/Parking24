import Link from "next/link";
import { formatPhone } from "@/lib/phone";
import { CHANNEL_LABEL, STATUS_LABEL } from "@/lib/crm/labels";
import { fmtDateTime, fmtRange } from "@/server/lib/dates";
import type { NoSpaceRow } from "@/lib/segments";

// Ф8: «Не смогли к нам попасть» — клиенты с отказом «мест нет». Список для ручного обзвона
export default function NoSpaceTable({ rows, owner }: { rows: NoSpaceRow[]; owner: boolean }) {
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        <p className="max-w-3xl">
          Для личного звонка клиенту по его заявке: «вы к нам не попали — сейчас место есть». Рекламные рассылки по этому списку без согласия клиента запрещены (ст. 18 ФЗ «О рекламе»).
        </p>
        {owner && (
          <a href="/api/admin/clients/no-space" download className="adm-btn ml-auto h-8 px-3 text-xs" data-testid="no-space-export">
            Выгрузить CSV
          </a>
        )}
      </div>
      <div className="adm-card mt-3 overflow-x-auto">
        <table className="w-full whitespace-nowrap text-sm" data-testid="no-space-table">
          <thead className="bg-surface-soft text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">Клиент</th>
              <th className="px-3 py-2">Мессенджер</th>
              <th className="px-3 py-2">Отказ «мест нет»</th>
              <th className="px-3 py-2">Не попал на</th>
              <th className="px-3 py-2">Потом забронировал</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-surface-soft" data-client={r.id}>
                <td className="px-3 py-2">
                  <Link href={`/admin/clients/${r.id}`} className="font-semibold hover:underline">{r.name ?? <span className="text-ink-muted">Без имени</span>}</Link>
                  <div className="font-mono text-xs text-ink-muted">{formatPhone(r.phone)}</div>
                  {r.doNotDisturb && <div className="text-[11px] text-danger">не беспокоить</div>}
                </td>
                <td className="px-3 py-2 text-xs">{r.messenger ? CHANNEL_LABEL[r.messenger] : <span className="text-ink-muted">—</span>}</td>
                <td className="px-3 py-2 font-mono text-xs tnum">
                  {fmtDateTime(r.lastRejectedAt)}
                  {r.rejectCount > 1 && <span className="text-ink-muted"> · отказов {r.rejectCount}</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="font-mono tnum">{fmtRange(r.missed.dateFrom, r.missed.dateTo)}</span>{" "}
                  <Link href={`/admin/bookings/${r.missed.id}`} className="text-ink-muted hover:underline">№{r.missed.number}</Link>
                </td>
                <td className="px-3 py-2 text-xs" data-col="booked-later">
                  {r.bookedLater ? (
                    <Link href={`/admin/bookings/${r.bookedLater.id}`} className="font-semibold text-[#0b7a4c] hover:underline">
                      да · №{r.bookedLater.number} · {STATUS_LABEL[r.bookedLater.status]}
                    </Link>
                  ) : (
                    <span className="text-ink-muted">нет</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-ink-muted">Отказов «мест нет» пока не было</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
