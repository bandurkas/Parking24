import Link from "next/link";
import type { Role } from "@prisma/client";
import { requireUser, STAFF } from "@/server/auth/guard";
import { myShiftState, staffBoard } from "@/server/services/staff";
import { monthOf, tabelToday } from "@/lib/workshift";
import { monthSchema } from "@/server/validation/staff";
import MyShift from "@/components/admin/staff/MyShift";
import ShiftGrid from "@/components/admin/staff/ShiftGrid";

export const dynamic = "force-dynamic";

// Карточка «Моя рабочая смена» — администратору всегда, владельцу — если есть карточка (реш. 4.7.7)
const CARD_ALWAYS: Role[] = ["ADMIN"];

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser(STAFF);
  const { m } = await searchParams;
  const month = monthSchema.safeParse({ month: m }).success ? m! : monthOf(tabelToday());
  const [my, board] = await Promise.all([myShiftState(user), staffBoard(month, user)]);
  const isOwner = board.isOwner;

  return (
    <div className="mx-auto max-w-[1600px]">
      {(my.linked || CARD_ALWAYS.includes(user.role)) && <MyShift state={my} variant="card" />}
      {board.columns.length === 0 ? (
        <div className="adm-card p-6 text-center">
          <h1 className="text-lg font-bold">Табель</h1>
          {isOwner ? (
            <>
              <p className="mt-1 text-sm text-ink-muted">Должностей ещё нет — заведите должности и сотрудников.</p>
              <Link href="/admin/staff/people" className="adm-btn-primary mt-3">Настроить</Link>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">Владелец ещё не настроил табель.</p>
          )}
        </div>
      ) : (
        <ShiftGrid key={board.version} board={board} />
      )}
    </div>
  );
}
