"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBroadcast = startBroadcast;
exports.markIncomingResponse = markIncomingResponse;
const activeRules_1 = require("./activeRules");
const utils_1 = require("./utils");
// import { generateTxt, sendTelegramFile } from "./generateFile";
const results = [];
let finalizeTimer = null;
async function startBroadcast(client, broadcast, opts) {
    const rules = (0, activeRules_1.getRules)();
    let total = 0;
    results.length = 0;
    if (finalizeTimer)
        clearTimeout(finalizeTimer);
    for (const r of rules) {
        const phone = r.phone;
        const canonicalChatId = `${phone}@c.us`;
        const sentAt = Date.now();
        const msg = await client.sendMessage(canonicalChatId, r.trigger);
        const peerId = String(msg?.to ||
            msg?.id?.remote ||
            msg?.id?._serialized ||
            canonicalChatId);
        const outMsg = {
            clientId: canonicalChatId,
            clientLabel: phone,
            clientPhone: (0, utils_1.toLocalId)(phone),
            from: canonicalChatId,
            name: "Me",
            body: r.trigger,
            ts: sentAt,
            direction: "out",
        };
        broadcast("message", outMsg);
        results.push({
            phone,
            name: "-", // optional
            messageText: r.trigger,
            threshold: r.threshold,
            timeSendMessage: new Date(sentAt),
            timeOfReceiving: null,
            responseTime: null,
        });
        opts.onSent?.({
            phone,
            thresholdSec: r.threshold,
            sentAt,
            peerId,
        });
        total++;
    }
    opts.onDone?.({ total });
    // finalizeTimer = setTimeout(async () => {
    //   console.log("[FINALIZE] sending txt file...");
    //   try {
    //     if (!results.length) return;
    //     const { filename, filepath } = generateTxt(results);
    //     await sendTelegramFile(
    //       process.env.TELEGRAM_BOT_TOKEN!,
    //       process.env.TELEGRAM_CHAT_ID!,
    //       filepath,
    //       filename
    //     );
    //   } catch (e) {
    //     console.error("❌ failed send telegram file", e);
    //   } finally {
    //     results.length = 0;
    //     finalizeTimer = null;
    //   }
    // }, 30_000); // ✅ 30 DETIK
}
function markIncomingResponse(phone) {
    const item = results.find((x) => x.phone === phone && x.timeOfReceiving === null);
    if (!item)
        return;
    const recvAt = new Date();
    item.timeOfReceiving = recvAt;
    item.responseTime =
        (recvAt.getTime() - item.timeSendMessage.getTime()) / 1000;
}
