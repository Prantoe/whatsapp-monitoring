"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadActiveRules = loadActiveRules;
exports.loadActiveRulesFromStore = loadActiveRulesFromStore;
exports.getRules = getRules;
exports.getRuleByPhone = getRuleByPhone;
exports.normalizePhone = normalizePhone;
// src/activeRules.ts
const promises_1 = require("fs/promises");
let RULES = [];
let RULE_BY_PHONE = new Map();
function normalizePhone(raw) {
    let s = String(raw ?? "").trim();
    s = s.replace(/@.+$/i, "");
    s = s.replace(/\D/g, "");
    if (s.startsWith("0"))
        s = "62" + s.slice(1);
    if (!s.startsWith("62") && s.startsWith("8"))
        s = "62" + s;
    if (!/^62\d{7,15}$/.test(s))
        return "";
    return s;
}
function setRules(rules) {
    RULES = rules;
    RULE_BY_PHONE = new Map(rules.map((r) => [r.phone, r]));
}
async function loadActiveRules(filePath = "rules.txt") {
    const raw = await (0, promises_1.readFile)(filePath, "utf8");
    const rules = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((line, idx) => {
        const parts = line.split("|").map((x) => (x ?? "").trim());
        if (parts.length < 3)
            throw new Error(`Invalid rule line #${idx + 1}: "${line}"`);
        const phone = normalizePhone(parts[0]);
        const trigger = parts[1];
        const threshold = Number(parts[2]);
        if (!phone)
            throw new Error(`Invalid phone line #${idx + 1}: "${parts[0]}"`);
        if (!trigger)
            throw new Error(`Empty trigger line #${idx + 1}`);
        if (!Number.isFinite(threshold) || threshold <= 0) {
            throw new Error(`Invalid threshold line #${idx + 1}: "${parts[2]}"`);
        }
        return { phone, trigger, threshold };
    });
    setRules(rules);
    return RULES;
}
async function loadActiveRulesFromStore(store) {
    const rules = await store.list(); // Rule[]
    const active = rules.map((r) => ({
        phone: normalizePhone(r.phone),
        trigger: String(r.trigger ?? "").trim(),
        threshold: Number(r.threshold),
    })).filter((r) => r.phone && r.trigger && Number.isFinite(r.threshold) && r.threshold > 0);
    setRules(active);
    return RULES;
}
function getRules() {
    return RULES;
}
function getRuleByPhone(phoneOrJid) {
    const key = normalizePhone(phoneOrJid);
    return key ? RULE_BY_PHONE.get(key) : undefined;
}
