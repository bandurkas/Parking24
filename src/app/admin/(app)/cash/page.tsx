import Link from "next/link";
import { requireUser } from "@/server/auth/guard";
import { currentShift, lastClosedActual, recentShifts, shiftView } from "@/server/services/cash";
import { fmtDate } from "@/server/lib/dates";
import { rub } from "@/lib/overstay";
import { signedRub } from "@/lib/cash";
import ShiftReport from "@/components/admin/cash/ShiftReport";
import OpenShiftForm from "@/components/admin/cash/OpenShiftForm";
import CollectionForm from "@/components/admin/cash/CollectionForm";
import CloseShiftForm from "@/components/admin/cash/CloseShiftForm";

export const dynamic = "force-dynamic";

export default async function CashPage() {
  // RSC идёт мимо layout — роль проверяется на самой странице
  const user = await requireUser(["OWNER", "ADMIN"]);
  const cur = await currentShift();
  const [view, suggest, history] = await Promise.all([cur ? shiftView(cur.id) : null, cur ? 0 : lastClosedActual(), recentShifts()]);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Смена</div>
      <h1 className="text-xl font-bold">Касса</h1>
      {view ? (
        <>
          <ShiftReport view={view} />
          <section className="adm-card mt-4 p-4">
            <h2 className="text-sm font-semibold">Инкассация</h2>
            <CollectionForm shiftId={view.id} me={user.name} />
          </section>
          <section id="close" className="adm-card mt-4 scroll-mt-20 p-4">
            <h2 className="text-sm font-semibold">Закрыть смену</h2>
            <CloseShiftForm key={view.expected} shiftId={view.id} expected={view.expected} />
          </section>
        </>
      ) : (
        <section className="adm-card mt-4 p-4" data-testid="no-shift">
          <h2 className="text-sm font-semibold">Смена не открыта</h2>
          <OpenShiftForm suggest={suggest} me={user.name} />
        </section>
      )}
      <section className="adm-card mt-4 overflow-x-auto">
        <h2 className="px-4 pt-4 text-sm font-semibold">Закрытые смены</h2>
        {history.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-xs text-ink-muted">Пока ни одной.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="bg-surface-soft text-left text-[11px] uppercase tracking-wide text-ink-muted">
              <tr><th className="px-3 py-2">Смена</th><th className="px-3 py-2">Администратор</th><th className="px-3 py-2 text-right">Расчётный</th><th className="px-3 py-2 text-right">Фактический</th><th className="px-3 py-2 text-right">Расхождение</th></tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="border-t border-line" data-testid="history-row">
                  <td className="px-3 py-1.5"><Link href={`/admin/cash/${s.id}`} className="underline">№{s.number}</Link> · {fmtDate(s.shiftDate)}</td>
                  <td className="px-3 py-1.5">{s.openedBy.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono tnum">{rub(s.expectedCash ?? 0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tnum">{rub(s.actualCash ?? 0)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono tnum ${s.cashDiff ? "text-danger" : ""}`}>{signedRub(s.cashDiff ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
