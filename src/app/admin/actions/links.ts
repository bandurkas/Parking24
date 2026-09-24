"use server";
import { revalidatePath } from "next/cache";
import { requireActor, Forbidden, OWNER } from "@/server/auth/guard";
import { saveLinks, savePolicy } from "@/server/services/policy";

type Result = { ok: true } | { ok: false; error: string };

function fail(e: unknown, where: string): Result {
  if (e instanceof Forbidden) return { ok: false, error: "Настройки меняет только владелец" };
  console.error(`${where}:`, e);
  return { ok: false, error: "Ошибка сервера" };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function saveLinksAction(input: { route: string; review: string; video: string }): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const res = await saveLinks(actor.id, { route: str(input?.route), review: str(input?.review), video: str(input?.video) });
    if (res.ok) {
      revalidatePath("/admin/settings/policy");
      revalidatePath("/admin/settings/templates");
    }
    return res;
  } catch (e) {
    return fail(e, "saveLinks");
  }
}

export async function savePolicyAction(input: { autoNoShowAfterHours: number }): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const res = await savePolicy(actor.id, { autoNoShowAfterHours: Number(input?.autoNoShowAfterHours) });
    if (res.ok) revalidatePath("/admin/settings/policy");
    return res;
  } catch (e) {
    return fail(e, "savePolicy");
  }
}
