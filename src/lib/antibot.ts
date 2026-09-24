// Антибот формы заявки: «слишком быстро» по метке времени браузера.
export const MIN_FILL_MS = 1500;
const SKEW_MS = 10 * 60_000;

// Часы клиента могут спешить или отставать: неправдоподобной метке не верим вовсе, заявку не теряем.
export function tooFast(now: number, ts?: number | null, minMs = MIN_FILL_MS): boolean {
  if (!ts) return false;
  const elapsed = now - ts;
  if (elapsed < 0 || elapsed > SKEW_MS) return false;
  return elapsed < minMs;
}
