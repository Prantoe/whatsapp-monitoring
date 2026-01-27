import type { Msg, State } from "./types";

export const store = {
  state: { state: "booting", me: null } as State,
  messages: [] as Msg[],
  lastRead: new Map<string, number>(),

  pushMsg(m: Msg) {
    this.messages.push(m);
    if (this.messages.length > 200) this.messages.shift();
  },

  markReadClient(clientId: string) {
    this.lastRead.set(clientId, Date.now());
  },

  computeIsRead(m: Msg) {
    const last = this.lastRead.get(m.clientId) || 0;
    return m.direction === "out" || m.ts <= last;
  },

  snapshot() {
    return this.messages.map((m) => ({ ...m, isRead: this.computeIsRead(m) }));
  },

  clearAll() {
    this.messages.length = 0;
  },

  clearClient(clientId: string) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].clientId === clientId) this.messages.splice(i, 1);
    }
  },
};
