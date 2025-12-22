import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFile, rm } from 'fs/promises';
import path from 'path';

import wweb from 'whatsapp-web.js';
const { Client, LocalAuth } = wweb as any;

/* ========== CONFIG ========== */
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, '..', 'public');

const AUTH_CLIENT_ID = 'wa-monitor';
const AUTH_DATA_PATH = path.join(process.cwd(), '.wwebjs_auth');
const SESSION_DIR = path.join(AUTH_DATA_PATH, `session-${AUTH_CLIENT_ID}`);
const CACHE_DIR = path.join(process.cwd(), '.wwebjs_cache');

/* ========== STATE ========== */
type State = 'booting' | 'scan_qr' | 'authenticated' | 'ready' | 'disconnected' | 'auth_failure';
let state: { state: State; me: string | null; error?: string } = { state: 'booting', me: null };

type Msg = {
    clientId: string;
    clientLabel: string;
    clientPhone?: string;
    from: string;
    name?: string;
    body: string;
    ts: number;
    direction: 'in' | 'out';
    isRead?: boolean;
};

const MESSAGES: Msg[] = [];
const pushMsg = (m: Msg) => { MESSAGES.push(m); if (MESSAGES.length > 200) MESSAGES.shift(); };
const LAST_READ = new Map<string, number>();

/* ========== Utils ========== */
const pickChromePath = () => {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
    if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    return '/usr/bin/google-chrome';
};

const jidToPhone = (jid: string) => String(jid || '').replace(/@.+$/, '');
const toLocalId = (num: string) => (num?.startsWith('62') ? ('0' + num.slice(2)) : num);

// --- resolvePeer: pastikan ambil contact dari chat untuk DM ---
async function resolvePeer(msg: any) {
    const chat = await msg.getChat();
    const clientId = chat?.id?._serialized || msg.from;

    if (chat?.isGroup) {
        return { clientId, clientLabel: chat.name || clientId, isGroup: true };
    }

    // DM: lawan bicara = contact dari chat (bukan dari msg, yang bisa "Me")
    const peer = (await chat.getContact?.()) || (await msg.getContact());
    const phone = toLocalId(jidToPhone(clientId));
    const label = peer?.verifiedName || peer?.pushname || peer?.name || phone;

    return { clientId, clientLabel: label, isGroup: false };
}


/* ========== HTTP (1 page + CSV + healthz) ========== */
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        let pathname = decodeURIComponent(url.pathname || '/');
        if (pathname === '/') pathname = '/index.html';

        if (pathname === '/healthz') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ ok: true, state, uptime: process.uptime() | 0 }));
            return;
        }

        if (pathname === '/export.csv') {
            const wantClient = url.searchParams.get('client') || '';
            const list = wantClient ? MESSAGES.filter(m => m.clientId === wantClient) : MESSAGES;

            const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const header = ['ts_local', 'client_id', 'client_label', 'direction', 'from_local', 'name', 'body'];
            const rows = list.map(m => [
                new Date(m.ts).toLocaleString('id-ID'),
                m.clientId,
                m.clientLabel,
                m.direction || '',
                toLocalId(jidToPhone(m.from)),
                m.name || '',
                m.body || ''
            ].map(q).join(','));

            const csv = '\uFEFF' + header.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
            const label = list[0]?.clientLabel || wantClient || 'all';
            const slug = String(label).replace(/[^\w.-]+/g, '_');
            const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
            const filename = `wa_export_${slug}_${stamp}.csv`;

            res.writeHead(200, {
                'content-type': 'text/csv; charset=utf-8',
                'cache-control': 'no-store',
                'content-disposition': `attachment; filename="${filename}"`
            });
            res.end(csv);
            return;
        }

        // Static
        const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
        const filePath = path.join(PUBLIC, safePath);
        if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }

        const ext = path.extname(filePath).toLowerCase();
        const mime =
            ext === '.html' ? 'text/html; charset=utf-8' :
                ext === '.css' ? 'text/css; charset=utf-8' :
                    ext === '.js' ? 'text/javascript; charset=utf-8' :
                        ext === '.svg' ? 'image/svg+xml' :
                            ext === '.png' ? 'image/png' :
                                ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                                    'application/octet-stream';

        const data = await readFile(filePath);
        res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=3600' });
        res.end(data);
    } catch {
        res.writeHead(404); res.end('Not found');
    }
});

