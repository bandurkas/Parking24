import { PrismaClient, type VehicleType, type BookingStatus, type BookingSource } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const env = (k: string, fallback: string) => process.env[k] || fallback;

async function users() {
  const list = [
    { login: "owner", name: "Сергей Кулагин", role: "OWNER" as const, pw: env("SEED_OWNER_PASSWORD", "owner12345") },
    { login: "admin", name: "Администратор", role: "ADMIN" as const, pw: env("SEED_ADMIN_PASSWORD", "admin12345") },
    { login: "guard", name: "Охрана КПП", role: "GUARD" as const, pw: env("SEED_GUARD_PASSWORD", "guard12345") },
  ];
  for (const u of list) {
    await prisma.user.upsert({
      where: { login: u.login },
      update: {},
      create: { login: u.login, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.pw, 10) },
    });
  }
}

async function boards() {
  await prisma.board.upsert({ where: { kind: "PARKING" }, update: {}, create: { kind: "PARKING", name: "Парковка", sortOrder: 0 } });
  await prisma.board.upsert({ where: { kind: "ROOM" }, update: {}, create: { kind: "ROOM", name: "Комнаты отдыха", sortOrder: 1 } });
  await prisma.board.upsert({ where: { kind: "PET" }, update: {}, create: { kind: "PET", name: "Передержка", sortOrder: 2, isActive: false } });
}

async function capacity() {
  // Плейсхолдеры до получения схемы стоянки от заказчика (ТЗ, вопрос №5)
  const rows: { kind: "PARKING" | "ROOM"; vehicleType?: VehicleType; roomType?: string; capacity: number }[] = [
    { kind: "PARKING", vehicleType: "CAR", capacity: 60 },
    { kind: "PARKING", vehicleType: "SUV", capacity: 30 },
    { kind: "PARKING", vehicleType: "MOTO", capacity: 10 },
    { kind: "PARKING", vehicleType: "TRUCK", capacity: 5 },
    { kind: "ROOM", roomType: "comfort-double", capacity: 1 },
    { kind: "ROOM", roomType: "twin", capacity: 1 },
    { kind: "ROOM", roomType: "triple", capacity: 1 },
    { kind: "ROOM", roomType: "bunk", capacity: 6 },
  ];
  for (const r of rows) {
    const exists = await prisma.capacityConfig.findFirst({
      where: { kind: r.kind, zone: "", vehicleType: r.vehicleType ?? null, roomType: r.roomType ?? "" },
    });
    if (!exists) {
      await prisma.capacityConfig.create({
        data: { kind: r.kind, zone: "", vehicleType: r.vehicleType ?? null, roomType: r.roomType ?? "", capacity: r.capacity },
      });
    }
  }
  await prisma.setting.upsert({ where: { key: "capacityIsPlaceholder" }, update: {}, create: { key: "capacityIsPlaceholder", value: true } });
  await prisma.setting.upsert({ where: { key: "freeTransferMinDays" }, update: {}, create: { key: "freeTransferMinDays", value: 4 } });
}

async function tariffs() {
  const rows = [
    { code: "car", kind: "PARKING", label: "Легковая", unit: "day", price: 350, vehicleType: "CAR", sortOrder: 0 },
    { code: "car_long", kind: "PARKING", label: "Легковая от 30 суток", unit: "day", price: 250, minDays: 30, vehicleType: "CAR", sortOrder: 1 },
    { code: "suv", kind: "PARKING", label: "Кроссовер / минивэн", unit: "day", price: 400, vehicleType: "SUV", sortOrder: 2 },
    { code: "moto", kind: "PARKING", label: "Мотоцикл", unit: "day", price: 150, vehicleType: "MOTO", sortOrder: 3 },
    { code: "truck", kind: "PARKING", label: "Грузовая / фура (по запросу)", unit: "day", price: 0, vehicleType: "TRUCK", sortOrder: 4 },
    { code: "room:comfort-double:12h", kind: "ROOM", label: "Комфорт · 12 ч", unit: "12h", price: 2200, roomType: "comfort-double", sortOrder: 10 },
    { code: "room:comfort-double:24h", kind: "ROOM", label: "Комфорт · сутки", unit: "24h", price: 2500, roomType: "comfort-double", sortOrder: 11 },
    { code: "room:twin:12h", kind: "ROOM", label: "Двухместный · 12 ч", unit: "12h", price: 2200, roomType: "twin", sortOrder: 12 },
    { code: "room:twin:24h", kind: "ROOM", label: "Двухместный · сутки", unit: "24h", price: 2500, roomType: "twin", sortOrder: 13 },
    { code: "room:triple:12h", kind: "ROOM", label: "Трёхместный · 12 ч", unit: "12h", price: 2500, roomType: "triple", sortOrder: 14 },
    { code: "room:triple:24h", kind: "ROOM", label: "Трёхместный · сутки", unit: "24h", price: 2700, roomType: "triple", sortOrder: 15 },
    { code: "room:bunk:12h", kind: "ROOM", label: "Койко-место · 12 ч", unit: "12h", price: 800, roomType: "bunk", sortOrder: 16 },
    { code: "room:bunk:24h", kind: "ROOM", label: "Койко-место · сутки", unit: "24h", price: 1200, roomType: "bunk", sortOrder: 17 },
  ] as const;
  for (const t of rows) {
    await prisma.tariff.upsert({
      where: { code: t.code },
      update: {},
      create: {
        code: t.code, kind: t.kind, label: t.label, unit: t.unit, price: t.price, sortOrder: t.sortOrder,
        minDays: "minDays" in t ? t.minDays : null,
        vehicleType: "vehicleType" in t ? t.vehicleType : null,
        roomType: "roomType" in t ? t.roomType : null,
      },
    });
  }
}

