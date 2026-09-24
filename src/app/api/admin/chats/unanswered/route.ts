import { NextResponse } from "next/server";
import { requireActor, Forbidden, STAFF } from "@/server/auth/guard";
import { chatsEnabled } from "@/server/messaging/wazzup/config";
import { unansweredCount } from "@/server/messaging/wazzup/iframe";

export const dynamic = "force-dynamic";

// Счётчик неотвеченных для пункта «Чаты» (кеш 30 с в процессе). Выключенное окно чатов — пустой ответ, без запроса к Wazzup
export async function GET() {
  try {
    const user = await requireActor(STAFF);
    if (!(await chatsEnabled())) return NextResponse.json({ enabled: false, count: 0 });
    return NextResponse.json({ enabled: true, count: (await unansweredCount(user.id)) ?? 0 });
  } catch (e) {
    if (e instanceof Forbidden) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    console.error("unanswered:", e);
    return NextResponse.json({ enabled: false, count: 0 });
  }
}
