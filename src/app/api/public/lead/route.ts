import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { leadSchema } from "@/server/validation/booking";
import { createSiteLead } from "@/server/services/leads";
import { daysBetweenIso, todayIso, addDays } from "@/server/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 10 * 60_000;
const LIMIT = 8;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - (v.at(-1) ?? 0) > WINDOW_MS) hits.delete(k);
  return arr.length > LIMIT;
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "0.0.0.0";
}

export async function POST(req: Request) {
  const ipHash = createHash("sha256").update(clientIp(req) + (process.env.SESSION_SECRET ?? "p24")).digest("hex").slice(0, 16);
  if (rateLimited(ipHash)) return NextResponse.json({ ok: false, error: "Слишком много запросов" }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный запрос" }, { status: 400 });
  }
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
  const d = parsed.data;

  // Боты: заполненный honeypot отсекает схема (max 0); слишком быстрый сабмит — молча «ок».
  if (d.ts && Date.now() - d.ts < 1500) return NextResponse.json({ ok: true });

  const days = daysBetweenIso(d.dateFrom, d.dateTo);
  if (days <= 0 || days > 365) return NextResponse.json({ ok: false, error: "Проверьте даты" }, { status: 400 });
  if (d.dateFrom < addDays(todayIso(), -1)) return NextResponse.json({ ok: false, error: "Дата заезда уже прошла" }, { status: 400 });

  const utm: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.utm ?? {}).slice(0, 12)) utm[k.slice(0, 40)] = v;

  try {
    const { booking, duplicate } = await createSiteLead({ dateFrom: d.dateFrom, dateTo: d.dateTo, vehicleType: d.vehicleType, phone: d.phone || undefined, dial: d.dial, utm, ipHash });
    return NextResponse.json({ ok: true, number: booking.number, duplicate });
  } catch (e) {
    console.error("lead:", e);
    return NextResponse.json({ ok: false, error: "Ошибка сервера" }, { status: 500 });
  }
}
