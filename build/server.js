"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/server.ts
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const http_1 = require("./http");
const ws_1 = require("./ws");
const wa_1 = require("./wa");
const activeRules_1 = require("./activeRules");
const rulesStore_1 = require("./rulesStore");
const rules_1 = require("./routes/rules");
/* ========== API (Express) ========== */
const app = (0, express_1.default)();
const publicPath = path_1.default.join(__dirname, "../public");
app.use(express_1.default.static(publicPath));
app.get("/", (_req, res) => {
    res.sendFile(path_1.default.join(publicPath, "index.html"));
});
app.use(express_1.default.json());
const rulesStore = new rulesStore_1.RulesStore("rules.json");
app.use("/api/rules", (0, rules_1.createRulesRouter)(rulesStore));
/* ========== HTTP + WS ========== */
const server = (0, http_1.createHttpServer)(app);
let wa;
const ws = (0, ws_1.createWsServer)(server, {
    onBroadcast: async () => wa.startBroadcast(),
    onLogout: async () => wa.logoutAndRestart(),
});
wa = (0, wa_1.createWaManager)(ws.broadcast);
/* ========== Shutdown ========== */
let shuttingDown = false;
function shutdown(code = 0) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    try {
        ws.stop();
    }
    catch { }
    try {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(async () => {
            try {
                await wa.stop();
            }
            catch { }
            process.exit(code);
        });
    }
    catch {
        (async () => {
            try {
                await wa.stop();
            }
            catch { }
            process.exit(code);
        })();
    }
    setTimeout(() => process.exit(code), 3000).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
/* ========== Noise filter Puppeteer ========== */
process.on("unhandledRejection", (e) => {
    const msg = String(e?.message || e || "");
    if (/(Execution context was destroyed|Session closed|Target closed|Navigation.*occurred)/i.test(msg)) {
        console.warn("⚠️ Puppeteer navigation/close — ignored");
        return;
    }
    console.warn("⚠️ UnhandledRejection:", e);
});
process.on("uncaughtException", (e) => {
    const msg = String(e?.message || e || "");
    if (/(Session closed|Target closed)/i.test(msg)) {
        console.warn("⚠️ (benign) Puppeteer closed — ignored");
        return;
    }
    console.error("🔥 UncaughtException:", e);
});
/* ========== Boot rules (existing flow) ========== */
(async () => {
    await (0, activeRules_1.loadActiveRulesFromStore)(rulesStore);
    console.log("✅ Active rules loaded from rules.json");
})();
/* ========== START ========== */
server.listen(config_1.PORT, () => {
    console.log(`🚀 Server running:${config_1.PORT}`);
    void wa.restartClient(false);
});
