import { getRules } from "./activeRules";
import { toLocalId } from "./utils";
import type { Msg, BroadcastResult } from "./types";
// import { generateTxt, sendTelegramFile } from "./generateFile";

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

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function startBroadcast(
  client: any,
  broadcast: BroadcastFn,
  opts: Opts
) {
  const rules = getRules();
  let total = 0;

  results.length = 0;
  if (finalizeTimer) clearTimeout(finalizeTimer);

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
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
