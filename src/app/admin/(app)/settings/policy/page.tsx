import { requireUser } from "@/server/auth/guard";
import { policyForSettings } from "@/server/services/policy";
import { LINKS } from "@/server/services/settings";
import { NO_SHOW_HOURS } from "@/lib/settings-validate";
import { plural } from "@/lib/tariffs";
import SettingsBack from "@/components/admin/settings/SettingsBack";
import LinksForm from "@/components/admin/settings/LinksForm";
import PolicyForm from "@/components/admin/settings/PolicyForm";

export const dynamic = "force-dynamic";

export default async function PolicyPage() {
  await requireUser(["OWNER"]);
  const p = await policyForSettings();
  const fields = [
    { key: "route" as const, label: LINKS.route.label, hint: p.routeFallback ? `Строка «Маршрут:» в сообщениях. Если поле пустое, подставится ${p.routeFallback}` : "Строка «Маршрут:» в сообщениях" },
    { key: "review" as const, label: LINKS.review.label, hint: "Уйдёт клиенту, только если в тексте шаблона есть {{links.review}}" },
    { key: "video" as const, label: LINKS.video.label, hint: "Уйдёт клиенту, только если в тексте шаблона есть {{links.video}}" },
  ];
  const n = p.pendingOutbox;
  return (
    <div className="mx-auto max-w-2xl">
      <SettingsBack />
      <h1 className="mt-1 text-xl font-bold">Ссылки и политика</h1>

      <h2 className="mt-4 font-semibold">Ссылки для сообщений</h2>
      <LinksForm links={p.links} fields={fields} />
      {n > 0 && (
        <p className="mt-2 text-sm text-ink-muted">
          В очереди {n} {plural(n, "сообщение ждёт", "сообщения ждут", "сообщений ждут")} отправки — они уже собраны со старыми ссылками, новая
          ссылка попадёт только в следующие.
        </p>
      )}

      <h2 className="mt-6 font-semibold">Политика</h2>
      <PolicyForm autoNoShowAfterHours={p.autoNoShowAfterHours} min={NO_SHOW_HOURS.min} max={NO_SHOW_HOURS.max} />

      {/* Ф5: карточка «Номер договора» (<ContractCard … />) — сюда, одним блоком */}
    </div>
  );
}
