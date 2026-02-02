"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSlaTimeoutWatcher = startSlaTimeoutWatcher;
const activeRules_1 = require("./activeRules");
function startSlaTimeoutWatcher(broadcast) {
    setInterval(() => {
        const now = Date.now();
        for (const r of (0, activeRules_1.getRules)()) {
            if (!r.sendTime)
                continue;
            if (r.replied)
                continue;
            if (r.alerted)
                continue;
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
