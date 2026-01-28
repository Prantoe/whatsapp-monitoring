import { BroadcastResult } from "./types";

export const jidToPhone = (jid: string) => String(jid || "").replace(/@.+$/, "");
export const toLocalId = (num: string) => (num?.startsWith("62") ? "0" + num.slice(2) : num);

export async function resolvePeer(msg: any) {
  const chat = await msg.getChat();
  const clientId = chat?.id?._serialized || msg.from;

  if (chat?.isGroup) {
    return { clientId, clientLabel: chat.name || clientId, isGroup: true };
  }

  const peer = (await chat.getContact?.()) || (await msg.getContact());
  const phone = toLocalId(jidToPhone(clientId));
  const label = peer?.verifiedName || peer?.pushname || peer?.name || phone;

  return { clientId, clientLabel: label, isGroup: false };
}

export function jidToDigits(jid: string) {
  const s = String(jid || "");
  const m = s.match(/\d{7,16}/g);
  return m ? m.join("") : "";
}

export function normalizePhone(raw: string) {
  let s = String(raw || "").trim();
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("+62")) s = "62" + s.slice(3);
  if (s.startsWith("08")) s = "628" + s.slice(2);
  s = s.replace(/@.+$/, "");
  return s;
}

export function normalizeJidToPhone(jid: string) {
  const digits = jidToDigits(jid);
  if (!digits) return "";
  return normalizePhone(digits);
}

export function formatResultLine(r: BroadcastResult): string {
  return (
    `numberPhone: '${r.phone}' | ` +
    `name: ${r.name} | ` +
    `messageText: ${r.messageText} | ` +
    `timeSendMessage: ${r.timeSendMessage} | ` +
    `timeOfReceiving: ${r.timeOfReceiving} | ` +
    `responseTime: ${r.responseTime} (threshold : ${r.threshold})`
  );
}
