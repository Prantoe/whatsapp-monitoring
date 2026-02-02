"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WS_PING_INTERVAL_MS = exports.WS_PATH = exports.CACHE_DIR = exports.SESSION_DIR = exports.AUTH_DATA_PATH = exports.AUTH_CLIENT_ID = exports.PUBLIC_DIR = exports.PORT = void 0;
exports.pickChromePath = pickChromePath;
const path_1 = __importDefault(require("path"));
exports.PORT = Number(process.env.PORT || 3000);
exports.PUBLIC_DIR = path_1.default.join(__dirname, "..", "public");
exports.AUTH_CLIENT_ID = process.env.WA_CLIENT_ID || "wa-monitor";
exports.AUTH_DATA_PATH = path_1.default.join(process.cwd(), ".wwebjs_auth");
exports.SESSION_DIR = path_1.default.join(exports.AUTH_DATA_PATH, `session-${exports.AUTH_CLIENT_ID}`);
exports.CACHE_DIR = path_1.default.join(process.cwd(), ".wwebjs_cache");
exports.WS_PATH = "/ws";
exports.WS_PING_INTERVAL_MS = 30_000;
function pickChromePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH)
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    if (process.platform === "darwin")
        return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (process.platform === "win32")
        return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    return "/usr/bin/google-chrome";
}
