"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RulesStore = void 0;
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
class RulesStore {
    filePath;
    constructor(filePath = "rules.json") {
        this.filePath = filePath;
    }
    async ensureDir() {
        const dir = path_1.default.dirname(this.filePath);
        if (dir && dir !== ".")
            await (0, promises_1.mkdir)(dir, { recursive: true });
    }
    async read() {
        try {
            const raw = await (0, promises_1.readFile)(this.filePath, "utf8");
            const json = JSON.parse(raw || "{}");
            const rules = Array.isArray(json.rules) ? json.rules : Array.isArray(json) ? json : [];
            return { rules };
        }
        catch {
            return { rules: [] };
        }
    }
    async write(data) {
        await this.ensureDir();
        await (0, promises_1.writeFile)(this.filePath, JSON.stringify(data, null, 2), "utf8");
    }
    // ✅ this is what activeRules expects
    async list() {
        const d = await this.read();
        return d.rules;
    }
    async replaceAll(rules) {
        await this.write({ rules });
        return rules;
    }
    async upsert(rule) {
        const d = await this.read();
        const idx = d.rules.findIndex((r) => r.phone === rule.phone);
        if (idx >= 0)
            d.rules[idx] = rule;
        else
            d.rules.push(rule);
        await this.write(d);
        return rule;
    }
    async remove(phone) {
        const d = await this.read();
        const before = d.rules.length;
        d.rules = d.rules.filter((r) => r.phone !== phone);
        await this.write(d);
        return { removed: before - d.rules.length };
    }
}
exports.RulesStore = RulesStore;
