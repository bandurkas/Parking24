import Link from "next/link";
import { requireUser } from "@/server/auth/guard";
import { schedulerStatus } from "@/server/services/settings";
import { fmtDateTime } from "@/server/lib/dates";
import SchedulerCard from "@/components/admin/settings/SchedulerCard";
import { SCAN_REGISTRY } from "@/server/automations/scan-registry";
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
  const { state, paused, modes } = await schedulerStatus();
  const last = "last" in state ? state.last : null;
  // Итог скана в последнем тике — из пульса: в «пробно» число того, что было бы сделано
  const scans = SCAN_REGISTRY.map((s) => ({
    code: s.code,
    label: s.label,
    mode: modes[s.code] ?? "off",
    last: last?.failed.includes(s.code) ? "сбой в последнем тике" : last && s.code in last.done ? `в последнем тике: ${last.done[s.code]}` : last && s.code in last.dry ? `пробно, в последнем тике было бы: ${last.dry[s.code]}` : null,
  }));
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
      <SchedulerCard
        kind={state.kind}
        lastAt={last ? fmtDateTime(last.at) : null}
        ageMin={state.kind === "late" ? state.ageMin : null}
        failed={last?.failed ?? []}
        paused={paused}
        scans={scans}
      />
      <p className="mt-4 text-xs text-ink-muted">Разделы настроек заполняются в этапе M4.</p>
    </div>
  );
}
