import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function SettingsBack() {
  return (
    <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
      <ChevronLeft size={15} /> Настройки
    </Link>
  );
}
