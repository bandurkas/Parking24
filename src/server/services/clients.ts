import "server-only";
import type { BookingSource, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { normalizePhone, normalizePlate } from "@/lib/phone";
import type { SessionUser } from "@/server/auth/session";
import { audit } from "./audit";

export async function upsertClientByPhone(
  rawPhone: string,
  data: { name?: string | null; source?: BookingSource; utm?: Prisma.InputJsonValue | null },
  tx: Prisma.TransactionClient = prisma,
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Некорректный телефон");
  // Дедупликация: основной номер или один из дополнительных
  const existing = (await tx.client.findUnique({ where: { phone } })) ?? (await tx.client.findFirst({ where: { extraPhones: { has: phone } } }));
  if (existing) {
    if (!existing.name && data.name) await tx.client.update({ where: { id: existing.id }, data: { name: data.name } });
    return existing;
  }
  return tx.client.create({
    data: { phone, name: data.name || null, firstSource: data.source ?? "OTHER", firstUtm: data.utm ?? undefined },
  });
}

export async function recalcLtv(clientId: string, tx: Prisma.TransactionClient = prisma) {
  const agg = await tx.payment.aggregate({
    where: { booking: { clientId }, status: "SUCCEEDED" },
    _sum: { amount: true },
  });
  const refunds = await tx.payment.aggregate({
    where: { booking: { clientId }, status: "SUCCEEDED", kind: "REFUND" },
    _sum: { amount: true },
  });
  const ltv = (agg._sum.amount ?? 0) - 2 * (refunds._sum.amount ?? 0);
  await tx.client.update({ where: { id: clientId }, data: { ltv: Math.max(0, ltv) } });
}

export async function searchClients(q: string, take = 8) {
  const digits = q.replace(/\D/g, "");
  const full = digits.length >= 10 ? normalizePhone(digits) : null;
  return prisma.client.findMany({
    where: {
      OR: [
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ...(full ? [{ extraPhones: { has: full } }] : []),
        { name: { contains: q, mode: "insensitive" as const } },
        { vehicles: { some: { plate: { contains: q.toUpperCase() } } } },
      ],
    },
    include: { vehicles: { orderBy: { createdAt: "desc" }, take: 3 }, _count: { select: { bookings: true } } },
    take,
    orderBy: { updatedAt: "desc" },
  });
}

// Владелец госномера (для предупреждения о дубле при новом телефоне)
export async function vehicleOwner(rawPlate: string) {
  const plate = normalizePlate(rawPlate);
  if (plate.length < 6) return null;
  const v = await prisma.vehicle.findFirst({ where: { plate }, orderBy: { createdAt: "desc" }, include: { client: { select: { id: true, name: true, phone: true } } } });
  return v ? { plate, clientId: v.client.id, name: v.client.name, phone: v.client.phone } : null;
}

// Объединение: всё из source переносится в target, телефон source становится дополнительным, source удаляется
export async function mergeClients(sourceId: string, targetId: string, actor: SessionUser) {
  if (sourceId === targetId) throw new Error("Это один и тот же клиент");
  return prisma.$transaction(async (tx) => {
    const [src, dst] = await Promise.all([
      tx.client.findUniqueOrThrow({ where: { id: sourceId }, include: { vehicles: true } }),
      tx.client.findUniqueOrThrow({ where: { id: targetId }, include: { vehicles: true } }),
    ]);
    for (const v of src.vehicles) {
      const dup = v.plate ? dst.vehicles.find((d) => d.plate === v.plate) : null;
      if (dup) {
        await tx.booking.updateMany({ where: { vehicleId: v.id }, data: { vehicleId: dup.id } });
        await tx.vehicle.delete({ where: { id: v.id } });
      } else {
        await tx.vehicle.update({ where: { id: v.id }, data: { clientId: dst.id } });
      }
    }
    await tx.booking.updateMany({ where: { clientId: src.id }, data: { clientId: dst.id } });
    await tx.interaction.updateMany({ where: { clientId: src.id }, data: { clientId: dst.id } });
    await tx.outbox.updateMany({ where: { clientId: src.id }, data: { clientId: dst.id } });
    await tx.pet.updateMany({ where: { clientId: src.id }, data: { clientId: dst.id } });
    const phones = Array.from(new Set([...dst.extraPhones, src.phone, ...src.extraPhones].filter((p) => p !== dst.phone)));
    await tx.client.update({
      where: { id: dst.id },
      data: {
        extraPhones: phones,
        tags: Array.from(new Set([...dst.tags, ...src.tags])),
        channels: Array.from(new Set([...dst.channels, ...src.channels])),
        name: dst.name ?? src.name,
        email: dst.email ?? src.email,
        telegram: dst.telegram ?? src.telegram,
        messenger: dst.messenger ?? src.messenger,
        company: dst.company ?? src.company,
        inn: dst.inn ?? src.inn,
        birthday: dst.birthday ?? src.birthday,
        note: [dst.note, src.note].filter(Boolean).join("\n") || null,
        consentPersonalAt: dst.consentPersonalAt ?? src.consentPersonalAt,
        consentMarketingAt: dst.consentMarketingAt ?? src.consentMarketingAt,
        doNotDisturb: dst.doNotDisturb || src.doNotDisturb,
      },
    });
    await tx.client.delete({ where: { id: src.id } });
    await tx.interaction.create({ data: { clientId: dst.id, type: "SYSTEM", text: `Объединено с карточкой ${src.name ?? "без имени"} ${src.phone} — телефон добавлен как дополнительный`, userId: actor.id, meta: { mergedFrom: src.id, phone: src.phone } } });
    await audit(actor.id, "MERGE", "Client", dst.id, { from: src.id, fromPhone: src.phone }, tx);
    await recalcLtv(dst.id, tx);
    return dst.id;
  });
}

// Привязка брони без клиента (лид с сайта без телефона) к клиенту по номеру
export async function attachClient(bookingId: string, rawPhone: string, name: string | null, actor: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.clientId) throw new Error("У брони уже есть клиент");
    const client = await upsertClientByPhone(rawPhone, { name, source: b.source }, tx);
    let vehicleId: string | null = null;
    if (b.plate && b.vehicleType) {
      const v = (await tx.vehicle.findFirst({ where: { clientId: client.id, plate: b.plate } })) ?? (await tx.vehicle.create({ data: { clientId: client.id, plate: b.plate, type: b.vehicleType } }));
      vehicleId = v.id;
    }
    await tx.booking.update({ where: { id: bookingId }, data: { clientId: client.id, contactPhone: client.phone, contactName: b.contactName ?? client.name, vehicleId } });
    await tx.interaction.updateMany({ where: { bookingId, clientId: null }, data: { clientId: client.id } });
    await tx.interaction.create({ data: { bookingId, clientId: client.id, type: "SYSTEM", text: `Заявка привязана к клиенту ${client.name ?? ""} ${client.phone}`.replace(/\s+/g, " "), userId: actor.id } });
    await audit(actor.id, "UPDATE", "Booking", bookingId, { attachedClient: client.id }, tx);
    return client;
  });
}
