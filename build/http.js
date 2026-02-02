"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpServer = createHttpServer;
const http_1 = require("http");
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const store_1 = require("./store");
const utils_1 = require("./utils");
function mimeByExt(ext) {
    switch (ext) {
        case ".html": return "text/html; charset=utf-8";
        case ".css": return "text/css; charset=utf-8";
        case ".js": return "text/javascript; charset=utf-8";
        case ".svg": return "image/svg+xml";
        case ".png": return "image/png";
        case ".jpg":
        case ".jpeg": return "image/jpeg";
        default: return "application/octet-stream";
    }
}
function createHttpServer(apiApp) {
    return (0, http_1.createServer)(async (req, res) => {
        try {
            const url = new URL(req.url || "/", "http://localhost");
            let pathname = decodeURIComponent(url.pathname || "/");
            // ✅ forward API ke express
            if (apiApp && (pathname === "/api" || pathname.startsWith("/api/"))) {
                return apiApp(req, res);
            }
            if (pathname === "/")
                pathname = "/index.html";
            if (pathname === "/healthz") {
                res.writeHead(200, {
                    "content-type": "application/json; charset=utf-8",
                    "cache-control": "no-store",
                });
                res.end(JSON.stringify({ ok: true, state: store_1.store.state, uptime: process.uptime() | 0 }));
                return;
            }
            if (pathname === "/export.csv") {
                const wantClient = url.searchParams.get("client") || "";
                const list = wantClient ? store_1.store.messages.filter((m) => m.clientId === wantClient) : store_1.store.messages;
                const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
                const header = ["ts_local", "client_id", "client_label", "direction", "from_local", "name", "body"];
                const rows = list.map((m) => [
                    new Date(m.ts).toLocaleString("id-ID"),
                    m.clientId,
                    m.clientLabel,
                    m.direction || "",
                    (0, utils_1.toLocalId)((0, utils_1.jidToPhone)(m.from)),
                    m.name || "",
                    m.body || "",
                ].map(q).join(","));
                const csv = "\uFEFF" + header.join(",") + "\r\n" + rows.join("\r\n") + "\r\n";
                const label = list[0]?.clientLabel || wantClient || "all";
                const slug = String(label).replace(/[^\w.-]+/g, "_");
                const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
                const filename = `wa_export_${slug}_${stamp}.csv`;
                res.writeHead(200, {
                    "content-type": "text/csv; charset=utf-8",
                    "cache-control": "no-store",
                    "content-disposition": `attachment; filename="${filename}"`,
                });
                res.end(csv);
                return;
            }
            // Static file
            const safePath = path_1.default.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
            const filePath = path_1.default.join(config_1.PUBLIC_DIR, safePath);
            if (!filePath.startsWith(config_1.PUBLIC_DIR)) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }
            const ext = path_1.default.extname(filePath).toLowerCase();
            const data = await (0, promises_1.readFile)(filePath);
            res.writeHead(200, { "content-type": mimeByExt(ext), "cache-control": "public, max-age=3600" });
            res.end(data);
        }
        catch {
            res.writeHead(404);
            res.end("Not found");
        }
    });
}
