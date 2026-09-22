import { NextResponse } from "next/server";
import { cronSecretOk } from "@/server/lib/cron-auth";
import { runTick } from "@/server/automations/scheduler";

// Тик по запросу: для e2e и на случай аварии. Защищает только секрет; на любую неудачу — 404.
export async function POST(req: Request) {
  if (!cronSecretOk(req.headers.get("x-cron-secret"), process.env.CRON_SECRET)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(await runTick("http"));
}