async function policyAndTemplates() {
  await prisma.cancellationPolicy.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  const templates = [
    { code: "booking_confirmed", name: "Подтверждение брони", body: "Здравствуйте, {{client.name}}! Бронь №{{booking.number}} подтверждена: {{booking.dates}}, {{booking.vehicle}}. Адрес: МО, г.о. Химки, с. Чашниково. Телефон охраны: +7 905 525-06-60. До встречи!" },
    { code: "reminder_24h", name: "Напоминание за 24 ч", body: "Напоминаем: завтра {{booking.dateFrom}} ждём вас на парковке Питстоп (бронь №{{booking.number}}). Маршрут: {{site.url}}/#route" },
    { code: "extension_offer", name: "Предложение продления", body: "Ваша бронь №{{booking.number}} заканчивается {{booking.dateTo}}. Нужно продлить? Ответьте на это сообщение или позвоните +7 905 525-06-60." },
    { code: "thanks_discount", name: "Спасибо + скидка", body: "Спасибо, что выбрали Питстоп! В следующий раз — скидка 10% по этому сообщению. Бронируйте: {{site.url}}" },
    { code: "new_lead_reply", name: "Ответ на заявку с сайта", body: "Получили вашу заявку №{{booking.number}} на {{booking.dates}}. Администратор свяжется с вами в ближайшее время." },
  ];
  const ids: Record<string, string> = {};
  for (const t of templates) {
    const row = await prisma.messageTemplate.upsert({ where: { code: t.code }, update: {}, create: t });
    ids[t.code] = row.id;
  }
  const rules = [
    { code: "on_confirmed", name: "Бронь подтверждена → подтверждение", trigger: "STATUS_CHANGED", triggerParams: { status: "CONFIRMED" }, templateId: ids.booking_confirmed },
    { code: "before_checkin_24h", name: "За 24 ч до заезда → напоминание", trigger: "BEFORE_CHECKIN", triggerParams: { hoursBefore: 24 }, templateId: ids.reminder_24h },
    { code: "before_checkout_2d", name: "За 2 дня до выезда → продление", trigger: "BEFORE_CHECKOUT", triggerParams: { daysBefore: 2 }, templateId: ids.extension_offer },
    { code: "after_checkout_7d", name: "Через 7 дней после выезда → спасибо", trigger: "AFTER_CHECKOUT", triggerParams: { daysAfter: 7 }, templateId: ids.thanks_discount },
    { code: "on_new_lead", name: "Новая заявка с сайта → ответ", trigger: "STATUS_CHANGED", triggerParams: { status: "NEW", source: "SITE" }, templateId: ids.new_lead_reply, isActive: false },
  ] as const;
  for (const r of rules) {
    await prisma.automationRule.upsert({
      where: { code: r.code },
      update: {},
      create: { code: r.code, name: r.name, trigger: r.trigger, triggerParams: r.triggerParams, templateId: r.templateId, isActive: "isActive" in r ? r.isActive : true },
    });
  }
}

