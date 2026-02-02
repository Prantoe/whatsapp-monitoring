"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTxt = generateTxt;
exports.sendTelegramFile = sendTelegramFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const utils_1 = require("./utils");
function generateTxt(results) {
    const filename = `data-${new Date().toISOString().slice(0, 10)}.txt`;
    const dir = path_1.default.join(process.cwd(), "tmp");
    const filepath = path_1.default.join(dir, filename);
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    const content = results.map(utils_1.formatResultLine).join("\n");
    fs_1.default.writeFileSync(filepath, content, "utf8");
    console.log("[TXT] generated:", filepath);
    return { filename, filepath };
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
    console.log("[telegram] file sent:", res.data?.ok);
}
