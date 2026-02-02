"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWaManager = createWaManager;
// src/wa.ts
const promises_1 = require("fs/promises");
const whatsapp_web_js_1 = __importDefault(require("whatsapp-web.js"));
const config_1 = require("./config");
const store_1 = require("./store");
const utils_1 = require("./utils");
const broadcast_1 = require("./broadcast");
const telegram_1 = require("./telegram");
const activeRules_1 = require("./activeRules");
const rulesStore_1 = require("./rulesStore");
const generateFile_1 = require("./generateFile");
const broadcast_cron_1 = require("./jobs/broadcast.cron");
const { Client, LocalAuth } = whatsapp_web_js_1.default;
const slaMap = new Map();
const sentAlerts = new Set();
const alertKey = (s, reason) => `${s.broadcastId}:${s.phone}:${reason}`;
const chatToRulePhone = new Map();
const rulesStore = new rulesStore_1.RulesStore("rules.json");
function nowMs() {
    return Date.now();
}
function msToSec(ms) {
    return Math.round((ms / 1000) * 1000) / 1000;
}
function makeBroadcastId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return ("BC-" +
        d.getFullYear() +
        pad(d.getMonth() + 1) +
        pad(d.getDate()) +
        "-" +
        pad(d.getHours()) +
        pad(d.getMinutes()) +
        pad(d.getSeconds()) +
        "-" +
        Math.random().toString(16).slice(2, 8));
}
function createWaManager(broadcast) {
    let client = null;
    let restarting = false;
    let restartTimer = null;
    let generation = 0;
    let shuttingDown = false;
    let slaTimer = null;
    const labelByPhone = new Map();
    function makeClient() {
        return new Client({
            authStrategy: new LocalAuth({
                clientId: config_1.AUTH_CLIENT_ID,
                dataPath: config_1.AUTH_DATA_PATH,
            }),
            puppeteer: {
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
                executablePath: (0, config_1.pickChromePath)(),
                timeout: 60_000,
            },
        });
    }
    function log(type, data) {
        const payload = { ts: new Date().toISOString(), type, ...data };
        console.log(`[SLA] ${type}`, payload);
        broadcast("log", payload);
    }
    async function patchSendSeen() {
        try {
            const page = client?.pupPage;
            if (!page?.evaluate)
                return;
            await page.evaluate(() => {
                // @ts-ignore
                if (window.WWebJS && typeof window.WWebJS.sendSeen === "function") {
                    // @ts-ignore
                    window.WWebJS.sendSeen = async () => { };
                }
            });
            console.log("✅ patched: window.WWebJS.sendSeen -> noop");
        }
        catch (e) {
            console.warn("⚠️ patchSendSeen failed:", e?.message || e);
        }
    }
    function resolveLabelFromContact(c) {
        if (!c)
            return null;
        return c.verifiedName || c.pushname || c.name || null;
    }
    async function ensureLabelForPhone(rulePhone, peerId) {
        if (labelByPhone.has(rulePhone))
            return labelByPhone.get(rulePhone);
        try {
            const id = peerId || `${rulePhone}@c.us`;
            const contact = await client.getContactById(id);
            const label = resolveLabelFromContact(contact);
            if (label) {
                labelByPhone.set(rulePhone, label);
                broadcast("rename_col", { clientId: `${rulePhone}@c.us`, label });
                return label;
            }
        }
        catch { }
        labelByPhone.set(rulePhone, rulePhone);
        return rulePhone;
    }
    function emitAlertLate(state, gapSec) {
        const key = alertKey(state, "LATE_REPLY");
        if (sentAlerts.has(key))
            return;
        sentAlerts.add(key);
        broadcast("alert", {
            clientId: state.clientId,
            reason: "LATE_REPLY",
            gap: gapSec,
            threshold: state.thresholdSec,
            broadcastId: state.broadcastId,
        });
        void (0, telegram_1.sendTelegramAlert)({
            reason: "LATE_REPLY",
            phone: state.phone,
            clientId: state.clientId,
            gapSec,
            thresholdSec: state.thresholdSec,
            broadcastId: state.broadcastId,
        }).catch((e) => console.warn("[telegram] failed", e?.message || e));
    }
    function emitAlertNoReply(state, gapSec) {
        const key = alertKey(state, "NO_RESPONSE");
        if (sentAlerts.has(key))
            return;
        sentAlerts.add(key);
        broadcast("alert", {
            clientId: state.clientId,
            reason: "NO_RESPONSE",
            gap: gapSec,
            threshold: state.thresholdSec,
            broadcastId: state.broadcastId,
        });
        void (0, telegram_1.sendTelegramAlert)({
            reason: "NO_RESPONSE",
            phone: state.phone,
            clientId: state.clientId,
            gapSec,
            thresholdSec: state.thresholdSec,
            broadcastId: state.broadcastId,
        }).catch((e) => console.warn("[telegram] failed", e?.message || e));
    }
    function trackBroadcastSent(input) {
        const phone = (0, utils_1.normalizePhone)(input.phone);
        const canonicalClientId = `${phone}@c.us`;
        chatToRulePhone.set(canonicalClientId, phone);
        chatToRulePhone.set(input.peerId, phone);
        const state = {
            phone,
            clientId: canonicalClientId,
            broadcastId: input.broadcastId,
            sentAt: input.sentAt ?? nowMs(),
            thresholdSec: input.thresholdSec,
            replied: false,
            alertedLate: false,
            alertedNoReply: false,
        };
        slaMap.set(phone, state);
        log("BROADCAST_SENT", {
            phone,
            clientId: canonicalClientId,
            peerId: input.peerId,
            broadcastId: input.broadcastId,
            sentAt: state.sentAt,
            thresholdSec: input.thresholdSec,
        });
        broadcast("rule_seed", {
            clientId: canonicalClientId,
            clientLabel: labelByPhone.get(phone) || phone,
            clientPhone: (0, utils_1.toLocalId)(phone),
        });
        void ensureLabelForPhone(phone, input.peerId);
    }
    function onInboundReply(rulePhone, inboundAt) {
        const state = slaMap.get(rulePhone);
        if (!state)
            return;
        if (state.replied)
            return;
        state.replied = true;
        state.pendingNoReplyAt = undefined;
        state.lastInboundAt = inboundAt;
        const gapSec = msToSec(inboundAt - state.sentAt);
        log("INBOUND_REPLY", {
            phone: rulePhone,
            broadcastId: state.broadcastId,
            gapSec,
            thresholdSec: state.thresholdSec,
        });
        if (gapSec <= state.thresholdSec) {
            // 🟢 FIX DI SINI
            broadcast("set_col_status", {
                clientId: state.clientId,
                status: "green",
            });
            return;
        }
        // telat tapi dibalas
        if (!state.alertedLate) {
            state.alertedLate = true;
            log("BREACH_LATE_REPLY", {
                phone: rulePhone,
                broadcastId: state.broadcastId,
                gapSec,
                thresholdSec: state.thresholdSec,
            });
            emitAlertLate(state, gapSec);
        }
    }
    function startSlaNoReplyChecker() {
        if (slaTimer)
            clearInterval(slaTimer);
        const CONFIRM_MS = 2000;
        const TICK_MS = 500;
        slaTimer = setInterval(() => {
            const now = nowMs();
            for (const state of slaMap.values()) {
                if (state.replied) {
                    state.pendingNoReplyAt = undefined;
                    continue;
                }
                const gapSec = msToSec(now - state.sentAt);
                if (gapSec <= state.thresholdSec) {
                    state.pendingNoReplyAt = undefined;
                    continue;
                }
                if (!state.pendingNoReplyAt) {
                    state.pendingNoReplyAt = now;
                    continue;
                }
                if (now - state.pendingNoReplyAt >= CONFIRM_MS &&
                    !state.alertedNoReply) {
                    state.alertedNoReply = true;
                    log("BREACH_NO_REPLY", {
                        phone: state.phone,
                        broadcastId: state.broadcastId,
                        gapSec,
                        thresholdSec: state.thresholdSec,
                    });
                    emitAlertNoReply(state, gapSec);
                }
            }
        }, TICK_MS);
    }
    function stopSlaNoReplyChecker() {
        if (slaTimer) {
            clearInterval(slaTimer);
            slaTimer = null;
        }
    }
    function clearRestartTimer() {
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
    }
    function scheduleRestart(forceClean, delayMs = 600) {
        if (shuttingDown || restarting)
            return;
        clearRestartTimer();
        restartTimer = setTimeout(() => {
            if (!restarting)
                void restartClient(forceClean);
        }, delayMs);
    }
    async function restartClient(forceClean) {
        if (restarting)
            return;
        restarting = true;
        try {
            await new Promise((r) => setTimeout(r, 250));
            try {
                client?.removeAllListeners?.();
            }
            catch { }
            try {
                await client?.destroy?.();
            }
            catch { }
            if (forceClean) {
                try {
                    await (0, promises_1.rm)(config_1.SESSION_DIR, { recursive: true, force: true });
                }
                catch { }
                try {
                    await (0, promises_1.rm)(config_1.CACHE_DIR, { recursive: true, force: true });
                }
                catch { }
            }
            store_1.store.state = { state: "booting", me: null };
            broadcast("status", store_1.store.state);
            client = makeClient();
            const gen = ++generation;
            bindClientEvents(client, gen);
            await client.initialize();
        }
        finally {
            restarting = false;
        }
    }
    async function pushAndBroadcastAsRule(msg, direction, rulePhone, peerIdForLabel) {
        const clientId = `${rulePhone}@c.us`;
        const clientPhone = (0, utils_1.toLocalId)(rulePhone);
        // ensure label cached (best-effort)
        if (!labelByPhone.has(rulePhone)) {
            void ensureLabelForPhone(rulePhone, peerIdForLabel);
        }
        const colLabel = labelByPhone.get(rulePhone) || rulePhone;
        let senderName = "";
        try {
            senderName =
                direction === "out"
                    ? "Me"
                    : (await msg.getContact())?.verifiedName ||
                        (await msg.getContact())?.pushname ||
                        (await msg.getContact())?.name ||
                        clientPhone;
        }
        catch {
            senderName = direction === "out" ? "Me" : clientPhone;
        }
        const body = String(msg.body || "") ||
            (msg.type && msg.type !== "chat" ? `[${msg.type}]` : "");
        const ts = msg.timestamp ? msg.timestamp * 1000 : nowMs();
        const data = {
            clientId,
            clientLabel: colLabel,
            clientPhone,
            from: msg.from,
            name: senderName,
            body,
            ts,
            direction,
        };
        store_1.store.pushMsg(data);
        broadcast("message", data);
    }
    function isPuppeteerFlake(err) {
        const m = String(err?.message || err || "");
        return /(detached Frame|Execution context was destroyed|Target closed|Session closed)/i.test(m);
    }
    function bindClientEvents(c, gen) {
        const isStale = () => gen !== generation;
        c.on("qr", (qr) => {
            if (isStale())
                return;
            store_1.store.state = { state: "scan_qr", me: null };
            broadcast("status", store_1.store.state);
            broadcast("qr", { qr });
        });
        c.on("authenticated", () => {
            if (isStale())
                return;
            clearRestartTimer();
            store_1.store.state = { state: "authenticated", me: null };
            broadcast("status", store_1.store.state);
        });
        c.on("ready", async () => {
            (0, broadcast_cron_1.startBroadcastCron)(startBroadcastNow);
            if (isStale())
                return;
            clearRestartTimer();
            store_1.store.state = { state: "ready", me: c.info?.wid?._serialized ?? null };
            broadcast("status", store_1.store.state);
            console.log("✅ WhatsApp ready as", store_1.store.state.me);
            await patchSendSeen();
            startSlaNoReplyChecker();
        });
        // inbound
        c.on("message", async (msg) => {
            if (isStale())
                return;
            if (msg.fromMe)
                return;
            const { clientId: peerId } = await (0, utils_1.resolvePeer)(msg);
            const mapped = chatToRulePhone.get(String(peerId));
            const fromPhone = (0, utils_1.normalizePhone)(msg.from);
            const rulePhone = mapped || fromPhone;
            if (!slaMap.has(rulePhone))
                return;
            const inboundAt = msg.timestamp ? msg.timestamp * 1000 : nowMs();
            // ✅ EXISTING (SLA logic)
            onInboundReply(rulePhone, inboundAt);
            // ✅ NEW (REPORTING logic)
            // markIncomingResponse(rulePhone);
            await pushAndBroadcastAsRule(msg, "in", rulePhone, String(peerId));
        });
        c.on("message_create", async (msg) => {
            if (isStale())
                return;
            if (!msg.fromMe)
                return;
            const toPeer = String(msg.to || msg.id?.remote || msg.id?.remoteJid || msg.id?._serialized || "");
            const mapped = chatToRulePhone.get(toPeer);
            const rulePhone = mapped || (0, utils_1.normalizePhone)(toPeer);
            if (!slaMap.has(rulePhone))
                return;
            await pushAndBroadcastAsRule(msg, "out", rulePhone, toPeer);
        });
        c.on("auth_failure", (m) => {
            if (isStale())
                return;
            store_1.store.state = { state: "auth_failure", me: null, error: m };
            broadcast("status", store_1.store.state);
            scheduleRestart(true);
        });
        c.on("disconnected", (reason) => {
            if (isStale())
                return;
            store_1.store.state = { state: "disconnected", me: null, error: reason };
            broadcast("status", store_1.store.state);
            scheduleRestart(String(reason || "").toUpperCase().includes("LOGOUT"));
        });
    }
    async function logoutAndRestart() {
        store_1.store.state = { state: "disconnected", me: null, error: "manual logout" };
        broadcast("status", store_1.store.state);
        try {
            await client?.logout?.();
        }
        catch { }
        scheduleRestart(true);
    }
    async function stop() {
        shuttingDown = true;
        stopSlaNoReplyChecker();
        try {
            clearRestartTimer();
        }
        catch { }
        try {
            client?.removeAllListeners?.();
        }
        catch { }
        try {
            await client?.destroy?.();
        }
        catch { }
    }
    // async function startBroadcastNow() {
    //   const broadcastId = makeBroadcastId();
    //   slaMap.clear();
    //   sentAlerts.clear();
    //   await loadActiveRulesFromStore(rulesStore);
    //   log("BROADCAST_START", { broadcastId });
    //   const REPORT_DELAY_MS = 30 * 1000; // 30 detik
    //   setTimeout(async () => {
    //     try {
    //       const allResults = Array.from(slaMap.values()).map((s) => ({
    //         phone: s.phone,
    //         name: labelByPhone.get(s.phone),
    //         messageText: "-", // trigger text kalau mau
    //         timeSendMessage: new Date(s.sentAt),
    //         timeOfReceiving: s.lastInboundAt
    //           ? new Date(s.lastInboundAt)
    //           : null,
    //         responseTime: s.lastInboundAt
    //           ? (s.lastInboundAt - s.sentAt) / 1000
    //           : null,
    //         threshold: s.thresholdSec,
    //       }));
    //       const { filepath, filename } = generateTxt(allResults);
    //       await sendTelegramFile(
    //         process.env.TELEGRAM_BOT_TOKEN!,
    //         process.env.TELEGRAM_CHAT_ID!,
    //         filepath,
    //         filename
    //       );
    //       console.log("✅ SLA TXT sent");
    //     } catch (e) {
    //       console.error("❌ failed send SLA TXT", e);
    //     }
    //   }, REPORT_DELAY_MS);
    //   const runOnce = async () => {
    //     await patchSendSeen();
    //     await startBroadcast(client, broadcast, {
    //       broadcastId,
    //       onSent: (x) => {
    //         trackBroadcastSent({
    //           phone: x.phone,
    //           thresholdSec: x.thresholdSec,
    //           broadcastId,
    //           sentAt: x.sentAt,
    //           peerId: x.peerId, // ✅ from broadcast.ts
    //         });
    //       },
    //       onDone: (x) => log("BROADCAST_DONE", { broadcastId, total: x.total }),
    //     });
    //   };
    //   try {
    //     await runOnce();
    //   } catch (e: any) {
    //     if (isPuppeteerFlake(e)) {
    //       console.warn("[broadcast] flake, restarting client then retry…", e?.message || e);
    //       await restartClient(false);
    //       await runOnce();
    //       return;
    //     }
    //     console.error("[broadcast] failed:", e?.message || e);
    //     throw e;
    //   }
    // }
    async function startBroadcastNow() {
        const broadcastId = makeBroadcastId();
        slaMap.clear();
        sentAlerts.clear();
        await (0, activeRules_1.loadActiveRulesFromStore)(rulesStore);
        log("BROADCAST_START", { broadcastId });
        const REPORT_DELAY_MS = 30 * 1000;
        let latestReportAt = 0;
        let finalReportTimer = null;
        const scheduleFinalReport = () => {
            if (finalReportTimer)
                clearTimeout(finalReportTimer);
            const delay = Math.max(0, latestReportAt - Date.now());
            finalReportTimer = setTimeout(async () => {
                try {
                    const allResults = Array.from(slaMap.values()).map((s) => ({
                        phone: s.phone,
                        name: labelByPhone.get(s.phone),
                        messageText: "-",
                        timeSendMessage: new Date(s.sentAt),
                        timeOfReceiving: s.lastInboundAt
                            ? new Date(s.lastInboundAt)
                            : null,
                        responseTime: s.lastInboundAt
                            ? (s.lastInboundAt - s.sentAt) / 1000
                            : null,
                        threshold: s.thresholdSec,
                    }));
                    const { filepath, filename } = (0, generateFile_1.generateTxt)(allResults);
                    await (0, generateFile_1.sendTelegramFile)(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, filepath, filename);
                    console.log("✅ SLA TXT sent (final)");
                }
                catch (e) {
                    console.error("❌ failed send SLA TXT", e);
                }
            }, delay);
        };
        const runOnce = async () => {
            await patchSendSeen();
            await (0, broadcast_1.startBroadcast)(client, broadcast, {
                broadcastId,
                onSent: (x) => {
                    trackBroadcastSent({
                        phone: x.phone,
                        thresholdSec: x.thresholdSec,
                        broadcastId,
                        sentAt: x.sentAt,
                        peerId: x.peerId,
                    });
                    const reportAt = x.sentAt + REPORT_DELAY_MS;
                    if (reportAt > latestReportAt) {
                        latestReportAt = reportAt;
                        scheduleFinalReport();
                    }
                },
                onDone: (x) => log("BROADCAST_DONE", { broadcastId, total: x.total }),
            });
        };
        try {
            await runOnce();
        }
        catch (e) {
            if (isPuppeteerFlake(e)) {
                console.warn("[broadcast] flake, restarting client then retry…", e?.message || e);
                await restartClient(false);
                await runOnce();
                return;
            }
            console.error("[broadcast] failed:", e?.message || e);
            throw e;
        }
    }
    return {
        restartClient,
        logoutAndRestart,
        stop,
        startBroadcast: startBroadcastNow,
    };
}
