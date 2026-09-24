import Link from "next/link";
import { requireUser, STAFF } from "@/server/auth/guard";
import { periodReport } from "@/server/services/staff";
import { periodSchema } from "@/server/validation/staff";
import { monthOf, monthStart, tabelToday } from "@/lib/workshift";
import MonthSummary from "@/components/admin/staff/MonthSummary";
import PrintButton from "@/components/admin/staff/PrintButton";
import CsvButton from "@/components/admin/staff/CsvButton";

export const dynamic = "force-dynamic";

export default async function StaffReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const today = tabelToday();
  const def = { from: monthStart(monthOf(today)), to: today }; // период по умолчанию — от tabelToday (находка 15)
  const parsed = periodSchema.safeParse({ from: sp.from ?? def.from, to: sp.to ?? def.to });
  const { from, to } = parsed.success ? parsed.data : def;
  const rows = await periodReport(from, to);
  const ru = (iso: string) => iso.split("-").reverse().join(".");
  const title = `Смены за период ${ru(from)} — ${ru(to)}`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <div className="mr-auto">
          <Link href="/admin/staff" className="text-sm text-ink-muted hover:underline">← Табель</Link>
          <h1 className="text-lg font-bold">Отчёт по сменам</h1>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-muted">
            С
            <input type="date" name="from" defaultValue={from} className="adm-input mt-1 w-40" />
          </label>
          <label className="text-xs text-ink-muted">
            По
            <input type="date" name="to" defaultValue={to} className="adm-input mt-1 w-40" />
          </label>
          <button className="adm-btn">Показать</button>
        </form>
        <PrintButton />
        <CsvButton from={from} to={to} />
      </div>
      {!parsed.success && <p className="mb-2 text-sm text-danger">{parsed.error.issues[0]?.message ?? "Неверный период"} — показан период по умолчанию</p>}
      <div id="staff-print">
        <MonthSummary rows={rows} title={title} />
      </div>
    </div>
  );
}
