// Сводка по людям без денег: смены по слотам, всего, часы из записи, «из них вручную» (реш. 4.3.11)
import type { ReportRow } from "@/lib/workshift";

export default function MonthSummary({ rows, title = "Сводка за месяц" }: { rows: ReportRow[]; title?: string }) {
  const total = rows.reduce((a, r) => ({ total: a.total + r.total, hours: a.hours + r.hours, manual: a.manual + r.manual }), { total: 0, hours: 0, manual: 0 });
  return (
    <section className="adm-card mt-4 overflow-x-auto" aria-label={title}>
      <table className="w-full text-sm" data-summary>
        <caption className="px-3 pt-3 text-left font-semibold">{title}</caption>
        <thead className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Сотрудник</th>
            <th className="px-3 py-2">Должность</th>
            <th className="px-3 py-2 text-right">День</th>
            <th className="px-3 py-2 text-right">Ночь</th>
            <th className="px-3 py-2 text-right">Сутки</th>
            <th className="px-3 py-2 text-right">Всего</th>
            <th className="px-3 py-2 text-right">Часов</th>
            <th className="px-3 py-2 text-right">Вручную</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-3 text-ink-muted">Смен нет</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={`${r.employee}|${r.position}`} className="border-t border-line" data-row={r.employee}>
              <td className="px-3 py-1.5">{r.employee}</td>
              <td className="px-3 py-1.5 text-ink-muted">{r.position}</td>
              <td className="px-3 py-1.5 text-right">{r.day}</td>
              <td className="px-3 py-1.5 text-right">{r.night}</td>
              <td className="px-3 py-1.5 text-right">{r.full}</td>
              <td className="px-3 py-1.5 text-right font-semibold" data-total>{r.total}</td>
              <td className="px-3 py-1.5 text-right" data-hours>{r.hours}</td>
              <td className="px-3 py-1.5 text-right" data-manual>{r.manual}</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="border-t-2 border-line font-semibold">
              <td className="px-3 py-1.5" colSpan={5}>Итого смен</td>
              <td className="px-3 py-1.5 text-right" data-grand-total>{total.total}</td>
              <td className="px-3 py-1.5 text-right">{total.hours}</td>
              <td className="px-3 py-1.5 text-right">{total.manual}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
