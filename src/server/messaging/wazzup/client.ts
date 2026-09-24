// Низкоуровневый HTTP к Wazzup: база, ключ, таймаут, разбор кода ошибки. Про Outbox не знает.
// Без server-only: конфиг приходит параметром, юнит-тест гоняет его против локальной заглушки.
import type { ApiFailure } from "./errors";

export type ApiConfig = { base: string; key: string };
export type ApiResult<T> = ({ ok: true; status: number; json: T | null }) | ({ ok: false } & ApiFailure);

export const DEFAULT_BASE = "https://api.wazzup24.com/v3";

// signal вызывающего (таймаут отправщика) главнее; свой таймаут — только если сигнала нет
export async function api<T = unknown>(
  cfg: ApiConfig,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  opts: { timeoutMs: number; signal?: AbortSignal } = { timeoutMs: 5_000 },
): Promise<ApiResult<T>> {
  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${cfg.base.replace(/\/$/, "")}${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return name === "TimeoutError" || name === "AbortError" || signal.aborted ? { ok: false, kind: "timeout" } : { ok: false, kind: "network" };
  }
  let json: unknown = null;
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.ok) return { ok: true, status: res.status, json: json as T | null };
  const code = json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : null;
  return { ok: false, kind: "http", status: res.status, code };
}
