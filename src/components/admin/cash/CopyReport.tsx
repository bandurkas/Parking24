"use client";

import { useState } from "react";

// «Скопировать отчёт» (ТЗ 7.2). Stage открыт по HTTP — там navigator.clipboard нет, запасной путь через textarea
export default function CopyReport({ text }: { text: string }) {
  const [state, setState] = useState<"" | "ok" | "fail">("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      return setState("ok");
    } catch {}
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    setState(ok ? "ok" : "fail");
  }
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={copy} className="adm-btn h-9 px-3 text-sm">Скопировать отчёт</button>
        {state === "ok" && <span className="text-xs text-success">Скопировано</span>}
        {state === "fail" && <span className="text-xs text-danger">Не удалось — выделите текст ниже</span>}
      </div>
      <details className="mt-2 text-xs text-ink-muted" open={state === "fail"}>
        <summary className="cursor-pointer">Текст отчёта</summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono" data-testid="report-text">{text}</pre>
      </details>
    </div>
  );
}
