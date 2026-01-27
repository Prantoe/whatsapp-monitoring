import { WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import { WS_PATH, WS_PING_INTERVAL_MS } from "./config";
import { store } from "./store";

type BroadcastFn = (type: string, data: unknown) => void;

type WsHandlers = {
  onBroadcast?: () => void | Promise<void>;
  onLogout?: () => void | Promise<void>;
};

function toText(data: any) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer).toString("utf8");
  return String(data ?? "");
}

export function createWsServer(server: HttpServer, handlers: WsHandlers = {}) {
  const { onBroadcast, onLogout } = handlers;
  const wss = new WebSocketServer({ server, path: WS_PATH });

  const broadcast: BroadcastFn = (type, data) => {
    const payload = JSON.stringify({ type, data });
    let ok = 0;
    let fail = 0;
  
    // @ts-ignore
    for (const c of wss.clients) {
      if (c.readyState !== 1) continue;
      try {
        c.send(payload);
        ok++;
      } catch (e) {
        fail++;
        console.warn("[ws] send failed", e);
      }
    }
  
    if (type === "rule_seed") {
      console.log("[ws] rule_seed broadcast", { ok, fail, data });
    }
  };
  

  let broadcastInFlight = false;

  wss.on("connection", (ws: any) => {
    ws.isAlive = true;

    const onPong = () => (ws.isAlive = true);
    ws.on("pong", onPong);
    ws.on("close", () => {
      try { ws.off("pong", onPong); } catch {}
    });

    ws.on("message", async (raw: any) => {
      // ✅ parse JSON terpisah
      let parsed: any;
      try {
        parsed = JSON.parse(toText(raw));
      } catch (e: any) {
        console.warn("WS parse error:", e?.message || e);
        return;
      }

      if (String(parsed?.type || "") !== "cmd") return;

      const payload = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
      const action = String((payload as any).action || "").toLowerCase();

      try {
        if (action === "clear_all") {
          store.clearAll();
          try { ws.send(JSON.stringify({ type: "cmd_ack", data: { action: "clear_all" } })); } catch {}
          broadcast("cleared", { scope: "all" });
          return;
        }

        if (action === "clear_client") {
          const clientId = String((payload as any).clientId || "");
          if (!clientId) return;

          store.clearClient(clientId);
          try { ws.send(JSON.stringify({ type: "cmd_ack", data: { action: "clear_client", clientId } })); } catch {}
          broadcast("cleared", { scope: "client", clientId });
          return;
        }

        if (action === "broadcast") {
          if (broadcastInFlight) {
            try { ws.send(JSON.stringify({ type: "cmd_ack", data: { action: "broadcast", ok: true, skipped: true } })); } catch {}
            return;
          }

          broadcastInFlight = true;
          try { ws.send(JSON.stringify({ type: "cmd_ack", data: { action: "broadcast", ok: true } })); } catch {}

          try {
            await onBroadcast?.();
          } catch (e: any) {
            console.warn("[broadcast] failed:", e?.message || e);
            try {
              ws.send(JSON.stringify({ type: "cmd_ack", data: { action: "broadcast", ok: false, error: String(e?.message || e) } }));
            } catch {}
            broadcast("broadcast_error", { message: String(e?.message || e) });
          } finally {
            setTimeout(() => (broadcastInFlight = false), 500);
          }
          return;
        }

        if (action === "logout") {
          try { ws.send(JSON.stringify({ type: "cmd_ack", data: { action: "logout", ok: true } })); } catch {}
          await onLogout?.();
          return;
        }
      } catch (e: any) {
        console.warn("WS cmd handler error:", e?.message || e);
      }
    });

    try { ws.send(JSON.stringify({ type: "messages", data: store.snapshot() })); } catch {}
    try { ws.send(JSON.stringify({ type: "status", data: store.state })); } catch {}
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients as any) {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, WS_PING_INTERVAL_MS);

  return {
    wss,
    broadcast,
    stop() {
      try { clearInterval(interval); } catch {}
      try { wss.clients.forEach((ws: any) => { try { ws.terminate(); } catch {} }); } catch {}
      try { wss.close(); } catch {}
    },
  };
}
