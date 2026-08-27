import Link from "next/link";
import { requireUser } from "@/server/auth/guard";
import { Users, Tags, Undo2, LayoutGrid, MessageSquareText, Workflow } from "lucide-react";

const ITEMS = [
  { href: "/admin/settings/users", label: "Пользователи и роли", icon: Users, desc: "Владелец, администраторы, охрана" },
  { href: "/admin/settings/tariffs", label: "Тарифы", icon: Tags, desc: "Цены по типам ТС и комнатам" },
  { href: "/admin/settings/policy", label: "Отмена и возвраты", icon: Undo2, desc: "Порог, удержание, no-show" },
  { href: "/admin/settings/capacity", label: "Ёмкость стоянки", icon: LayoutGrid, desc: "Места по типам ТС и зонам" },
  { href: "/admin/settings/templates", label: "Шаблоны сообщений", icon: MessageSquareText, desc: "Подтверждение, напоминания" },
  { href: "/admin/settings/automations", label: "Автоматизации", icon: Workflow, desc: "Правила «когда → что»" },
];

export default async function SettingsPage() {
  await requireUser(["OWNER"]);
  return (
    <div className="mx-auto max-w-4xl">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Владелец</div>
      <h1 className="text-xl font-bold">Настройки</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="adm-card flex items-center gap-3 p-4 hover:ring-primary/60">
            <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-deep"><i.icon size={18} /></span>
            <div>
              <div className="font-semibold">{i.label}</div>
              <div className="text-xs text-ink-muted">{i.desc}</div>
            </div>
          </Link>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-muted">Разделы настроек заполняются в этапе M4.</p>
    </div>
  );
}
