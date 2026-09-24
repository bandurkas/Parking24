import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/server/auth/guard";
import { shiftView } from "@/server/services/cash";
import ShiftReport from "@/components/admin/cash/ShiftReport";

export const dynamic = "force-dynamic";

// Итоговый отчёт закрытой смены (ТЗ 7.5) — сохранённый снимок
export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["OWNER", "ADMIN"]);
  const { id } = await params;
  const view = await shiftView(id);
  if (!view) notFound();
  if (view.open) redirect("/admin/cash");
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/cash" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ChevronLeft size={15} /> Касса
      </Link>
      <h1 className="mt-1 text-xl font-bold">Отчёт по смене №{view.number}</h1>
      <ShiftReport view={view} />
    </div>
  );
}
