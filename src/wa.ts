// src/wa.ts
import { rm } from "fs/promises";
import wweb from "whatsapp-web.js";
import {
  AUTH_CLIENT_ID,
  AUTH_DATA_PATH,
  CACHE_DIR,
  SESSION_DIR,
  pickChromePath,
} from "./config";
import { store } from "./store";
import { resolvePeer, toLocalId, normalizePhone } from "./utils";
import type { Msg } from "./types";
import { markIncomingResponse, startBroadcast } from "./broadcast";
import { sendTelegramAlert } from "./telegram";
import { loadActiveRulesFromStore } from "./activeRules";
import { RulesStore } from "./rulesStore";
import { generateTxt, sendTelegramFile } from "./generateFile";
import { startBroadcastCron } from "./jobs/broadcast.cron";

const { Client, LocalAuth } = wweb as any;

type Broadcast = (type: string, data: unknown) => void;

type SlaState = {
  phone: string;
  clientId: string;
  broadcastId: string;
  sentAt: number;
  thresholdSec: number;
  replied: boolean;
  alertedLate: boolean;
  alertedNoReply: boolean;
  lastInboundAt?: number;
  pendingNoReplyAt?: number;
};

const slaMap = new Map<string, SlaState>();

const sentAlerts = new Set<string>();
const alertKey = (s: SlaState, reason: string) =>
  `${s.broadcastId}:${s.phone}:${reason}`;

const chatToRulePhone = new Map<string, string>();
const rulesStore = new RulesStore("rules.json");

function nowMs() {
  return Date.now();
}
function msToSec(ms: number) {
  return Math.round((ms / 1000) * 1000) / 1000;
}

function makeBroadcastId() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    "BC-" +
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds()) +
    "-" +
    Math.random().toString(16).slice(2, 8)
  );
}

