"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBroadcastCron = startBroadcastCron;
const node_cron_1 = __importDefault(require("node-cron"));
function startBroadcastCron(run) {
    node_cron_1.default.schedule("0 * * * *", async () => {
        console.log("[cron] broadcast triggered");
        try {
            await run();
        }
        catch (e) {
            console.error("[cron] broadcast failed", e);
        }
    });
}
