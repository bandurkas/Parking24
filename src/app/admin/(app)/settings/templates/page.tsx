import { requireUser } from "@/server/auth/guard";
import { templatesForSettings } from "@/server/services/templates";
import { siteLinks } from "@/server/services/settings";
import { varSamples } from "@/server/automations/preview";
import SettingsBack from "@/components/admin/settings/SettingsBack";
import TemplateCard from "@/components/admin/settings/TemplateCard";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requireUser(["OWNER"]);
  const [templates, links] = await Promise.all([templatesForSettings(), siteLinks()]);
  const vars = varSamples(links);
  const edited = templates.filter((t) => t.edited).length;
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsBack />
      <h1 className="mt-1 text-xl font-bold">Шаблоны сообщений</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Тексты сообщений клиенту в мессенджер. Сообщения уходят, когда в настройках включена отправка; до этого копятся в очереди.
        Правленый здесь текст обновления системы не перезаписывают, «Вернуть текст по умолчанию» — обратно к исходному.
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Переменные в двойных скобках подставляются из брони. Если значения нет, строка из одних переменных или короткая подпись вида
        «Маршрут: {"{{links.route}}"}» выпадает из сообщения; в длинной фразе пустая переменная просто пропадает.
      </p>
      <p className="mt-1 text-sm text-ink-muted">Правлено вручную: {edited} из {templates.length}</p>
      <div className="mt-4 space-y-4">
        {templates.map((t) => (
          <TemplateCard key={t.code} t={t} vars={vars} />
        ))}
      </div>
    </div>
  );
}
