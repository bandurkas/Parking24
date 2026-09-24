import { requireUser } from "@/server/auth/guard";
import { listUsers, ROLES, ROLE_HINT } from "@/server/services/users";
import { ROLE_LABEL } from "@/lib/crm/labels";
import SettingsBack from "@/components/admin/settings/SettingsBack";
import UsersPanel from "@/components/admin/settings/UsersPanel";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireUser(["OWNER"]);
  const users = await listUsers(me.id);
  const roles = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r], hint: ROLE_HINT[r] }));
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsBack />
      <h1 className="mt-1 text-xl font-bold">Пользователи и пароли</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Каждый сотрудник входит под своим логином. Пароль задаёт владелец; при смене пароля и при выключении сотрудник выходит со всех устройств.
        Удаления нет — выключенный не входит, а его действия остаются в журнале под его именем.
      </p>
      <UsersPanel users={users} roles={roles} />
    </div>
  );
}
