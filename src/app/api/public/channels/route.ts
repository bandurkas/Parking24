import { NextResponse } from "next/server";
import { providerSetting } from "@/server/messaging/wazzup/config";
import { readSnapshot } from "@/server/messaging/wazzup/channels";
import { siteChannelsFrom } from "@/server/messaging/wazzup/rules";

export const dynamic = "force-dynamic";

// Какие мессенджеры предлагать в форме заявки. null — не сужать (провайдер выключен или каналов ещё не видели).
// Главная статическая и собирается без базы, поэтому список берёт сам ChannelPicker в браузере
export async function GET() {
  let channels = null;
  try {
    channels = siteChannelsFrom(await providerSetting(), await readSnapshot());
  } catch (e) {
    console.error("public/channels:", e);
  }
  return NextResponse.json({ channels }, { headers: { "Cache-Control": "public, max-age=60" } });
}
