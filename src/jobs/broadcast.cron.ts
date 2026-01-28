import cron from "node-cron";

export function startBroadcastCron(run: () => Promise<void>) {
  cron.schedule("0 * * * *", async () => {
    console.log("[cron] broadcast triggered");
    try {
      await run();
    } catch (e) {
      console.error("[cron] broadcast failed", e);
    }
  });
  
}
