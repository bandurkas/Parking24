import { NextResponse } from "next/server";
import { webhookSecretOk } from "@/server/lib/webhook-auth";
import { parseWebhook } from "@/server/messaging/wazzup/rules";
import { applyEvents } from "@/server/messaging/wazzup/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ secret: string }> };

const notFound = () => new NextResponse("Not found", { status: 404 });

// Вебхук Wazzup (PHASE_14 §4.6). Секрет — в адресе; не совпал — 404, тело не читаем, адрес не логируем.
// Обработка синхронная до ответа: повторов от Wazzup не ждём. Ответ всегда 200 — иначе Wazzup может снять подписку
export async function POST(req: Request, ctx: Ctx) {
  const { secret } = await ctx.params;
  if (!webhookSecretOk(secret, process.env.WAZZUP_WEBHOOK_SECRET)) return notFound();
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  await applyEvents(parseWebhook(body));
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return notFound();
}
