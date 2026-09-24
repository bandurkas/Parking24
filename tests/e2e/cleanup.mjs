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

// Ф14: входящие из вебхука с незнакомых номеров (без клиента и брони) и их уведомления
const wz = await prisma.interaction.deleteMany({ where: { externalId: { startsWith: "wz:e2e-" } } });
const wzn = await prisma.adminNotice.deleteMany({ where: { bookingId: null, text: { contains: "«E2E:" } } });
if (wz.count || wzn.count) console.log(`Удалено сообщений Wazzup из e2e: ${wz.count}, уведомлений: ${wzn.count}`);

await prisma.$disconnect();
