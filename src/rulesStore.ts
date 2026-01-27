import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export type Rule = {
  phone: string;      // 62xxx
  trigger: string;
  threshold: number;  // detik
};

type Data = { rules: Rule[] };

export class RulesStore {
  private filePath: string;

  constructor(filePath = "rules.json") {
    this.filePath = filePath;
  }

  private async ensureDir() {
    const dir = path.dirname(this.filePath);
    if (dir && dir !== ".") await mkdir(dir, { recursive: true });
  }

  private async read(): Promise<Data> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const json = JSON.parse(raw || "{}");
      const rules = Array.isArray(json.rules) ? json.rules : Array.isArray(json) ? json : [];
      return { rules };
    } catch {
      return { rules: [] };
    }
  }

  private async write(data: Data) {
    await this.ensureDir();
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  // ✅ this is what activeRules expects
  async list(): Promise<Rule[]> {
    const d = await this.read();
    return d.rules;
  }

  async replaceAll(rules: Rule[]) {
    await this.write({ rules });
    return rules;
  }

  async upsert(rule: Rule) {
    const d = await this.read();
    const idx = d.rules.findIndex((r) => r.phone === rule.phone);
    if (idx >= 0) d.rules[idx] = rule;
    else d.rules.push(rule);
    await this.write(d);
    return rule;
  }

  async remove(phone: string) {
    const d = await this.read();
    const before = d.rules.length;
    d.rules = d.rules.filter((r) => r.phone !== phone);
    await this.write(d);
    return { removed: before - d.rules.length };
  }
}
