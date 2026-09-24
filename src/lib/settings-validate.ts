// Проверки страниц «Настройки» (МФ-2). Чистые, без server-only: сервер решает по ним, юнит-тесты проверяют их.
import type { Role } from "@prisma/client";
import { PH } from "@/server/automations/render";

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

export const LINK_MAX = 500;
export const TEMPLATE_MAX = 4000;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const PRICE_MAX = 100_000;
export const NO_SHOW_HOURS = { min: 1, max: 168 } as const;

// Ссылка уходит в сообщение клиенту: только http/https или пусто (пусто — строка выпадает из текста)
export function validateLink(raw: string): Check<string> {
  const value = (raw ?? "").trim();
  if (!value) return { ok: true, value: "" };
  if (value.length > LINK_MAX) return { ok: false, error: `Ссылка длиннее ${LINK_MAX} символов` };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Это не ссылка: нужен адрес вида https://…" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Ссылка должна начинаться с https:// или http://" };
  return { ok: true, value };
}

// Вход ищет login.toLowerCase(), поэтому храним в нижнем регистре
export function validateLogin(raw: string): Check<string> {
  const value = (raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(value)) {
    return { ok: false, error: "Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание; начинается с буквы или цифры" };
  }
  return { ok: true, value };
}

export function validatePassword(pw: string): Check<string> {
  const value = pw ?? "";
  if (value.length < PASSWORD_MIN) return { ok: false, error: `Пароль — не короче ${PASSWORD_MIN} символов` };
  if (value.length > PASSWORD_MAX) return { ok: false, error: `Пароль — не длиннее ${PASSWORD_MAX} символов` };
  return { ok: true, value };
}

export function validateTitle(raw: string, what: string, max = 100): Check<string> {
  const value = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: `${what}: не может быть пустым` };
  if (value.length > max) return { ok: false, error: `${what}: не длиннее ${max} символов` };
  return { ok: true, value };
}

// ── Текст шаблона (Р6): ошибка не даёт сохранить, предупреждение сохраняется после подтверждения ──

export type BodyCheck = { errors: string[]; warnings: string[] };

// Регулярка переменных — та же, что у рендера (одно правило в одном месте)
const hasVar = (body: string, name: string) => [...body.matchAll(PH)].some((m) => m[1] === name);

export function unknownVars(body: string, known: readonly string[]): string[] {
  const set = new Set(known);
  return [...new Set([...body.matchAll(PH)].map((m) => m[1]).filter((k) => !set.has(k)))];
}

export function validateTemplateBody(body: string, known: readonly string[], prevBody?: string | null): BodyCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!body.trim()) errors.push("Текст сообщения пустой");
  if (body.length > TEMPLATE_MAX) errors.push(`Текст длиннее ${TEMPLATE_MAX} символов (сейчас ${body.length})`);
  const unknown = unknownVars(body, known);
  if (unknown.length) errors.push(`Неизвестные переменные: ${unknown.map((k) => `{{${k}}}`).join(", ")} — проверьте написание по списку ниже`);
  // Незакрытая или пустая скобка уходит клиенту как есть
  const stray = body.replace(PH, "");
  if (/\{\{|\}\}/.test(stray)) errors.push("Есть незакрытые или пустые скобки {{ }}");
  if (prevBody && hasVar(prevBody, "booking.number") && !hasVar(body, "booking.number")) {
    warnings.push("Из текста пропал номер брони {{booking.number}} — клиенту будет труднее сослаться на бронь");
  }
  if (/\p{Extended_Pictographic}/u.test(body)) warnings.push("В тексте есть эмодзи — вид сообщений строгий, без эмодзи (решение 22.09)");
  if (/^\s*#/m.test(stray) || /\*[^*\n]+\*/.test(stray) || /(^|[\s(])_[^_\n]+_(?=$|[\s).,!?:;])/m.test(stray)) {
    warnings.push("В тексте есть разметка (*, _, # в начале строки) — мессенджеры покажут её символами");
  }
  return { errors, warnings };
}

