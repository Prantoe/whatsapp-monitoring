"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLocalId = exports.jidToPhone = void 0;
exports.resolvePeer = resolvePeer;
exports.jidToDigits = jidToDigits;
exports.normalizePhone = normalizePhone;
exports.normalizeJidToPhone = normalizeJidToPhone;
exports.formatResultLine = formatResultLine;
const jidToPhone = (jid) => String(jid || "").replace(/@.+$/, "");
exports.jidToPhone = jidToPhone;
const toLocalId = (num) => (num?.startsWith("62") ? "0" + num.slice(2) : num);
exports.toLocalId = toLocalId;
async function resolvePeer(msg) {
    const chat = await msg.getChat();
    const clientId = chat?.id?._serialized || msg.from;
    if (chat?.isGroup) {
        return { clientId, clientLabel: chat.name || clientId, isGroup: true };
    }
    const peer = (await chat.getContact?.()) || (await msg.getContact());
    const phone = (0, exports.toLocalId)((0, exports.jidToPhone)(clientId));
    const label = peer?.verifiedName || peer?.pushname || peer?.name || phone;
    return { clientId, clientLabel: label, isGroup: false };
}
function jidToDigits(jid) {
    const s = String(jid || "");
    const m = s.match(/\d{7,16}/g);
    return m ? m.join("") : "";
}
function normalizePhone(raw) {
    let s = String(raw || "").trim();
    s = s.replace(/[^\d+]/g, "");
    if (s.startsWith("+62"))
        s = "62" + s.slice(3);
    if (s.startsWith("08"))
        s = "628" + s.slice(2);
    s = s.replace(/@.+$/, "");
    return s;
}
function normalizeJidToPhone(jid) {
    const digits = jidToDigits(jid);
    if (!digits)
        return "";
    return normalizePhone(digits);
}
function formatResultLine(r) {
    return (`numberPhone: '${r.phone}' | ` +
        `name: ${r.name} | ` +
        `messageText: ${r.messageText} | ` +
        `timeSendMessage: ${r.timeSendMessage} | ` +
        `timeOfReceiving: ${r.timeOfReceiving} | ` +
        `responseTime: ${r.responseTime} (threshold : ${r.threshold})`);
}
