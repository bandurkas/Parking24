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
  await prisma.payment.updateMany({ where: { cashShiftId: { in: sids } }, data: { cashShiftId: null } });
  await prisma.cashCollection.deleteMany({ where: { shiftId: { in: sids } } });
  await prisma.cashShift.deleteMany({ where: { id: { in: sids } } });
  console.log(`Удалено кассовых смен: ${sids.length} (${shifts.map((s) => `№${s.number}`).join(", ")})`);
}

// МФ-2: тестовые пользователи e2e_* и их записи в журнале (иначе вход и выход стали бы «автоматическими»); сессии — каскадом
await prisma.auditLog.deleteMany({ where: { user: { login: { startsWith: "e2e_" } } } });
const users = await prisma.user.deleteMany({ where: { login: { startsWith: "e2e_" } } });
if (users.count) console.log(`Удалено тестовых пользователей: ${users.count}`);

await prisma.$disconnect();
