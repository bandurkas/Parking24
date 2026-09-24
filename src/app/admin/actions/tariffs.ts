"use server";
import { revalidatePath } from "next/cache";
import { requireActor, Forbidden, OWNER } from "@/server/auth/guard";
import { saveTariff } from "@/server/services/tariff-admin";

type Result = { ok: true } | { ok: false; error: string };

export async function saveTariffAction(id: string, input: { label: string; price: number; isActive: boolean; version: string }): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const res = await saveTariff(actor.id, typeof id === "string" ? id : "", {
      label: typeof input?.label === "string" ? input.label : "",
      price: Number(input?.price),
      isActive: input?.isActive === true,
      version: typeof input?.version === "string" ? input.version : "",
    });
    if (res.ok) revalidatePath("/admin/settings/tariffs");
    return res;
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: "Тарифы меняет только владелец" };
    console.error("saveTariff:", e);
    return { ok: false, error: "Ошибка сервера" };
  }
}