/* ========== WS (with keepalive) ========== */
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: any) => {
    ws.isAlive = true;
    const onPong = () => { ws.isAlive = true; };
    ws.on('pong', onPong);
    ws.on('close', () => { try { ws.off('pong', onPong); } catch { } });

    // Perintah dari FE
    ws.on('message', async (data: any) => {
        try {
            const text =
                typeof data === 'string' ? data :
                    Buffer.isBuffer(data) ? data.toString('utf8') :
                        Buffer.from(data as ArrayBuffer).toString('utf8');

            const { type, data: payload } = JSON.parse(text);

            if (type === 'cmd') {
                const action = String(payload?.action || '').toLowerCase();

                if (action === 'logout') {
                    state = { state: 'disconnected', me: null, error: 'manual logout' };
                    broadcast('status', state);
                    try { await client?.logout?.(); } catch { }
                    scheduleRestart(true);
                    return;
                }

                if (action === 'clear_all') {
                    MESSAGES.length = 0;
                    try { ws.send(JSON.stringify({ type: 'cmd_ack', data: { action: 'clear_all' } })); } catch { }
                    broadcast('cleared', { scope: 'all' });
                    return;
                }

                if (action === 'clear_client') {
                    const clientId = String(payload?.clientId || '');
                    if (clientId) {
                        for (let i = MESSAGES.length - 1; i >= 0; i--) {
                            if (MESSAGES[i].clientId === clientId) MESSAGES.splice(i, 1);
                        }
                        try { ws.send(JSON.stringify({ type: 'cmd_ack', data: { action: 'clear_client', clientId } })); } catch { }
                        broadcast('cleared', { scope: 'client', clientId });
                    }
                    return;
                }

                if (action === 'clear_tag') {
                    const clientId = String(payload?.tag || '');
                    if (clientId) {
                        for (let i = MESSAGES.length - 1; i >= 0; i--) {
                            if (MESSAGES[i].clientId === clientId) MESSAGES.splice(i, 1);
                        }
                        broadcast('cleared', { scope: 'client', clientId });
                    }
                    return;
                }

                if (action === 'mark_read_client') {
                    const clientId = String(payload?.clientId || '');
                    if (!clientId) return;
                  
                    LAST_READ.set(clientId, Date.now());
                  
                    try { ws.send(JSON.stringify({ type: 'cmd_ack', data: { action: 'mark_read_client', clientId } })); } catch {}
                    broadcast('marked', { scope: 'client', clientId });
                    return;
                  }
            }
        } catch (e) {
            console.warn('WS cmd parse error:', e);
        }
    });

    // snapshot awal
    try {
        const snapshot = MESSAGES.map(m => ({
            ...m,
            isRead: m.direction === 'out' || m.ts <= (LAST_READ.get(m.clientId) || 0)
        }));
        ws.send(JSON.stringify({ type: 'messages', data: snapshot }));
    } catch { }
    try { ws.send(JSON.stringify({ type: 'status', data: state })); } catch { }
    try { ws.send(JSON.stringify({ type: 'messages', data: MESSAGES })); } catch { }
});

const broadcast = (type: string, data: unknown) => {
    const payload = JSON.stringify({ type, data });
    // @ts-ignore
    for (const c of wss.clients) if (c.readyState === 1) c.send(payload);
};