export function createWaManager(broadcast: Broadcast) {
  let client: any = null;
  let restarting = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let generation = 0;
  let shuttingDown = false;

  let slaTimer: NodeJS.Timeout | null = null;

  const labelByPhone = new Map<string, string>();

  function makeClient() {
    return new Client({
      authStrategy: new LocalAuth({
        clientId: AUTH_CLIENT_ID,
        dataPath: AUTH_DATA_PATH,
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
        executablePath: pickChromePath(),
        timeout: 60_000,
      },
    });
  }

  function log(type: string, data: Record<string, any>) {
    const payload = { ts: new Date().toISOString(), type, ...data };
    console.log(`[SLA] ${type}`, payload);
    broadcast("log", payload);
  }

  async function patchSendSeen() {
    try {
      const page = (client as any)?.pupPage;
      if (!page?.evaluate) return;

      await page.evaluate(() => {
        // @ts-ignore
        if (window.WWebJS && typeof window.WWebJS.sendSeen === "function") {
          // @ts-ignore
          window.WWebJS.sendSeen = async () => {};
        }
      });

      console.log("✅ patched: window.WWebJS.sendSeen -> noop");
    } catch (e: any) {
      console.warn("⚠️ patchSendSeen failed:", e?.message || e);
    }
  }

  function resolveLabelFromContact(c: any): string | null {
    if (!c) return null;
    return c.verifiedName || c.pushname || c.name || null;
  }

  async function ensureLabelForPhone(rulePhone: string, peerId?: string) {
    if (labelByPhone.has(rulePhone)) return labelByPhone.get(rulePhone)!;

    try {
      const id = peerId || `${rulePhone}@c.us`;
      const contact = await client.getContactById(id);
      const label = resolveLabelFromContact(contact);

      if (label) {
        labelByPhone.set(rulePhone, label);
        broadcast("rename_col", { clientId: `${rulePhone}@c.us`, label });
        return label;
      }
    } catch {}

    labelByPhone.set(rulePhone, rulePhone);
    return rulePhone;
  }

  function emitAlertLate(state: SlaState, gapSec: number) {
    const key = alertKey(state, "LATE_REPLY");
    if (sentAlerts.has(key)) return;
    sentAlerts.add(key);

    broadcast("alert", {
      clientId: state.clientId,
      reason: "LATE_REPLY",
      gap: gapSec,
      threshold: state.thresholdSec,
      broadcastId: state.broadcastId,
    });

    void sendTelegramAlert({
      reason: "LATE_REPLY",
      phone: state.phone,
      clientId: state.clientId,
      gapSec,
      thresholdSec: state.thresholdSec,
      broadcastId: state.broadcastId,
    }).catch((e) => console.warn("[telegram] failed", e?.message || e));
  }

  function emitAlertNoReply(state: SlaState, gapSec: number) {
    const key = alertKey(state, "NO_RESPONSE");
    if (sentAlerts.has(key)) return;
    sentAlerts.add(key);

    broadcast("alert", {
      clientId: state.clientId,
      reason: "NO_RESPONSE",
      gap: gapSec,
      threshold: state.thresholdSec,
      broadcastId: state.broadcastId,
    });

    void sendTelegramAlert({
      reason: "NO_RESPONSE",
      phone: state.phone,
      clientId: state.clientId,
      gapSec,
      thresholdSec: state.thresholdSec,
      broadcastId: state.broadcastId,
    }).catch((e) => console.warn("[telegram] failed", e?.message || e));
  }

  function trackBroadcastSent(input: {
    phone: string;
    thresholdSec: number;
    broadcastId: string;
    sentAt?: number;
    peerId: string;
  }) {
    const phone = normalizePhone(input.phone);
    const canonicalClientId = `${phone}@c.us`;

    chatToRulePhone.set(canonicalClientId, phone);
    chatToRulePhone.set(input.peerId, phone);

    const state: SlaState = {
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
      clientPhone: toLocalId(phone),
    });

    void ensureLabelForPhone(phone, input.peerId);
  }

  function onInboundReply(rulePhone: string, inboundAt: number) {
    const state = slaMap.get(rulePhone);
    if (!state) return;
    if (state.replied) return;
  
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
    if (slaTimer) clearInterval(slaTimer);

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

        if (
          now - state.pendingNoReplyAt >= CONFIRM_MS &&
          !state.alertedNoReply
        ) {
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

  function scheduleRestart(forceClean: boolean, delayMs = 600) {
    if (shuttingDown || restarting) return;
    clearRestartTimer();
    restartTimer = setTimeout(() => {
      if (!restarting) void restartClient(forceClean);
    }, delayMs);
  }

  async function restartClient(forceClean: boolean) {
    if (restarting) return;
    restarting = true;
    try {
      await new Promise((r) => setTimeout(r, 250));

      try {
        client?.removeAllListeners?.();
      } catch {}
      try {
        await client?.destroy?.();
      } catch {}

      if (forceClean) {
        try {
          await rm(SESSION_DIR, { recursive: true, force: true });
        } catch {}
        try {
          await rm(CACHE_DIR, { recursive: true, force: true });
        } catch {}
      }

      store.state = { state: "booting", me: null };
      broadcast("status", store.state);

      client = makeClient();
      const gen = ++generation;
      bindClientEvents(client, gen);
      await client.initialize();
    } finally {
      restarting = false;
    }
  }

  async function pushAndBroadcastAsRule(
    msg: any,
    direction: "in" | "out",
    rulePhone: string,
    peerIdForLabel?: string
  ) {
    const clientId = `${rulePhone}@c.us`; 
    const clientPhone = toLocalId(rulePhone);

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
    } catch {
      senderName = direction === "out" ? "Me" : clientPhone;
    }

    const body =
      String(msg.body || "") ||
      (msg.type && msg.type !== "chat" ? `[${msg.type}]` : "");
    const ts = msg.timestamp ? msg.timestamp * 1000 : nowMs();

    const data: Msg = {
      clientId,
      clientLabel: colLabel,
      clientPhone,
      from: msg.from,
      name: senderName,
      body,
      ts,
      direction,
    };

    store.pushMsg(data);
    broadcast("message", data);
  }

  function isPuppeteerFlake(err: any) {
    const m = String(err?.message || err || "");
    return /(detached Frame|Execution context was destroyed|Target closed|Session closed)/i.test(
      m
    );
  }

  function bindClientEvents(c: any, gen: number) {
    const isStale = () => gen !== generation;

    c.on("qr", (qr: string) => {
      if (isStale()) return;
      store.state = { state: "scan_qr", me: null };
      broadcast("status", store.state);
      broadcast("qr", { qr });
    });

    c.on("authenticated", () => {
      if (isStale()) return;
      clearRestartTimer();
      store.state = { state: "authenticated", me: null };
      broadcast("status", store.state);
    });

    c.on("ready", async () => {
      startBroadcastCron(startBroadcastNow);
      if (isStale()) return;
      clearRestartTimer();

      store.state = { state: "ready", me: c.info?.wid?._serialized ?? null };
      broadcast("status", store.state);
      console.log("✅ WhatsApp ready as", store.state.me);

      await patchSendSeen();
      startSlaNoReplyChecker();
    });

    // inbound
    c.on("message", async (msg: any) => {
      if (isStale()) return;
      if (msg.fromMe) return;

      const { clientId: peerId } = await resolvePeer(msg);

      const mapped = chatToRulePhone.get(String(peerId));
      const fromPhone = normalizePhone(msg.from);
      const rulePhone = mapped || fromPhone;

      if (!slaMap.has(rulePhone)) return;

      const inboundAt = msg.timestamp ? msg.timestamp * 1000 : nowMs();

      // ✅ EXISTING (SLA logic)
      onInboundReply(rulePhone, inboundAt);

      // ✅ NEW (REPORTING logic)
      markIncomingResponse(rulePhone);

      await pushAndBroadcastAsRule(msg, "in", rulePhone, String(peerId));
    });


    c.on("message_create", async (msg: any) => {
      if (isStale()) return;
      if (!msg.fromMe) return;

      const toPeer =
        String(msg.to || msg.id?.remote || msg.id?.remoteJid || msg.id?._serialized || "");

      const mapped = chatToRulePhone.get(toPeer);

      const rulePhone = mapped || normalizePhone(toPeer);

      if (!slaMap.has(rulePhone)) return;

      await pushAndBroadcastAsRule(msg, "out", rulePhone, toPeer);
    });

    c.on("auth_failure", (m: string) => {
      if (isStale()) return;
      store.state = { state: "auth_failure", me: null, error: m };
      broadcast("status", store.state);
      scheduleRestart(true);
    });

    c.on("disconnected", (reason: string) => {
      if (isStale()) return;
      store.state = { state: "disconnected", me: null, error: reason };
      broadcast("status", store.state);
      scheduleRestart(String(reason || "").toUpperCase().includes("LOGOUT"));
    });
  }

  async function logoutAndRestart() {
    store.state = { state: "disconnected", me: null, error: "manual logout" };
    broadcast("status", store.state);
    try {
      await client?.logout?.();
    } catch {}
    scheduleRestart(true);
  }

  async function stop() {
    shuttingDown = true;
    stopSlaNoReplyChecker();
    try {
      clearRestartTimer();
    } catch {}
    try {
      client?.removeAllListeners?.();
    } catch {}
    try {
      await client?.destroy?.();
    } catch {}
  }

  async function startBroadcastNow() {
    const broadcastId = makeBroadcastId();
    slaMap.clear();
    sentAlerts.clear();
    await loadActiveRulesFromStore(rulesStore);

    log("BROADCAST_START", { broadcastId });

    const REPORT_DELAY_MS = 30 * 1000; // 30 detik

    setTimeout(async () => {
      try {
        const allResults = Array.from(slaMap.values()).map((s) => ({
          phone: s.phone,
          name: labelByPhone.get(s.phone),
          messageText: "-", // trigger text kalau mau
          timeSendMessage: new Date(s.sentAt),
          timeOfReceiving: s.lastInboundAt
            ? new Date(s.lastInboundAt)
            : null,
          responseTime: s.lastInboundAt
            ? (s.lastInboundAt - s.sentAt) / 1000
            : null,
          threshold: s.thresholdSec,
        }));

        const { filepath, filename } = generateTxt(allResults);

        await sendTelegramFile(
          process.env.TELEGRAM_BOT_TOKEN!,
          process.env.TELEGRAM_CHAT_ID!,
          filepath,
          filename
        );

        console.log("✅ SLA TXT sent");
      } catch (e) {
        console.error("❌ failed send SLA TXT", e);
      }
    }, REPORT_DELAY_MS);


    const runOnce = async () => {
      await patchSendSeen();

      await startBroadcast(client, broadcast, {
        broadcastId,
        onSent: (x) => {
          trackBroadcastSent({
            phone: x.phone,
            thresholdSec: x.thresholdSec,
            broadcastId,
            sentAt: x.sentAt,
            peerId: x.peerId, // ✅ from broadcast.ts
          });
        },
        onDone: (x) => log("BROADCAST_DONE", { broadcastId, total: x.total }),
      });
    };

    try {
      await runOnce();
    } catch (e: any) {
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
