import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { OWNER } from "@/server/auth/guard";
import { audit } from "@/server/services/audit";
import { noSpaceSegment } from "@/server/services/segments";
import { noSpaceCsv } from "@/lib/segments";
import { moscowIso } from "@/lib/moscow";

const NO_STORE = { "Cache-Control": "no-store" };

// Выгрузка сегмента «не смогли к нам попасть» в CSV: персональные данные покидают систему — только владелец, запись EXPORT в журнал
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (!OWNER.includes(user.role)) return NextResponse.json({ error: "Выгрузка доступна только владельцу" }, { status: 403, headers: NO_STORE });
  const rows = await noSpaceSegment();
  await audit(user.id, "EXPORT", "Client", null, { segment: "no_space", count: rows.length });
  return new Response("\uFEFF" + noSpaceCsv(rows), {
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ne-smogli-popast-${moscowIso(new Date())}.csv"`,
    },
  });
}
