"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBroadcast = startBroadcast;
const activeRules_1 = require("./activeRules");
const utils_1 = require("./utils");
// import { generateTxt, sendTelegramFile } from "./generateFile";
const results = [];
let finalizeTimer = null;
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
async function startBroadcast(client, broadcast, opts) {
    const rules = (0, activeRules_1.getRules)();
    let total = 0;
    results.length = 0;
    if (finalizeTimer)
        clearTimeout(finalizeTimer);
    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
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
            name: "-",
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
        if (i < rules.length - 1) {
            await sleep(3000);
        }
    }
    opts.onDone?.({ total });
}
// export function markIncomingResponse(phone: string) {
//   const item = results.find(
//     (x) => x.phone === phone && x.timeOfReceiving === null
//   );
//   if (!item) return;
//   const recvAt = new Date();
//   item.timeOfReceiving = recvAt;
//   item.responseTime =
//     (recvAt.getTime() - item.timeSendMessage.getTime()) / 1000;
// }
