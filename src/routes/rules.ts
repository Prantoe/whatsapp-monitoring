// src/routes/rules.ts
import { Router } from "express";
import type { RulesStore, Rule } from "../rulesStore";
import { normalizePhone } from "../activeRules";

function asNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function parseRuleBody(body: any): Rule {
  const phone = normalizePhone(body?.phone);
  const trigger = String(body?.trigger ?? "").trim();
  const threshold = asNumber(body?.threshold);

  if (!phone) throw new Error("Invalid phone");
  if (!trigger) throw new Error("Trigger is required");
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error("Invalid threshold");

  return { phone, trigger, threshold };
}

export function createRulesRouter(store: RulesStore) {
  const r = Router();

  // list all
  r.get("/", async (_req, res) => {
    const rules = await store.list();
    res.json({ ok: true, data: rules });
  });

  // "active" (tanpa DB => semua dianggap aktif)
  r.get("/active", async (_req, res) => {
    const rules = await store.list();
    res.json({ ok: true, data: rules });
  });

  // upsert by phone
  r.post("/", async (req, res) => {
    try {
      const rule = parseRuleBody(req.body);
      const saved = await store.upsert(rule);
      res.json({ ok: true, data: saved });
    } catch (e: any) {
      res.status(400).json({ ok: false, message: e?.message || "Bad request" });
    }
  });

  // update by phone (same as upsert but partial allowed)
  r.patch("/:phone", async (req, res) => {
    try {
      const phone = normalizePhone(req.params.phone);
      if (!phone) throw new Error("Invalid phone param");

      const all = await store.list();
      const cur = all.find((x) => x.phone === phone);
      if (!cur) throw new Error("Rule not found");

      const next: Rule = {
        phone,
        trigger: req.body?.trigger != null ? String(req.body.trigger).trim() : cur.trigger,
        threshold: req.body?.threshold != null ? asNumber(req.body.threshold) : cur.threshold,
      };

      if (!next.trigger) throw new Error("Trigger is required");
      if (!Number.isFinite(next.threshold) || next.threshold <= 0) throw new Error("Invalid threshold");

      const saved = await store.upsert(next);
      res.json({ ok: true, data: saved });
    } catch (e: any) {
      res.status(400).json({ ok: false, message: e?.message || "Bad request" });
    }
  });

  // delete by phone
  r.delete("/:phone", async (req, res) => {
    try {
      const phone = normalizePhone(req.params.phone);
      if (!phone) throw new Error("Invalid phone param");

      const out = await store.remove(phone);
      res.json({ ok: true, data: out });
    } catch (e: any) {
      res.status(400).json({ ok: false, message: e?.message || "Bad request" });
    }
  });

  return r;
}
