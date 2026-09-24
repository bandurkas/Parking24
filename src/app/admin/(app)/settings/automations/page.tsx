import { requireUser } from "@/server/auth/guard";
import { rulesForSettings } from "@/server/services/automations";
import { parkingSettings } from "@/server/services/settings";
import SettingsBack from "@/components/admin/settings/SettingsBack";
import RuleRow from "@/components/admin/settings/RuleRow";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  await requireUser(["OWNER"]);
  const [rules, parking] = await Promise.all([rulesForSettings(), parkingSettings()]);
  const noReject = parking.autoConfirm && !rules.some((r) => r.reject && r.isActive);
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsBack />
      <h1 className="mt-1 text-xl font-bold">Автоматизации</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Какое сообщение уходит клиенту и когда. Выключенное здесь правило выкатка обратно не включает. Условия срабатывания меняются только в коде.
      </p>
      <p className="mt-1 text-sm text-ink-muted">Сообщения по времени начнут уходить после включения сканов в «Планировщике».</p>
      {noReject && (
        <p className="mt-3 rounded-lg bg-warning/15 px-3 py-2 text-sm text-[#8a5a00]" role="alert">
          Автоподтверждение включено, а действующего правила на «Отклонена» нет: клиент, которому не хватило места, не получит сообщение об отказе.
        </p>
      )}
      <ul className="adm-card mt-4 divide-y divide-line">
        {rules.map((r) => (
          <RuleRow key={r.code} r={r} />
        ))}
      </ul>
    </div>
  );
}
