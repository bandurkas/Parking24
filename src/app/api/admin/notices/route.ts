import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { STAFF } from "@/server/auth/guard";
import { unreadNoticeViews } from "@/server/services/notices";

const NO_STORE = { "Cache-Control": "no-store" };

// Опрос колокольчика (раз в минуту и при открытии панели). Только владелец и администратор:
// у охраны, водителя и парковщика колокольчика нет (МФ-UI)
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (!STAFF.includes(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ notices: await unreadNoticeViews() }, { headers: NO_STORE });
}
