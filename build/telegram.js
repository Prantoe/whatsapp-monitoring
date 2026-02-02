"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTelegramAlert = sendTelegramAlert;
exports.sendTelegramFile = sendTelegramFile;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const form_data_1 = __importDefault(require("form-data"));
function getEnv() {
    return {
        BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
        CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",
    };
}
async function sendTelegramAlert(a) {
    const { BOT_TOKEN, CHAT_ID } = getEnv();
    if (!BOT_TOKEN || !CHAT_ID)
        return;
    const title = a.reason === "NO_RESPONSE" ? "⛔ NO RESPONSE" : "⚠️ LATE RESPONSE";
    const text = `${title}\n` +
        `• phone: ${a.phone}\n` +
        `• client: ${a.clientId}\n` +
        `• broadcast: ${a.broadcastId}\n` +
        `• gap: ${a.gapSec.toFixed(2)}s (threshold ${a.thresholdSec}s)\n` +
        (a.trigger ? `• trigger: ${a.trigger}\n` : "");
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        const res = await axios_1.default.post(url, {
            chat_id: CHAT_ID,
            text,
            disable_web_page_preview: true,
        });
        console.log("[telegram] ok", res.status);
    }
    catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        console.warn("[telegram] failed", status, data || e?.message || e);
    }
}
async function sendTelegramFile(botToken, chatId, filepath, filename) {
    if (!fs_1.default.existsSync(filepath)) {
        throw new Error(`File not found: ${filepath}`);
    }
    const form = new form_data_1.default();
    form.append("chat_id", chatId);
    form.append("document", fs_1.default.createReadStream(filepath), {
        filename,
        contentType: "text/plain",
    });
    const res = await axios_1.default.post(`https://api.telegram.org/bot${botToken}/sendDocument`, form, { headers: form.getHeaders() });
    return res.data;
}
