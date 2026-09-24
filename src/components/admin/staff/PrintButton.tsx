"use client";

import { Printer } from "lucide-react";

// Печатается только область #staff-print: альбомный A4, без меню CRM
export default function PrintButton() {
  return (
    <>
      <style>{`@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body * { visibility: hidden; }
  #staff-print, #staff-print * { visibility: visible; }
  #staff-print { position: absolute; left: 0; top: 0; width: 100%; }
  #staff-print .overflow-x-auto { overflow: visible; }
}`}</style>
      <button type="button" onClick={() => window.print()} className="adm-btn print:hidden">
        <Printer size={16} /> Печать
      </button>
    </>
  );
}
