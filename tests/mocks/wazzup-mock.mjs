// Заглушка Wazzup API v3 для юнит- и e2e-тестов Ф14 (docs/phases/PHASE_14_WAZZUP.md §4.13).
// Настоящий Wazzup в тестах не трогаем никогда: dev-сервер стартует с WAZZUP_API_BASE на эту заглушку.
// Отдельно: node tests/mocks/wazzup-mock.mjs --port 3914 [--key e2e-wazzup-key-local-only]
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export const MOCK_CHANNEL_ID = "11111111-1111-4111-8111-111111111111";

export async function startWazzupMock({ port = 0, key = "e2e-wazzup-key-local-only", delayMs = 0 } = {}) {
  const state = {
    channels: [{ channelId: MOCK_CHANNEL_ID, transport: "whatsapp", plainId: "79990000001", state: "active" }],
    /** @type {{ status: number, body: unknown } | null} ответ на GET /channels вместо списка (401 — ключ не принят) */
    channelsFail: null,
    /** @type {{ method: string, path: string, auth: string, body: any }[]} все запросы */
    requests: [],
    /** @type {any[]} принятые POST /message */
    messages: [],
    /** @type {{ status?: number, body?: unknown, delayMs?: number }[]} очередь особых ответов для POST /message */
    failNext: [],
    /** @type {Map<string, number>} crmMessageId → время: повтор в течение 60 с → REPEATED_CRM_MESSAGE_ID */
    crmIds: new Map(),
    /** @type {{ id: string, name: string }[]} */
    users: [],
    /** @type {any[]} */
    iframes: [],
    unanswered: 0,
    /** @type {{ uri: string, testStatus: number, subscriptions: unknown } | null} */
    webhook: null,
    delayMs,
  };
  let base = "";

  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    const auth = req.headers.authorization ?? "";
    state.requests.push({ method: req.method, path: url.pathname, auth, body });
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));

    // Окно чатов: то, что откроется в iframe
    if (req.method === "GET" && url.pathname === "/chat-frame") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><title>Wazzup mock</title><p>Окно чатов (заглушка): ${url.searchParams.get("scope")}</p>`);
    }
    if (!url.pathname.startsWith("/v3/")) return send(res, 404, { error: "NOT_FOUND" });
    if (auth !== `Bearer ${key}`) return send(res, 401, { error: "UNAUTHORIZED", description: "Invalid API key" });
    const path = url.pathname.slice(3);

    if (req.method === "GET" && path === "/channels") return state.channelsFail ? send(res, state.channelsFail.status, state.channelsFail.body) : send(res, 200, state.channels);

    if (req.method === "POST" && path === "/message") {
      const fail = state.failNext.shift();
      // { delayMs } без status — сообщение принято и ушло, но ответ опоздал (отправщик не дождался)
      if (fail?.delayMs) await new Promise((r) => setTimeout(r, fail.delayMs));
      if (fail?.status) return send(res, fail.status, fail.body);
      const b = body ?? {};
      const seen = state.crmIds.get(b.crmMessageId);
      if (b.crmMessageId && seen && Date.now() - seen < 60_000) return send(res, 400, { error: "REPEATED_CRM_MESSAGE_ID", description: "Repeated crmMessageId" });
      const ch = state.channels.find((c) => c.channelId === b.channelId);
      if (!ch) return send(res, 400, { error: "CHANNEL_NOT_FOUND" });
      if (ch.state !== "active") return send(res, 400, { error: "CHANNEL_BLOCKED" });
      if (!b.text || (!b.chatId && !b.phone)) return send(res, 400, { error: "INVALID_MESSAGE_DATA" });
      const messageId = randomUUID();
      if (b.crmMessageId) state.crmIds.set(b.crmMessageId, Date.now());
      state.messages.push({ ...b, messageId });
      return send(res, 201, { messageId, chatId: b.chatId ?? b.phone });
    }

    if (req.method === "PATCH" && path === "/webhooks") {
      const uri = body?.webhooksUri;
      let testStatus = 0;
      try {
        const r = await fetch(uri, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }), signal: AbortSignal.timeout(30_000) });
        testStatus = r.status;
      } catch {
        testStatus = -1;
      }
      state.webhook = { uri, testStatus, subscriptions: body?.subscriptions };
      return testStatus === 200 ? send(res, 200, { ok: true }) : send(res, 400, { error: "WEBHOOK_TEST_FAILED" });
    }

    if (req.method === "POST" && path === "/users") {
      if (!Array.isArray(body) || !body.length) return send(res, 400, { error: "INVALID_USERS_DATA" });
      for (const u of body) {
        const i = state.users.findIndex((x) => x.id === u.id);
        if (i >= 0) state.users[i] = u;
        else state.users.push(u);
      }
      return send(res, 200);
    }

    if (req.method === "POST" && path === "/iframe") {
      state.iframes.push(body);
      return send(res, 200, { url: `${base}/chat-frame?scope=${encodeURIComponent(body?.scope ?? "")}&token=${randomUUID()}` });
    }

    const un = path.match(/^\/unanswered\/(.+)$/);
    if (req.method === "GET" && un) return send(res, 200, { counterV2: state.unanswered, type: "red", lastMsgDateTime: new Date().toISOString() });

    return send(res, 404, { error: "NOT_FOUND" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve); // все адреса: localhost у fetch бывает и ::1, и 127.0.0.1
  });
  const actual = server.address().port;
  base = `http://localhost:${actual}`;
  return {
    port: actual,
    url: `${base}/v3`,
    state,
    close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = (n) => process.argv.indexOf(`--${n}`);
  const port = i("port") > -1 ? Number(process.argv[i("port") + 1]) : 3914;
  const key = i("key") > -1 ? process.argv[i("key") + 1] : undefined;
  startWazzupMock({ port, key }).then((m) => console.log(`Заглушка Wazzup: ${m.url}`));
}
