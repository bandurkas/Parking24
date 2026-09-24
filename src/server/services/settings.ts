import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { SCHEDULER_KEYS, heartbeatState, parseHeartbeat, parseModes, type ScanMode, type SchedulerState } from "@/server/automations/tick-core";

// Настройки парковки из таблицы Setting. Значения по умолчанию — из ТЗ 21.09 и ответов заказчика 22.09.
export const SETTINGS = {
  capacityTotal: { key: "parking.capacityTotal", def: 405, label: "Всего мест (легковые, кроссоверы, мото)" },
  capacityTruck: { key: "parking.capacityTruck", def: 10, label: "Мест для грузовых" },
  autoConfirmLimit: { key: "parking.autoConfirmLimit", def: 395, label: "Автоподтверждение, пока занято меньше" },
  autoConfirm: { key: "parking.autoConfirm", def: false, label: "Автоподтверждение заявок с сайта" },
} as const;

// Ссылки, которые подставляются в сообщения клиентам. Ждём от заказчика.
export const LINKS = {
  route: { key: "links.route", def: "", label: "Ссылка на маршрут проезда" },
  review: { key: "links.review", def: "", label: "Ссылка на отзывы" },
  video: { key: "links.video", def: "", label: "Видео «как проехать»" }, // МФ-2: видео ждём от заказчика
} as const;

export type ParkingSettings = {
  capacityTotal: number;
  capacityTruck: number;
  autoConfirmLimit: number;
  autoConfirm: boolean;
};

function num(value: unknown, def: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : def;
}

// db — транзакция вызывающего (автоподтверждение): второе соединение из пула изнутри транзакции не берём
export async function parkingSettings(db: Pick<Prisma.TransactionClient, "setting"> = prisma): Promise<ParkingSettings> {
  const keys = Object.values(SETTINGS).map((s) => s.key);
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const capacityTotal = num(get(SETTINGS.capacityTotal.key), SETTINGS.capacityTotal.def);
  return {
    capacityTotal,
    capacityTruck: num(get(SETTINGS.capacityTruck.key), SETTINGS.capacityTruck.def),
    // порог не может превышать вместимость: иначе автоподтверждение уйдёт за пределы стоянки
    autoConfirmLimit: Math.min(capacityTotal, num(get(SETTINGS.autoConfirmLimit.key), SETTINGS.autoConfirmLimit.def)),
    autoConfirm: get(SETTINGS.autoConfirm.key) === true,
  };
}

export async function setSetting(key: string, value: number | boolean | string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export type SiteLinks = { route: string; review: string; video: string };

// db — транзакция вызывающего: сообщение ставится в очередь внутри неё, второе соединение из пула не берём
export async function siteLinks(db: Pick<Prisma.TransactionClient, "setting"> = prisma): Promise<SiteLinks> {
  const raw = await rawLinks(db);
  // Пока заказчик не дал ссылки, в сообщении остаётся адрес сайта — пустая строка выглядела бы обрывом
  return { route: raw.route || routeFallback(), review: raw.review, video: raw.video };
}

export function routeFallback(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return site ? `${site}/#directions` : "";
}

// Сырые значения для формы «Ссылки и политика»: без запасного адреса маршрута (МФ-2 Р15)
export async function rawLinks(db: Pick<Prisma.TransactionClient, "setting"> = prisma): Promise<SiteLinks> {
  const rows = await db.setting.findMany({ where: { key: { in: Object.values(LINKS).map((l) => l.key) } } });
  const str = (key: string) => {
    const v = rows.find((r) => r.key === key)?.value;
    return typeof v === "string" ? v.trim() : "";
  };
  return { route: str(LINKS.route.key), review: str(LINKS.review.key), video: str(LINKS.video.key) };
}

// Несколько ключей одной транзакцией: форма сохраняется целиком или никак
export async function setSettings(entries: Record<string, number | boolean | string>) {
  await prisma.$transaction(Object.entries(entries).map(([key, value]) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })));
}

// Состояние минутного тика для карточки в настройках (docs/phases/PHASE_01_SCHEDULER.md, п. 7)
export async function schedulerStatus(): Promise<{ state: SchedulerState; paused: boolean; modes: Record<string, ScanMode> }> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [SCHEDULER_KEYS.heartbeat, SCHEDULER_KEYS.paused, SCHEDULER_KEYS.scans] } } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const paused = get(SCHEDULER_KEYS.paused) === true;
  return { state: heartbeatState(parseHeartbeat(get(SCHEDULER_KEYS.heartbeat)), new Date(), process.env.RUN_SCHEDULER === "1", paused), paused, modes: parseModes(get(SCHEDULER_KEYS.scans)) };
}
