"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { exportStaffCsvAction } from "@/app/admin/actions/staff";

// CSV для Excel: BOM, «;», выгрузка пишется в журнал (EXPORT WorkShift)
export default function CsvButton({ from, to }: { from: string; to: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const go = () =>
    start(async () => {
      setErr(null);
      const r = await exportStaffCsvAction({ from, to });
      if (!r.ok) return setErr(r.error);
      const url = URL.createObjectURL(new Blob(["﻿" + r.data.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `tabel_${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  return (
    <>
      <button type="button" onClick={go} disabled={pending} className="adm-btn print:hidden">
        <Download size={16} /> CSV
      </button>
      {err && <span className="adm-err">{err}</span>}
    </>
  );
}
