import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import path from "path";
import { PUBLIC_DIR } from "./config";
import { store } from "./store";
import { jidToPhone, toLocalId } from "./utils";

type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void;

function mimeByExt(ext: string) {
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

export function createHttpServer(apiApp?: ApiHandler) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      let pathname = decodeURIComponent(url.pathname || "/");

      // ✅ forward API ke express
      if (apiApp && (pathname === "/api" || pathname.startsWith("/api/"))) {
        return apiApp(req, res);
      }

      if (pathname === "/") pathname = "/index.html";

      if (pathname === "/healthz") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify({ ok: true, state: store.state, uptime: process.uptime() | 0 }));
        return;
      }

      if (pathname === "/export.csv") {
        const wantClient = url.searchParams.get("client") || "";
        const list = wantClient ? store.messages.filter((m) => m.clientId === wantClient) : store.messages;

        const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const header = ["ts_local", "client_id", "client_label", "direction", "from_local", "name", "body"];
        const rows = list.map((m) =>
          [
            new Date(m.ts).toLocaleString("id-ID"),
            m.clientId,
            m.clientLabel,
            m.direction || "",
            toLocalId(jidToPhone(m.from)),
            m.name || "",
            m.body || "",
          ].map(q).join(",")
        );

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
      const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
      const filePath = path.join(PUBLIC_DIR, safePath);

      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const data = await readFile(filePath);
      res.writeHead(200, { "content-type": mimeByExt(ext), "cache-control": "public, max-age=3600" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}
