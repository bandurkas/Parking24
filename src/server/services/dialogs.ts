import "server-only";
import { prisma } from "@/server/db/prisma";
import { dialogThreshold, moscowMonth } from "@/server/messaging/wazzup/rules";
import { DIALOG_LIMIT_DEFAULT, readSetting, writeSetting, WZ_KEYS } from "@/server/messaging/wazzup/config";
import { notifyOnce } from "@/server/messaging/wazzup/notify";

const CACHE_MS = 10 * 60_000;

// Счётчик диалогов месяца — предохранитель, а не учёт: нижняя оценка (входящие и ответы из окна чатов
// Wazzup тоже считает диалогами). Клиент без карточки считается по телефону брони
type Cache = { at: number; month: string; count: number };
function g(): { cache: Cache | null } {
  const root = globalThis as typeof globalThis & { __p24Dialogs?: { cache: Cache | null } };
  root.__p24Dialogs ??= { cache: null };
  return root.__p24Dialogs;
}

export async function dialogsThisMonth(force = false): Promise<{ month: string; count: number }> {
  const m = moscowMonth(new Date());
  const c = g().cache;
  if (!force && c && c.month === m.key && Date.now() - c.at < CACHE_MS) return c;
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT COALESCE(o."clientId", b."contactPhone", o.id)) AS n
    FROM "Outbox" o LEFT JOIN "Booking" b ON b.id = o."bookingId"
    WHERE o.status = 'SENT' AND o."sentAt" >= ${m.from} AND o."sentAt" < ${m.to}`;
  const fresh = { at: Date.now(), month: m.key, count: Number(rows[0]?.n ?? 0) };
  g().cache = fresh;
  return fresh;
}

export async function dialogLimit(): Promise<number> {
  const v = await readSetting(WZ_KEYS.dialogLimit);
  return typeof v === "number" && v > 0 ? Math.round(v) : DIALOG_LIMIT_DEFAULT;
}

// Пороги 80 и 100 % — по одному уведомлению за месяц. Отправку не останавливаем (вопрос 4, рекомендация «а»)
export async function checkDialogLimit() {
  const [{ month, count }, limit, lastRaw] = await Promise.all([dialogsThisMonth(), dialogLimit(), readSetting(WZ_KEYS.dialogNotice)]);
  const last = lastRaw && typeof lastRaw === "object" ? (lastRaw as { month: string; pct: number }) : null;
  const pct = dialogThreshold(count, limit, last, month);
  if (!pct) return;
  await writeSetting(WZ_KEYS.dialogNotice, { month, pct });
  const text =
    pct === 100
      ? `Wazzup: лимит тарифа исчерпан — в этом месяце ${count} диалогов из ${limit}. Сообщения клиентам могут перестать уходить, продлите тариф.`
      : `Wazzup: в этом месяце уже ${count} диалогов из ${limit} (80 % лимита тарифа).`;
  await notifyOnce("CHANNEL_DOWN", text, { key: `dialogs:${month}:${pct}`, match: text });
}
