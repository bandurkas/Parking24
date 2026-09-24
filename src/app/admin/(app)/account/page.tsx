import { requireUser, STAFF } from "@/server/auth/guard";
import PasswordCard from "@/components/admin/settings/PasswordCard";

export const dynamic = "force-dynamic";

// Свой пароль: владелец и администраторы (МФ-2 Р9). Охране, водителю и парковщику пароль задаёт владелец
export default async function AccountPage() {
  const me = await requireUser(STAFF);
  return (
    <div className="mx-auto max-w-md">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">{me.name}</div>
      <h1 className="text-xl font-bold">Мой пароль</h1>
      <p className="mt-1 text-sm text-ink-muted">После смены на остальных устройствах нужно будет войти заново, в этом окне вы останетесь.</p>
      <PasswordCard login={me.login} />
    </div>
  );
}