// Демо-брони: только если база пустая
async function demo() {
  if ((await prisma.booking.count()) > 0) return;
  const board = await prisma.board.findUniqueOrThrow({ where: { kind: "PARKING" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { login: "admin" } });
  const d = (offset: number) => {
    const x = new Date();
    x.setUTCHours(0, 0, 0, 0);
    x.setUTCDate(x.getUTCDate() + offset);
    return x;
  };
  const price: Record<VehicleType, number> = { CAR: 350, SUV: 400, MOTO: 150, TRUCK: 0 };
  const rows: { phone: string; name: string; plate: string; vt: VehicleType; from: number; to: number; status: BookingStatus; source: BookingSource; paid?: boolean; time?: string }[] = [
    { phone: "+79161234567", name: "Иван Петров", plate: "А123ВС77", vt: "CAR", from: 0, to: 7, status: "CONFIRMED", source: "SITE", paid: true, time: "06:30" },
    { phone: "+79263334455", name: "Мария Соколова", plate: "Е777КХ150", vt: "SUV", from: 0, to: 3, status: "CONFIRMED", source: "CALL", paid: true, time: "09:15" },
    { phone: "+79035550011", name: "Дмитрий Сычёв", plate: "О555ОО777", vt: "CAR", from: -3, to: 0, status: "CHECKED_IN", source: "TWO_GIS", paid: true, time: "18:40" },
    { phone: "+79857778899", name: "Алексей Журавлёв", plate: "К010МН790", vt: "CAR", from: -10, to: 0, status: "CHECKED_IN", source: "REFERRAL", paid: true, time: "12:00" },
    { phone: "+79991112233", name: "", plate: "", vt: "CAR", from: 2, to: 9, status: "NEW", source: "SITE" },
    { phone: "+79052223344", name: "Олег Р.", plate: "Т321ТТ50", vt: "MOTO", from: 1, to: 4, status: "AWAITING_PAYMENT", source: "WHATSAPP" },
    { phone: "+79214445566", name: "Сергей Сергеев", plate: "В888ВВ98", vt: "CAR", from: -20, to: -12, status: "CHECKED_OUT", source: "INSTAGRAM", paid: true },
    { phone: "+79119876543", name: "Наталья К.", plate: "М456РА77", vt: "SUV", from: -5, to: -1, status: "CANCELLED", source: "SITE" },
    { phone: "+79601234500", name: "ИП Грузов", plate: "Х700ХХ777", vt: "TRUCK", from: 3, to: 5, status: "NEW", source: "CALL" },
  ];
  for (const r of rows) {
    const client = await prisma.client.upsert({
      where: { phone: r.phone },
      update: {},
      create: { phone: r.phone, name: r.name || null, firstSource: r.source },
    });
    const vehicle = r.plate
      ? await prisma.vehicle.create({ data: { clientId: client.id, plate: r.plate, type: r.vt } })
      : null;
    const days = r.to - r.from;
    const amount = days * price[r.vt];
    const b = await prisma.booking.create({
      data: {
        boardId: board.id, kind: "PARKING", status: r.status, clientId: client.id, contactPhone: r.phone, contactName: r.name || null,
        vehicleId: vehicle?.id, vehicleType: r.vt, plate: r.plate || null,
        dateFrom: d(r.from), dateTo: d(r.to), timeFrom: r.time ?? null, days, amount, paidAmount: r.paid ? amount : 0,
        source: r.source, transferNeeded: days >= 4, createdById: admin.id,
        checkedInAt: r.status === "CHECKED_IN" || r.status === "CHECKED_OUT" ? d(r.from) : null,
        checkedOutAt: r.status === "CHECKED_OUT" ? d(r.to) : null,
        cancelledAt: r.status === "CANCELLED" ? d(r.from - 2) : null,
      },
    });
    await prisma.interaction.create({
      data: { bookingId: b.id, clientId: client.id, type: r.source === "SITE" ? "SITE_LEAD" : "COMMENT", channel: r.source === "SITE" ? "SITE" : "PHONE", direction: "IN", text: r.source === "SITE" ? "Заявка с калькулятора на сайте" : "Заявка принята по телефону", userId: r.source === "SITE" ? null : admin.id },
    });
    if (r.paid) {
      await prisma.payment.create({ data: { bookingId: b.id, kind: "PAYMENT", method: "CARD_TERMINAL", amount, createdById: admin.id } });
      await prisma.interaction.create({ data: { bookingId: b.id, clientId: client.id, type: "PAYMENT", text: `Оплата ${amount} ₽ (карта)`, userId: admin.id } });
    }
    await prisma.client.update({ where: { id: client.id }, data: { ltv: { increment: r.paid ? amount : 0 } } });
  }
}

async function main() {
  await users();
  await boards();
  await capacity();
  await tariffs();
  await policyAndTemplates();
  await demo();
  console.log("seed ok");
}

main().finally(() => prisma.$disconnect());
