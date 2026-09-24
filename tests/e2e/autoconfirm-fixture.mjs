// Предохранитель автоподтверждения для e2e (МФ-1). Включить автоподтверждение можно, только когда клиенту есть
// чем ответить и включён отправщик. Сценарий приводит локальную базу в это состояние теми же сущностями, что человек
// (правило на «Отклонена» с текстом, Setting messaging.senderEnabled), и возвращает всё как было.
// Только локально: на stage у сценария нет базы, там проверяется, что включить нельзя.
import { PrismaClient } from "@prisma/client";
import { BASE } from "./lib.mjs";

export const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

const SENDER = "messaging.senderEnabled";
const RULE = "e2e_on_rejected_no_space";
const TPL = "e2e_reject_no_space";

let client = null;
export function db() {
  return (client ??= new PrismaClient());
}

export async function setSender(value) {
  if (value === null) await db().setting.deleteMany({ where: { key: SENDER } });
  else await db().setting.upsert({ where: { key: SENDER }, update: { value }, create: { key: SENDER, value } });
}

export async function setRejectRule(active) {
  if (!active) return void (await db().automationRule.updateMany({ where: { code: RULE }, data: { isActive: false } }));
  const tpl = await db().messageTemplate.upsert({
    where: { code: TPL },
    update: { isActive: true },
    create: { code: TPL, name: "E2E: отказ, мест нет", body: "E2E: на даты заявки №{{booking.number}} мест нет" },
  });
  await db().automationRule.upsert({
    where: { code: RULE },
    update: { isActive: true, templateId: tpl.id },
    create: { code: RULE, name: "E2E: Отклонена → отказ", trigger: "STATUS_CHANGED", triggerParams: { status: "REJECTED" }, templateId: tpl.id, isActive: true },
  });
}

export async function openGate() {
  await setSender(true);
  await setRejectRule(true);
}

// Снимок выключателей; возвращает функцию, которая всё вернёт (вызывать в finally)
export async function snapshotGate() {
  const keys = [SENDER, "parking.autoConfirm", "parking.autoConfirmLimit"];
  const rows = await db().setting.findMany({ where: { key: { in: keys } } });
  return async () => {
    for (const key of keys) {
      const row = rows.find((r) => r.key === key);
      if (row) await db().setting.upsert({ where: { key }, update: { value: row.value }, create: { key, value: row.value } });
      else await db().setting.deleteMany({ where: { key } });
    }
    await db().automationRule.deleteMany({ where: { code: RULE } });
    await db().messageTemplate.deleteMany({ where: { code: TPL } });
    await db().$disconnect();
  };
}
