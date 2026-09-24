import Link from "next/link";
import { OWNER, requireUser } from "@/server/auth/guard";
import { peopleData } from "@/server/services/staff";
import PeopleEditor from "@/components/admin/staff/PeopleEditor";

export const dynamic = "force-dynamic";

export default async function StaffPeoplePage() {
  await requireUser(OWNER);
  const data = await peopleData();
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/staff" className="text-sm text-ink-muted hover:underline">← Табель</Link>
      <h1 className="text-lg font-bold">Справочник табеля</h1>
      <p className="mt-1 text-sm text-ink-muted">Должности и сотрудники. Логин связывает карточку с человеком: он сам отмечает приход и уход своей смены.</p>
      <PeopleEditor data={data} />
    </div>
  );
}
