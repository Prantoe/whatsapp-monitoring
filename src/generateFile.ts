import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { BroadcastResult } from "./types";
import { formatResultLine } from "./utils";

export function generateTxt(results: BroadcastResult[]) {
  const filename = `data-${new Date().toISOString().slice(0, 10)}.txt`;
  const dir = path.join(process.cwd(), "tmp");
  const filepath = path.join(dir, filename);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = results.map(formatResultLine).join("\n");
  fs.writeFileSync(filepath, content, "utf8");

  console.log("[TXT] generated:", filepath);
  return { filename, filepath };
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

  console.log("[telegram] file sent:", res.data?.ok);
}
