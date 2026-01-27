import { getRules } from "./activeRules";

type Broadcast = (type: string, data: unknown) => void;

export function startSlaTimeoutWatcher(broadcast: Broadcast) {
  setInterval(() => {
    const now = Date.now();

    for (const r of getRules()) {
      if (!r.sendTime) continue;
      if (r.replied) continue;
      if (r.alerted) continue;

      const gap = (now - r.sendTime) / 1000;

      if (gap > r.threshold) {
        r.alerted = true;

        broadcast("alert", {
          clientId: `${r.phone}@c.us`,
          gap,
          threshold: r.threshold,
          trigger: r.trigger,
          reason: "NO_RESPONSE",
        });
      }
    }
  }, 1000);
}
