import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { apiConfig, isLocalBase, testHooksEnabled } from "@/server/messaging/wazzup/config";
import { wazzupAdapter } from "@/server/messaging/wazzup/adapter";
import { resetChannelCache } from "@/server/messaging/wazzup/channels";

export const dynamic = "force-dynamic";

// ТОЛЬКО для e2e (tests/e2e/f14-wazzup.mjs), пока отправщика Ф4ш0 нет в ветке: одна запись Outbox → адаптер → результат.
// Работает лишь на dev-сервере с WAZZUP_TEST_HOOKS=1 и WAZZUP_API_BASE на localhost: боевой Wazzup отсюда недостижим.
// После слияния с Ф4ш0 сквозной путь проверяется тиком отправщика, а эта ручка удаляется
function off() {
  return !testHooksEnabled() || !isLocalBase();
}

export async function GET() {
  if (off()) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ enabled: true, base: apiConfig().base });
}

export async function POST(req: Request) {
  if (off()) return new NextResponse("Not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { bookingNumber?: number; outboxId?: string; resetChannels?: boolean };
  if (body.resetChannels) resetChannelCache();
  const o = body.outboxId
    ? await prisma.outbox.findUnique({ where: { id: body.outboxId }, include: { client: true, booking: true } })
    : body.bookingNumber
      ? await prisma.outbox.findFirst({ where: { booking: { number: Number(body.bookingNumber) } }, orderBy: { createdAt: "desc" }, include: { client: true, booking: true } })
      : null;
  if (!o) return NextResponse.json({ error: "нет записи Outbox" }, { status: 404 });
  const phone = o.client?.phone ?? o.booking?.contactPhone ?? "";
  const result = await wazzupAdapter.send({ outboxId: o.id, channel: o.channel, phone, text: o.renderedText });
  // Запись результата — как обещает контракт Ф4 (п. 3–4 §8): providerMessageId сразу после успеха
  // null (повтор crmMessageId) не затирает id первой отправки
  if (result.ok) await prisma.outbox.update({ where: { id: o.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId ?? undefined, lastError: null } });
  else await prisma.outbox.update({ where: { id: o.id }, data: { status: result.retry ? "PENDING" : "FAILED", attempts: { increment: 1 }, lastError: `${result.code}: ${result.message}`.slice(0, 300) } });
  return NextResponse.json({ outboxId: o.id, result });
}
