import fs from "node:fs";
import path from "node:path";
import type { LedgerEntry, Policy } from "./types";

const BUNDLED = path.join(process.cwd(), "data", "policy.json");
export function dataDir() {
  const d = process.env.GUARD_DATA_DIR || (process.env.VERCEL ? "/tmp/guard" : path.join(process.cwd(), "data"));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function loadPolicy(): Policy {
  const p = path.join(dataDir(), "policy.json");
  return JSON.parse(fs.readFileSync(fs.existsSync(p) ? p : BUNDLED, "utf8"));
}
export function savePolicy(p: Policy) {
  fs.writeFileSync(path.join(dataDir(), "policy.json"), JSON.stringify(p, null, 2));
}
const ledgerPath = () => path.join(dataDir(), "ledger.json");
export function loadLedger(): LedgerEntry[] {
  try { return JSON.parse(fs.readFileSync(ledgerPath(), "utf8")); } catch { return []; }
}
export function appendLedger(e: LedgerEntry) {
  const l = loadLedger(); l.push(e); fs.writeFileSync(ledgerPath(), JSON.stringify(l, null, 2));
}
const pendingPath = () => path.join(dataDir(), "pending.json");
export function loadPending(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(pendingPath(), "utf8")); } catch { return {}; }
}
export function savePending(p: Record<string, unknown>) { fs.writeFileSync(pendingPath(), JSON.stringify(p, null, 2)); }
