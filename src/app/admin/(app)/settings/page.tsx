import Link from "next/link";
import { requireUser } from "@/server/auth/guard";
import { schedulerStatus } from "@/server/services/settings";
import { fmtDateTime } from "@/server/lib/dates";
import SchedulerCard from "@/components/admin/settings/SchedulerCard";
import { SCAN_REGISTRY } from "@/server/automations/scan-registry";
import SenderCard from "@/components/admin/settings/SenderCard";
import { senderOverview } from "@/server/services/outbox";
import { formatPhone } from "@/lib/phone";
import { CHANNEL_LABEL } from "@/lib/crm/labels";
import { Users, Tags, Link2, LayoutGrid, MessageSquareText, Workflow } from "lucide-react";
import MessagingCard from "@/components/admin/settings/MessagingCard"; // Ф14
import { messagingOverview } from "@/server/messaging/wazzup/status";

const ITEMS = [
  { href: "/admin/settings/users", label: "Пользователи и пароли", icon: Users, desc: "Владелец, администраторы, охрана, водители, парковщики" },
  { href: "/admin/settings/tariffs", label: "Тарифы", icon: Tags, desc: "Цены по типам ТС и комнатам" },
  { href: "/admin/settings/policy", label: "Ссылки и политика", icon: Link2, desc: "Маршрут, отзывы, видео, автопереход в «Не приехал»" },
  { href: "/admin/settings/capacity", label: "Ёмкость стоянки", icon: LayoutGrid, desc: "Места по типам ТС и зонам" },
  { href: "/admin/settings/templates", label: "Шаблоны сообщений", icon: MessageSquareText, desc: "Тексты клиенту: правка, предпросмотр" },
  { href: "/admin/settings/automations", label: "Автоматизации", icon: Workflow, desc: "Какое сообщение и когда, выключатели" },
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
  const snd = await senderOverview();
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
      <SenderCard
        mode={snd.mode}
        enabled={snd.enabled}
        provider={snd.provider}
        providerLabel={snd.options.find((o) => o.code === snd.provider)?.label ?? snd.provider}
        providerMissing={snd.providerMissing}
        options={snd.options}
        fakeMode={snd.fakeMode}
        maxAgeHours={snd.cfg.maxAgeHours}
        allowlistOnly={snd.cfg.allowlistOnly}
        allowlist={snd.cfg.allowlist.map(formatPhone)}
        envAllowlist={snd.cfg.envAllowlist.map(formatPhone)}
        queue={{ ...snd.queue, oldest: snd.queue.oldest ? fmtDateTime(snd.queue.oldest) : null }}
        day={snd.day}
        lastTick={snd.lastTick ? fmtDateTime(snd.lastTick) : null}
        dry={snd.dry ? { at: fmtDateTime(snd.dry.at), wouldSend: snd.dry.wouldSend, items: snd.dry.items.map((i) => ({ ...i, channel: CHANNEL_LABEL[i.channel] ?? i.channel, phone: formatPhone(i.phone) })) } : null}
        failStreak={snd.failStreak}
        stopAfterFails={snd.cfg.stopAfterFails}
      />
      <MessagingCard {...await messagingOverview()} />
    </div>
  );
}