const interval = setInterval(() => {
    for (const ws of wss.clients as any) {
        if (ws.isAlive === false) { try { ws.terminate(); } catch { } continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { }
    }
}, 30_000);

/* ========== WA CLIENT (factory + restart) ========== */
let client: any = null;
let restarting = false;
let restartTimer: NodeJS.Timeout | null = null;
let generation = 0;

function makeClient() {
    return new Client({
        authStrategy: new LocalAuth({ clientId: AUTH_CLIENT_ID, dataPath: AUTH_DATA_PATH }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
            executablePath: pickChromePath(),
            timeout: 60_000,
        }
    });
}

function clearRestartTimer() {
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
}

function scheduleRestart(forceClean: boolean, delayMs = 600) {
    if (shuttingDown) return;
    if (restarting) return;
    clearRestartTimer();
    restartTimer = setTimeout(() => { if (!restarting) void restartClient(forceClean); }, delayMs);
}

async function restartClient(forceClean: boolean) {
    if (restarting) return;
    restarting = true;
    try {
        await new Promise(r => setTimeout(r, 250));

        try { client?.removeAllListeners?.(); } catch { }
        try { await client?.destroy?.(); } catch { }

        if (forceClean) {
            try { await rm(SESSION_DIR, { recursive: true, force: true }); } catch { }
            try { await rm(CACHE_DIR, { recursive: true, force: true }); } catch { }
        }

        state = { state: 'booting', me: null };
        broadcast('status', state);

        client = makeClient();
        const gen = ++generation;
        bindClientEvents(client, gen);
        await client.initialize();
    } finally {
        restarting = false;
    }
}

async function pushAndBroadcast(msg: any, direction: 'in' | 'out') {
    const { clientId, clientLabel, isGroup } = await resolvePeer(msg);
    const clientPhone = !isGroup ? toLocalId(jidToPhone(clientId)) : '';

    let name = '';
    try {
        if (isGroup) {
            name = msg.fromMe ? 'Me' : (
                (await msg.getContact())?.pushname ||
                (await msg.getContact())?.name ||
                toLocalId(jidToPhone((await msg.getContact())?.id?._serialized || msg.author || ''))
            );
        } else {
            name = direction === 'out'
                ? 'Me'
                : ((await msg.getContact())?.verifiedName ||
                    (await msg.getContact())?.pushname ||
                    (await msg.getContact())?.name ||
                    toLocalId(jidToPhone(msg.from)));
        }
    } catch {
        name = direction === 'out' ? 'Me' : toLocalId(jidToPhone(msg.from));
    }

    const body = String(msg.body || '') || (msg.type && msg.type !== 'chat' ? `[${msg.type}]` : '');

    const ts = msg.timestamp * 1000;
    const lastRead = LAST_READ.get(clientId) || 0;
    const isRead = (direction === 'out') || (ts <= lastRead);

    const data: Msg = {
        clientId, clientLabel, clientPhone,
        from: msg.from, name, body,
        ts, direction, isRead
    };

    pushMsg(data);
    broadcast('message', data);
}


function bindClientEvents(c: any, gen: number) {
    const isStale = () => gen !== generation;

    c.on('qr', (qr: string) => {
        if (isStale()) return;
        if (state.state === 'authenticated' || state.state === 'ready') return;
        state = { state: 'scan_qr', me: null };
        broadcast('status', state);
        broadcast('qr', { qr });
    });

    c.on('authenticated', () => {
        if (isStale()) return;
        clearRestartTimer();
        if (state.state !== 'ready') {
            state = { state: 'authenticated', me: null };
            broadcast('status', state);
        }
    });

    c.on('ready', () => {
        if (isStale()) return;
        clearRestartTimer();
        state = { state: 'ready', me: c.info?.wid?._serialized ?? null };
        broadcast('status', state);
        console.log('✅ WhatsApp client ready as', state.me);
    });

    c.on('message', async (msg: any) => {
        if (isStale()) return;
        if (msg.fromMe) return;                 // hindari dobel
        await pushAndBroadcast(msg, 'in');
    });

    // Outbound saja
    c.on('message_create', async (msg: any) => {
        if (isStale()) return;
        if (!msg.fromMe) return;                // hanya pesan yang kita kirim
        await pushAndBroadcast(msg, 'out');
    });

    c.on('auth_failure', (m: string) => {
        if (isStale()) return;
        state = { state: 'auth_failure', me: null, error: m };
        broadcast('status', state);
        console.warn('auth_failure:', m);
        scheduleRestart(true);
    });

    c.on('disconnected', (reason: string) => {
        if (isStale()) return;
        state = { state: 'disconnected', me: null, error: reason };
        broadcast('status', state);
        console.warn('disconnected:', reason);
        const R = String(reason || '').toUpperCase();
        const force = R.includes('LOGOUT') || R.includes('UNPAIRED');
        scheduleRestart(force);
    });

    c.on('loading_screen', () => { /* no-op */ });
}

/* ========== Shutdown ========== */
let shuttingDown = false;

function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    try { clearInterval(interval); } catch { }
    try { if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; } } catch { }

    try { wss.clients.forEach((ws: any) => { try { ws.terminate(); } catch { } }); } catch { }
    try { wss.close(); } catch { }

    try { (server as any).closeIdleConnections?.(); } catch { }
    try { (server as any).closeAllConnections?.(); } catch { }

    try {
        server.close(() => {
            (async () => { try { await client?.destroy?.(); } catch { } process.exit(code); })();
        });
    } catch {
        (async () => { try { await client?.destroy?.(); } catch { } process.exit(code); })();
    }

    setTimeout(() => process.exit(code), 3000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/* ========== START ========== */
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    void restartClient(false);
});

/* ========== Noise filter Puppeteer ========== */
process.on('unhandledRejection', (e: any) => {
    const msg = String(e?.message || e || '');
    if (/(Execution context was destroyed|Session closed|Target closed|Navigation.*occurred)/i.test(msg)) {
        console.warn(' Puppeteer navigation/close — ignored');
        return;
    }
    console.warn('⚠️ UnhandledRejection:', e);
});

process.on('uncaughtException', (e: any) => {
    const msg = String(e?.message || e || '');
    if (/(Session closed|Target closed)/i.test(msg)) {
        console.warn('⚠️ (benign) Puppeteer closed — ignored');
        return;
    }
    console.error('🔥 UncaughtException:', e);
});
