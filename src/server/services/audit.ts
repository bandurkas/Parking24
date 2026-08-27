import "server-only";
import type { AuditAction, Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { prisma } from "@/server/db/prisma";

export async function audit(
  userId: string | null,
  action: AuditAction,
  entity: string,
  entityId?: string | null,
  diff?: Prisma.InputJsonValue,
  tx: Prisma.TransactionClient = prisma,
) {
  let ip: string | null = null;
  try {
    ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {}
  await tx.auditLog.create({ data: { userId, action, entity, entityId: entityId ?? null, diff, ip } });
}
