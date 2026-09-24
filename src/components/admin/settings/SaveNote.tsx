import { AlertTriangle, Check } from "lucide-react";

// Строка результата у форм настроек, как у CapacityForm
export type Note = { ok: boolean; text: string } | null;

export default function SaveNote({ note, className = "" }: { note: Note; className?: string }) {
  if (!note) return null;
  return (
    <span role="status" className={`inline-flex items-start gap-1.5 text-sm font-semibold ${note.ok ? "text-[#0b7a4c]" : "text-danger"} ${className}`}>
      {note.ok ? <Check size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />} {note.text}
    </span>
  );
}
