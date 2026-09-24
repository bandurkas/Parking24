// Четвёртый аргумент notify(): транзакция (прежняя форма, её зовут соседние фазы) или { tx, key }.
// Без Prisma и server-only — под юнит-тестом.
export type NotifyOpts<Tx> = { tx?: Tx; key?: string };

export function notifyOpts<Tx extends object>(arg: Tx | NotifyOpts<Tx> | undefined): NotifyOpts<Tx> {
  if (!arg) return {};
  return typeof (arg as { adminNotice?: unknown }).adminNotice === "object" ? { tx: arg as Tx } : (arg as NotifyOpts<Tx>);
}
