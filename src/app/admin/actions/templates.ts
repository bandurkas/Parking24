"use server";
import { revalidatePath } from "next/cache";
import { requireActor, Forbidden, OWNER } from "@/server/auth/guard";
import { restoreTemplate, saveTemplate } from "@/server/services/templates";
import { setRuleActive } from "@/server/services/automations";
import { siteLinks } from "@/server/services/settings";
import { renderPreview } from "@/server/automations/preview";
import { TEMPLATE_MAX } from "@/lib/settings-validate";

type Result = { ok: true } | { ok: false; error: string; confirm?: boolean };

function fail(e: unknown, where: string): { ok: false; error: string } {
  if (e instanceof Forbidden) return { ok: false, error: "Настройки меняет только владелец" };
  console.error(`${where}:`, e);
  return { ok: false, error: "Ошибка сервера" };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

// force — владелец подтвердил предупреждение (пропал номер брони, эмодзи, разметка). Ошибки force не снимает
export async function saveTemplateAction(code: string, name: string, body: string, version: string, force = false): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const res = await saveTemplate(actor.id, str(code), { name: str(name), body: str(body), version: str(version), force: force === true });
    if (!res.ok) return res;
    revalidatePath("/admin/settings/templates");
    return { ok: true };
  } catch (e) {
    return fail(e, "saveTemplate");
  }
}

export async function restoreTemplateAction(code: string, version: string): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const res = await restoreTemplate(actor.id, str(code), str(version));
    if (res.ok) revalidatePath("/admin/settings/templates");
    return res;
  } catch (e) {
    return fail(e, "restoreTemplate");
  }
}

// Тот же рендер, что уходит клиенту: демонстрационная бронь + настоящие ссылки из настроек
export async function previewTemplateAction(body: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    await requireActor(OWNER);
    const text = str(body);
    if (text.length > TEMPLATE_MAX) return { ok: false, error: `Текст длиннее ${TEMPLATE_MAX} символов` };
    return { ok: true, text: renderPreview(text, await siteLinks()) };
  } catch (e) {
    return fail(e, "previewTemplate");
  }
}

export async function setRuleActiveAction(code: string, isActive: boolean, force = false): Promise<Result> {
  try {
    const actor = await requireActor(OWNER);
    const res = await setRuleActive(actor.id, str(code), isActive === true, force === true);
    if (!res.ok) return res;
    revalidatePath("/admin/settings/automations");
    revalidatePath("/admin/settings/templates");
    return { ok: true };
  } catch (e) {
    return fail(e, "setRuleActive");
  }
}
