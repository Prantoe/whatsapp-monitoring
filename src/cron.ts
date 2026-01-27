import cron from "node-cron";
import { startBroadcast } from "./broadcast";

let isRunning = false;

export function initBroadcastCron(client: any, broadcast: any) {
  cron.schedule("*/5 * * * *", async () => {
    if (isRunning) return;

    try {
      isRunning = true;
      console.log("[CRON] broadcast start");

      await startBroadcast(client, broadcast, {
        broadcastId: `CRON-${Date.now()}`,
      });

      console.log("[CRON] broadcast done");
    } catch (e) {
      console.error("[CRON] error", e);
    } finally {
      isRunning = false;
    }
  });
}
