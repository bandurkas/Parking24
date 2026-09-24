import "server-only";
import type { NoticeKind, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { fmtDateTime } from "@/server/lib/dates";

type Db = Prisma.TransactionClient;
export type NotifyOpts = { tx?: Db; key?: string };

// Четвёртый аргумент — транзакция (прежняя форма, её зовут соседние фазы) или { tx, key }
function notifyOpts(arg: Db | NotifyOpts | undefined): NotifyOpts {
  if (!arg) return {};
  return typeof (arg as Db).adminNotice === "object" ? { tx: arg as Db } : (arg as NotifyOpts);
}

// Уведомления администратору в CRM (колокольчик в шапке).
// С ключом — одно уведомление на событие: повтор (в том числе гонка двух транзакций) молча ничего не создаёт и вернёт null
export async function notify(kind: NoticeKind, text: string, bookingId?: string | null, opts?: Db | NotifyOpts) {
  const { tx = prisma, key } = notifyOpts(opts);
  const data = { kind, text, bookingId: bookingId ?? null };
  if (!key) return tx.adminNotice.create({ data });
  const [row] = await tx.adminNotice.createManyAndReturn({ data: [{ ...data, dedupKey: key }], skipDuplicates: true });
  return row ?? null;
}

export async function unreadNotices(take = 20) {
  return prisma.adminNotice.findMany({
    where: { readAt: null },
    orderBy: { createdAt: "desc" },
    take,
    include: { booking: { select: { id: true, number: true } } },
  });
}

// Для колокольчика: время — строкой по Москве (у владельца в Джакарте браузер показал бы +4 ч)
export async function unreadNoticeViews() {
  const rows = await unreadNotices();
  return rows.map((n) => ({ id: n.id, kind: n.kind, text: n.text, at: fmtDateTime(n.createdAt), bookingId: n.bookingId, bookingNumber: n.booking?.number ?? null }));
}

export async function unreadCount(): Promise<number> {
  return prisma.adminNotice.count({ where: { readAt: null } });
}

// Только переданные: пришедшие после отрисовки панели остаются непрочитанными
export async function markNoticesRead(userId: string, ids: string[]) {
  if (!ids.length) return 0;
  const { count } = await prisma.adminNotice.updateMany({ where: { readAt: null, id: { in: ids } }, data: { readAt: new Date(), readById: userId } });
  return count;
}
