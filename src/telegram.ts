import axios from "axios";
import fs from "fs";
import FormData from "form-data";

function getEnv() {
  return {
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
    CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",
  };
}

export async function sendTelegramAlert(a: {
  reason: "NO_RESPONSE" | "LATE_REPLY";
  phone: string;
  clientId: string;
  gapSec: number;
  thresholdSec: number;
  broadcastId: string;
  trigger?: string;
}) {
  const { BOT_TOKEN, CHAT_ID } = getEnv();
  if (!BOT_TOKEN || !CHAT_ID) return;

  const title = a.reason === "NO_RESPONSE" ? "⛔ NO RESPONSE" : "⚠️ LATE RESPONSE";
  const text =
    `${title}\n` +
    `• phone: ${a.phone}\n` +
    `• client: ${a.clientId}\n` +
    `• broadcast: ${a.broadcastId}\n` +
    `• gap: ${a.gapSec.toFixed(2)}s (threshold ${a.thresholdSec}s)\n` +
    (a.trigger ? `• trigger: ${a.trigger}\n` : "");

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const res = await axios.post(url, {
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true,
    });
    console.log("[telegram] ok", res.status);
  } catch (e: any) {
    const status = e?.response?.status;
    const data = e?.response?.data;
    console.warn("[telegram] failed", status, data || e?.message || e);
  }
}

export async function sendTelegramFile(
  botToken: string,
  chatId: string,
  filepath: string,
  filename: string
) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", fs.createReadStream(filepath), {
    filename,
    contentType: "text/plain",
  });
  
  const res = await axios.post(
    `https://api.telegram.org/bot${botToken}/sendDocument`,
    form,
    { headers: form.getHeaders() }
  );

  return res.data;
}
