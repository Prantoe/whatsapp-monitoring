import path from "path";

export const PORT = Number(process.env.PORT || 3000);
export const PUBLIC_DIR = path.join(__dirname, "..", "public");

export const AUTH_CLIENT_ID = process.env.WA_CLIENT_ID || "wa-monitor";
export const AUTH_DATA_PATH = path.join(process.cwd(), ".wwebjs_auth");
export const SESSION_DIR = path.join(AUTH_DATA_PATH, `session-${AUTH_CLIENT_ID}`);
export const CACHE_DIR = path.join(process.cwd(), ".wwebjs_cache");

export const WS_PATH = "/ws";
export const WS_PING_INTERVAL_MS = 30_000;

export function pickChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  return "/usr/bin/google-chrome";
}
