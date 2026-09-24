import Link from "next/link";
import { requireUser, STAFF } from "@/server/auth/guard";
import { chatsEnabled, hasKey } from "@/server/messaging/wazzup/config";
import { chatFrameUrl } from "@/server/messaging/wazzup/iframe";
import ChatPanel from "@/components/admin/ChatPanel";

// Ссылка на окно новая при каждом открытии: срок её жизни у Wazzup не выяснен
export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const user = await requireUser(STAFF); // RSC-запрос идёт мимо layout — роль проверяем здесь же
  const on = await chatsEnabled();
  const frame = on ? await chatFrameUrl({ id: user.id, name: user.name }, { scope: "global" }).catch(() => ({ ok: false as const, message: "Нет связи с Wazzup" })) : null;
  return (
    <div className="mx-auto max-w-6xl">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Wazzup</div>
      <h1 className="mb-4 text-xl font-bold">Чаты с клиентами</h1>
      {on && frame ? (
        <ChatPanel target={null} title="Все чаты" initialUrl={frame.ok ? frame.url : null} initialError={frame.ok ? null : frame.message} tall />
      ) : (
        <div className="adm-card p-5 text-sm text-ink-muted" data-testid="chats-off">
          {hasKey() ? "Окно чатов выключено." : "Wazzup не подключён: на сервере нет ключа API."}
          {user.role === "OWNER" ? (
            <> Включается в <Link href="/admin/settings" className="font-semibold text-primary-deep hover:underline">Настройках</Link>, карточка «Сообщения».</>
          ) : (
            " Включает владелец в настройках."
          )}
          <p className="mt-2">Сообщения клиентов всё равно видны: в ленте брони и клиента и в колокольчике.</p>
        </div>
      )}
    </div>
  );
}
