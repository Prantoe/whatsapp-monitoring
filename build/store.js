"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.store = void 0;
exports.store = {
    state: { state: "booting", me: null },
    messages: [],
    lastRead: new Map(),
    pushMsg(m) {
        this.messages.push(m);
        if (this.messages.length > 200)
            this.messages.shift();
    },
    markReadClient(clientId) {
        this.lastRead.set(clientId, Date.now());
    },
    computeIsRead(m) {
        const last = this.lastRead.get(m.clientId) || 0;
        return m.direction === "out" || m.ts <= last;
    },
    snapshot() {
        return this.messages.map((m) => ({ ...m, isRead: this.computeIsRead(m) }));
    },
    clearAll() {
        this.messages.length = 0;
    },
    clearClient(clientId) {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].clientId === clientId)
                this.messages.splice(i, 1);
        }
    },
};
