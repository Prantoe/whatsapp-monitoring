// src/activeRules.ts
import { readFile } from "fs/promises";
import type { Rule } from "./rulesStore"; // <-- pastikan type ini ada
import { RulesStore } from "./rulesStore";

export type ActiveRule = {
  phone: string;
  trigger: string;
  threshold: number;

  sendTime?: number;
  replied?: boolean;
  alerted?: boolean;
  lastInboundAt?: number;
  pendingNoReplyAt?: number;
};

let RULES: ActiveRule[] = [];
let RULE_BY_PHONE = new Map<string, ActiveRule>();

function normalizePhone(raw: unknown): string {
  let s = String(raw ?? "").trim();
  s = s.replace(/@.+$/i, "");
  s = s.replace(/\D/g, "");
  if (s.startsWith("0")) s = "62" + s.slice(1);
  if (!s.startsWith("62") && s.startsWith("8")) s = "62" + s;
  if (!/^62\d{7,15}$/.test(s)) return "";
  return s;
}

function setRules(rules: ActiveRule[]) {
  RULES = rules;
  RULE_BY_PHONE = new Map(rules.map((r) => [r.phone, r]));
}

export async function loadActiveRules(filePath = "rules.txt") {
  const raw = await readFile(filePath, "utf8");

  const rules: ActiveRule[] = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((line, idx) => {
      const parts = line.split("|").map((x) => (x ?? "").trim());
      if (parts.length < 3) throw new Error(`Invalid rule line #${idx + 1}: "${line}"`);

      const phone = normalizePhone(parts[0]);
      const trigger = parts[1];
      const threshold = Number(parts[2]);

      if (!phone) throw new Error(`Invalid phone line #${idx + 1}: "${parts[0]}"`);
      if (!trigger) throw new Error(`Empty trigger line #${idx + 1}`);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        throw new Error(`Invalid threshold line #${idx + 1}: "${parts[2]}"`);
      }

      return { phone, trigger, threshold };
    });

  setRules(rules);
  return RULES;
}

export async function loadActiveRulesFromStore(store: RulesStore) {
  const rules = await store.list(); // Rule[]
  const active: ActiveRule[] = rules.map((r: Rule) => ({
    phone: normalizePhone(r.phone),
    trigger: String(r.trigger ?? "").trim(),
    threshold: Number(r.threshold),
  })).filter((r) => r.phone && r.trigger && Number.isFinite(r.threshold) && r.threshold > 0);

  setRules(active);
  return RULES;
}

export function getRules() {
  return RULES;
}

export function getRuleByPhone(phoneOrJid: string) {
  const key = normalizePhone(phoneOrJid);
  return key ? RULE_BY_PHONE.get(key) : undefined;
}

export { normalizePhone };
