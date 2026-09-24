import "server-only";
import { Prisma, type BookingStatus } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { formatPhone } from "@/lib/phone";
import { applyChannelUpdates, sentRecently } from "./channels";
import { chatIdToE164, chatTypeChannel, statusPatch, type WzEvent, type WzMessage, type WzStatus } from "./rules";
import { notifyOnce } from "./notify";

const OPEN: BookingStatus[] = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"];
const CHANNEL_NAME = { WHATSAPP: "WhatsApp", TELEGRAM: "Telegram", MAX: "MAX" } as const;

// Пакет вебхука: каждое событие отдельно, ошибка одного не теряет остальные. Смены каналов — одним вызовом
export async function applyEvents(events: WzEvent[]) {
  const channels: { channelId: string; state: string }[] = [];
  for (const e of events) {
    if (e.kind === "channel") {
      channels.push(e);
      continue;
    }
    try {
      if (e.kind === "status") await applyStatus(e);
      else if (e.kind === "message") await applyMessage(e);
    } catch (err) {
      // Повторов от Wazzup не ждём: сырое событие в лог — чтобы можно было внести руками
      console.error("[wazzup] событие не записано", JSON.stringify(e).slice(0, 4000), err);
    }
  }
  if (channels.length) await applyChannelUpdates(channels).catch((err) => console.error("[wazzup] состояние каналов не записано", JSON.stringify(channels), err));
}

// Статус ищется по providerMessageId, который Ф4 пишет сразу после успеха. Не нашли — гонка или чужое сообщение: мимо, без сна
async function applyStatus(e: WzStatus) {
  const o = await prisma.outbox.findUnique({
    where: { providerMessageId: e.messageId },
    select: { id: true, deliveredAt: true, readAt: true, failCode: true, bookingId: true, booking: { select: { number: true } } },
  });
  if (!o) {
    if (e.status !== "sent") console.warn("[wazzup] статус без записи Outbox", e.status, e.messageId);
    return;
  }
  const patch = statusPatch(o, { status: e.status, at: e.at ?? new Date(), errorCode: e.errorCode });
  if (!patch) return;
  // Условие «ещё не стоит» в самом UPDATE: два одновременных вебхука не перетрут друг друга
  const n = await prisma.outbox.updateMany({
    where: { id: o.id, ...(patch.readAt ? { readAt: null } : patch.deliveredAt ? { deliveredAt: null } : { failCode: null }) },
    data: patch,
  });
  // Недоставка после отправки — то же, что постоянная ошибка: администратор звонит. FAILED не ставим — сообщение из очереди ушло
  if (n.count && patch.failCode) {
    const num = o.booking?.number;
    await notifyOnce("MESSAGE_FAILED", `Сообщение клиенту${num ? ` по брони №${num}` : ""} не доставлено (${patch.failCode}). Позвоните клиенту.`, {
      key: `message-failed:${o.id}`,
      bookingId: o.bookingId,
      match: o.id,
    });
  }
}

async function findClient(phone: string | null) {
  if (!phone) return null;
  return prisma.client.findFirst({ where: { OR: [{ phone }, { extraPhones: { has: phone } }] }, select: { id: true, name: true, phone: true } });
}

// Последняя незакрытая бронь клиента, иначе последняя за 30 дней, иначе без брони
async function pickBooking(clientId: string) {
  const open = await prisma.booking.findFirst({ where: { clientId, status: { in: OPEN } }, orderBy: { createdAt: "desc" }, select: { id: true, number: true } });
  if (open) return open;
  return prisma.booking.findFirst({ where: { clientId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { createdAt: "desc" }, select: { id: true, number: true } });
}

function bodyText(e: WzMessage): string {
  const text = e.text?.trim() ?? "";
  // Медиа не скачиваем: файл остаётся в Wazzup, в ленте — ссылка
  if (e.contentUri) return text ? `${text} (${e.type}: ${e.contentUri})` : `${e.type}: ${e.contentUri}`;
  return text || `[${e.type}]`;
}

async function applyMessage(e: WzMessage) {
  const channel = chatTypeChannel(e.chatType);
  if (!channel) return; // группы и мессенджеры вне CRM
  const externalId = `wz:${e.messageId}`;
  if (await prisma.interaction.findUnique({ where: { externalId }, select: { id: true } })) return;
  // Наше же сообщение вернулось эхом: оно уже видно в «Сообщениях клиенту»
  if (e.isEcho && (sentRecently(e.messageId) || (await prisma.outbox.findUnique({ where: { providerMessageId: e.messageId }, select: { id: true } })))) return;

  // chatId — номер только у WhatsApp; у Telegram и MAX номер берём из contact.phone
  const phone = chatIdToE164(channel === "WHATSAPP" ? e.chatId : e.contactPhone);
  const client = await findClient(phone);
  const booking = client ? await pickBooking(client.id) : null;
  const where = CHANNEL_NAME[channel];
  const who = phone ? formatPhone(phone) : e.contactName ?? e.chatId ?? "неизвестный номер";
  const body = bodyText(e);
  const text = e.isEcho
    ? `Ответ в ${where}${e.authorName ? ` (${e.authorName})` : ""}: ${body}`
    : client
      ? `Клиент написал в ${where}: ${body}`
      : `Сообщение в ${where} с номера ${who}: ${body}`;

  try {
    await prisma.interaction.create({
      data: {
        type: "MESSAGE",
        channel,
        direction: e.isEcho ? "OUT" : "IN",
        text: text.slice(0, 4000),
        externalId,
        clientId: client?.id ?? null,
        bookingId: booking?.id ?? null,
        userId: null, // системная запись; автор ответа — в meta.authorName
        occurredAt: e.at ?? new Date(),
        meta: { source: "wazzup", messageId: e.messageId, chatType: e.chatType, chatId: e.chatId, type: e.type, authorName: e.authorName, contactName: e.contactName },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return; // тот же вебхук параллельно
    throw err;
  }
  if (e.isEcho) return;

  // Колокольчик — не на каждую реплику: одно непрочитанное на клиента (ключ после Ф2б — client-message:<clientId>)
  const excerpt = body.length > 80 ? `${body.slice(0, 80)}…` : body;
  const name = client?.name ?? e.contactName;
  await notifyOnce(
    "CLIENT_MESSAGE",
    `${name ? `${name} (${who})` : who} написал в ${where}${booking ? ` · бронь №${booking.number}` : ""}: «${excerpt}»`,
    { key: `client-message:${client?.id ?? phone ?? e.chatId}`, bookingId: booking?.id ?? null, match: who },
  );
}
