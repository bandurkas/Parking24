import { MessageCircle, Send } from "lucide-react";
import type { Channel } from "@prisma/client";
import { CHANNEL_LABEL } from "@/lib/crm/labels";

// Ссылки для ответа клиенту по его каналам. Telegram открывает чат по номеру телефона, если username неизвестен.
export default function ChannelLinks({ phone, channels, preferred, telegram, size = "sm" }: { phone: string; channels: Channel[]; preferred: Channel | null; telegram?: string | null; size?: "sm" | "md" }) {
  const digits = phone.replace(/\D/g, "");
  const set = new Set<Channel>(channels);
  set.add("WHATSAPP");
  if (telegram) set.add("TELEGRAM");
  const cls = size === "md" ? "text-sm" : "text-xs";
  const items: { c: Channel; href: string; label: string; color: string; Icon: typeof Send }[] = [];
  if (set.has("WHATSAPP")) items.push({ c: "WHATSAPP", href: `https://wa.me/${digits}`, label: "WhatsApp", color: "text-[#128c7e]", Icon: MessageCircle });
  if (set.has("TELEGRAM")) items.push({ c: "TELEGRAM", href: telegram ? `https://t.me/${telegram}` : `https://t.me/+${digits}`, label: telegram ? `@${telegram}` : "Telegram", color: "text-[#2AABEE]", Icon: Send });
  if (set.has("MAX")) items.push({ c: "MAX", href: `https://max.ru/`, label: "MAX", color: "text-[#7B3FE4]", Icon: Send });
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono ${cls}`}>
      {items.map(({ c, href, label, color, Icon }) => (
        <a key={c} href={href} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 ${color} hover:underline ${preferred === c ? "font-bold" : ""}`} title={preferred === c ? `${CHANNEL_LABEL[c]} — предпочитаемый канал` : CHANNEL_LABEL[c]}>
          <Icon size={13} /> {label}{preferred === c && <span className="rounded-full bg-primary-soft px-1.5 text-[9px] font-bold uppercase tracking-wide text-primary-deep">основной</span>}
        </a>
      ))}
    </span>
  );
}
