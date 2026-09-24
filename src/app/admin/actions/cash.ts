"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Forbidden, requireActor, STAFF } from "@/server/auth/guard";
import { addCollection, CashError, closeShift, openShift } from "@/server/services/cash";

export type CashResult = { ok: true } | { ok: false; error: string };

const money = z.number().int("Сумма — целое число").min(0, "Сумма не может быть отрицательной").max(100_000_000, "Слишком большая сумма");
const person = (msg: string) => z.string().trim().min(2, msg).max(100);
const openSchema = z.object({ openingBalance: money });
const collectionSchema = z.object({ shiftId: z.string().min(1), amount: money.min(1, "Укажите сумму"), takenBy: person("Кто забрал деньги"), handedBy: person("Кто передал деньги") });
const closeSchema = z.object({ shiftId: z.string().min(1), actualCash: money, seenExpected: z.number().int(), confirmed: z.literal(true, "Подтвердите закрытие смены") });

function fail(e: unknown): CashResult {
  if (e instanceof Forbidden) return { ok: false, error: "Нет доступа" };
  if (e instanceof CashError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Ошибка сервера" };
}

// Касса — администратор и владелец; охрана, водитель, парковщик — нет (действие достижимо прямым POST)
async function run<T>(raw: unknown, schema: z.ZodType<T>, fn: (v: T, actor: Awaited<ReturnType<typeof requireActor>>) => Promise<unknown>): Promise<CashResult> {
  try {
    const actor = await requireActor(STAFF);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
    await fn(parsed.data, actor);
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function openShiftAction(raw: unknown) {
  return run(raw, openSchema, (v, actor) => openShift(v.openingBalance, actor));
}

export async function addCollectionAction(raw: unknown) {
  return run(raw, collectionSchema, (v, actor) => addCollection(v, actor));
}

export async function closeShiftAction(raw: unknown) {
  return run(raw, closeSchema, (v, actor) => closeShift(v, actor));
}
