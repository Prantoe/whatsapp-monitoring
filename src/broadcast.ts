import { getRules } from "./activeRules";
import { toLocalId } from "./utils";
import type { Msg, BroadcastResult } from "./types";
import { generateTxt, sendTelegramFile } from "./generateFile";

const results: BroadcastResult[] = [];
let finalizeTimer: NodeJS.Timeout | null = null;

type BroadcastFn = (type: string, data: unknown) => void;

type Opts = {
  broadcastId: string;
  onSent?: (x: {
    phone: string;
    thresholdSec: number;
    sentAt: number;
    peerId: string;
  }) => void;
  onDone?: (x: { total: number }) => void;
};

export async function startBroadcast(
  client: any,
  broadcast: BroadcastFn,
  opts: Opts
) {
  const rules = getRules();
  let total = 0;

  results.length = 0;
  if (finalizeTimer) clearTimeout(finalizeTimer);

  for (const r of rules) {
    const phone = r.phone;
    const canonicalChatId = `${phone}@c.us`;
    const sentAt = Date.now();

    const msg = await client.sendMessage(canonicalChatId, r.trigger);

    const peerId = String(
      msg?.to ||
        msg?.id?.remote ||
        msg?.id?._serialized ||
        canonicalChatId
    );

    const outMsg: Msg = {
      clientId: canonicalChatId,
      clientLabel: phone,
      clientPhone: toLocalId(phone),
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

  finalizeTimer = setTimeout(async () => {
    console.log("[FINALIZE] sending txt file...");

    try {
      if (!results.length) return;

      const { filename, filepath } = generateTxt(results);

      await sendTelegramFile(
        process.env.TELEGRAM_BOT_TOKEN!,
        process.env.TELEGRAM_CHAT_ID!,
        filepath,
        filename
      );
    } catch (e) {
      console.error("❌ failed send telegram file", e);
    } finally {
      results.length = 0;
      finalizeTimer = null;
    }
  }, 30_000); // ✅ 30 DETIK
}

export function markIncomingResponse(phone: string) {
  const item = results.find(
    (x) => x.phone === phone && x.timeOfReceiving === null
  );
  if (!item) return;

  const recvAt = new Date();
  item.timeOfReceiving = recvAt;
  item.responseTime =
    (recvAt.getTime() - item.timeSendMessage.getTime()) / 1000;
}
