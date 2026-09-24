// Удаление данных, созданных e2e-сценариями: брони с госномером Т000* и клиенты с телефоном +7999*.
// Локально: node tests/e2e/cleanup.mjs
// На stage:  docker exec -i parking24-web node -e "..." — проще выполнить SQL:
//            docker exec parking24-db psql -U parking24 -d parking24 -f - < tests/e2e/cleanup.sql
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PLATE = "Т000";
const PHONE = "+7999";

const bookings = await prisma.booking.findMany({
  where: { OR: [{ plate: { startsWith: PLATE } }, { contactPhone: { startsWith: PHONE } }] },
  select: { id: true, number: true, plate: true, contactPhone: true },
});
const ids = bookings.map((b) => b.id);

if (ids.length === 0) {
  console.log("Тестовых броней не найдено");
} else {
  // Outbox, Interaction и Payment удаляются каскадом по bookingId; аудит оставляем
  await prisma.outbox.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.interaction.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  console.log(`Удалено броней: ${ids.length} (${bookings.map((b) => `№${b.number}`).join(", ")})`);
}

const clients = await prisma.client.findMany({ where: { phone: { startsWith: PHONE } }, select: { id: true, phone: true } });
if (clients.length) {
  const cids = clients.map((c) => c.id);
  await prisma.outbox.deleteMany({ where: { clientId: { in: cids } } });
  await prisma.interaction.deleteMany({ where: { clientId: { in: cids } } });
  await prisma.vehicle.deleteMany({ where: { clientId: { in: cids } } });
  await prisma.client.deleteMany({ where: { id: { in: cids } } });
  console.log(`Удалено клиентов: ${cids.length}`);
}

// Кассовые смены e2e (Ф11): метка — инкассация «E2E-инкассатор». Платежи чужих броней, попавшие в тестовую смену,
// остаются — только отвязываются от смены
const shifts = await prisma.cashShift.findMany({ where: { collections: { some: { takenBy: { startsWith: "E2E" } } } }, select: { id: true, number: true } });
if (shifts.length) {
  const sids = shifts.map((s) => s.id);
  // Уведомления о расхождении тестовых смен — иначе на stage их увидят в колокольчике
  await prisma.adminNotice.deleteMany({ where: { kind: "CASH_MISMATCH", OR: shifts.map((s) => ({ text: { startsWith: `Смена №${s.number} ` } })) } });
  await prisma.payment.updateMany({ where: { cashShiftId: { in: sids } }, data: { cashShiftId: null } });
  await prisma.cashCollection.deleteMany({ where: { shiftId: { in: sids } } });
  await prisma.cashShift.deleteMany({ where: { id: { in: sids } } });
  console.log(`Удалено кассовых смен: ${sids.length} (${shifts.map((s) => `№${s.number}`).join(", ")})`);
}

// МФ-2: тестовые пользователи e2e_* и их записи в журнале (иначе вход и выход стали бы «автоматическими»); сессии — каскадом
await prisma.auditLog.deleteMany({ where: { user: { login: { startsWith: "e2e_" } } } });
const users = await prisma.user.deleteMany({ where: { login: { startsWith: "e2e_" } } });
if (users.count) console.log(`Удалено тестовых пользователей: ${users.count}`);
// Ф14: входящие из вебхука с незнакомых номеров (без клиента и брони) и их уведомления
const wz = await prisma.interaction.deleteMany({ where: { externalId: { startsWith: "wz:e2e-" } } });
const wzn = await prisma.adminNotice.deleteMany({ where: { bookingId: null, OR: [{ text: { contains: "«E2E:" } }, { text: { contains: "E2E_NEW_CODE" } }] } });
if (wz.count || wzn.count) console.log(`Удалено сообщений Wazzup из e2e: ${wz.count}, уведомлений: ${wzn.count}`);

// Ф13, табель: смены сотрудников и в должностях «E2E …», затем сами сотрудники и должности «E2E …»
{
  const emps = (await prisma.employee.findMany({ where: { name: { startsWith: "E2E " } }, select: { id: true } })).map((e) => e.id);
  const poss = (await prisma.staffPosition.findMany({ where: { name: { startsWith: "E2E " } }, select: { id: true } })).map((p) => p.id);
  const ws = await prisma.workShift.deleteMany({ where: { OR: [{ employeeId: { in: emps } }, { positionId: { in: poss } }] } });
  const e = await prisma.employee.deleteMany({ where: { id: { in: emps } } });
  const p = await prisma.staffPosition.deleteMany({ where: { id: { in: poss } } });
  if (ws.count + e.count + p.count) console.log(`Табель: смен ${ws.count}, сотрудников ${e.count}, должностей ${p.count}`);
}

await prisma.$disconnect();
