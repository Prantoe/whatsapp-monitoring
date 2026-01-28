// src/server.ts
import "dotenv/config";
import express from "express";

import { PORT } from "./config";
import { createHttpServer } from "./http";
import { createWsServer } from "./ws";
import { createWaManager } from "./wa";
import {
  loadActiveRulesFromStore
} from "./activeRules";

import { RulesStore } from "./rulesStore";
import { createRulesRouter } from "./routes/rules";

/* ========== API (Express) ========== */
const app = express();
app.use(express.json());

const rulesStore = new RulesStore("rules.json");
app.use("/api/rules", createRulesRouter(rulesStore));

/* ========== HTTP + WS ========== */
const server = createHttpServer(app);

let wa: ReturnType<typeof createWaManager>;

const ws = createWsServer(server, {
  onBroadcast: async () => wa.startBroadcast(),
  onLogout: async () => wa.logoutAndRestart(),
});

wa = createWaManager(ws.broadcast);

/* ========== Shutdown ========== */
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  try { ws.stop(); } catch {}
  try {
    (server as any).closeIdleConnections?.();
    (server as any).closeAllConnections?.();
    server.close(async () => {
      try { await wa.stop(); } catch {}
      process.exit(code);
    });
  } catch {
    (async () => {
      try { await wa.stop(); } catch {}
      process.exit(code);
    })();
  }

  setTimeout(() => process.exit(code), 3000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/* ========== Noise filter Puppeteer ========== */
process.on("unhandledRejection", (e: any) => {
  const msg = String(e?.message || e || "");
  if (/(Execution context was destroyed|Session closed|Target closed|Navigation.*occurred)/i.test(msg)) {
    console.warn("⚠️ Puppeteer navigation/close — ignored");
    return;
  }
  console.warn("⚠️ UnhandledRejection:", e);
});

process.on("uncaughtException", (e: any) => {
  const msg = String(e?.message || e || "");
  if (/(Session closed|Target closed)/i.test(msg)) {
    console.warn("⚠️ (benign) Puppeteer closed — ignored");
    return;
  }
  console.error("🔥 UncaughtException:", e);
});

/* ========== Boot rules (existing flow) ========== */
(async () => {
    await loadActiveRulesFromStore(rulesStore);
    console.log("✅ Active rules loaded from rules.json");
})();


/* ========== START ========== */
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  void wa.restartClient(false);
});