// ── Тарифы (Р11 с правкой критики): бронь не должна молча стать бесплатной ──

export type TariffLike = { id: string; kind: string; unit: string; minDays: number | null; vehicleType: string | null; roomType: string | null; isActive: boolean };

export function validateTariffPrice(price: number, t: Pick<TariffLike, "kind" | "vehicleType">): Check<number> {
  if (!Number.isInteger(price) || price < 0 || price > PRICE_MAX) return { ok: false, error: `Цена — целое число от 0 до ${PRICE_MAX.toLocaleString("ru-RU")} ₽` };
  // 0 — «по запросу», так цену читает рендер сообщений; у остальных 0 сделал бы бронь бесплатной
  if (price === 0 && !(t.kind === "PARKING" && t.vehicleType === "TRUCK")) return { ok: false, error: "Цена 0 («по запросу») допустима только у грузовых" };
  return { ok: true, value: price };
}

// Выключить можно, если подбор цены (pickTariff / quote) после этого всё ещё находит тариф:
// у парковки — активный тариф типа ТС со стартовым сроком (minDays пусто или 0), у комнат — активные сутки на этот номер
export function tariffDisableError(target: TariffLike, all: TariffLike[]): string | null {
  const others = all.filter((t) => t.id !== target.id && t.isActive && t.kind === target.kind);
  if (target.kind === "PARKING") {
    if ((target.minDays ?? 0) !== 0) return null;
    const left = others.some((t) => t.vehicleType === target.vehicleType && (t.minDays ?? 0) === 0);
    return left ? null : "Это единственный действующий тариф этого типа машины с первых суток: без него брони считались бы бесплатными и долг за перестой — нулём";
  }
  if (target.kind === "ROOM" && target.unit === "24h") {
    const left = others.some((t) => t.roomType === target.roomType && t.unit === "24h");
    return left ? null : "Это единственный действующий суточный тариф этого номера: без него брони номера считались бы бесплатными";
  }
  return null;
}

// ── Пользователи (Р10): себя не выключаем и не понижаем, последнего владельца не теряем ──

export type UserState = { id: string; role: Role; isActive: boolean };

export function userChangeError(actorId: string, before: UserState, after: Pick<UserState, "role" | "isActive">, otherActiveOwners: number): string | null {
  if (before.id === actorId) {
    if (!after.isActive) return "Себя выключить нельзя";
    if (after.role !== before.role) return "Себе роль поменять нельзя";
  }
  const losesOwner = before.role === "OWNER" && before.isActive && (after.role !== "OWNER" || !after.isActive);
  if (losesOwner && otherActiveOwners === 0) return "Это последний действующий владелец: без него настройки менять будет некому";
  return null;
}

export function validateNoShowHours(n: number): Check<number> {
  if (!Number.isInteger(n) || n < NO_SHOW_HOURS.min || n > NO_SHOW_HOURS.max) return { ok: false, error: `Часы — целое число от ${NO_SHOW_HOURS.min} до ${NO_SHOW_HOURS.max}` };
  return { ok: true, value: n };
}

// ── Правило отказа (МФ-1): выключить его при включённом автоподтверждении — «мест нет, а отказать нечем» ──

export function isRejectRule(trigger: string, params: unknown): boolean {
  return trigger === "STATUS_CHANGED" && !!params && typeof params === "object" && (params as { status?: unknown }).status === "REJECTED";
}

export function rejectRuleWarning(rule: { trigger: string; triggerParams: unknown; isActive: boolean }, nextActive: boolean, autoConfirm: boolean): string | null {
  if (!rule.isActive || nextActive || !autoConfirm || !isRejectRule(rule.trigger, rule.triggerParams)) return null;
  return "Автоподтверждение включено: без этого правила клиент, которому не хватило места, не получит сообщение об отказе.";
}
