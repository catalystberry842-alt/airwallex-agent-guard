import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from "./store";

export type AuditRecord = { seq: number; ts: string; run_id: string; event: string; data: unknown; prev: string; hash: string };
const file = () => path.join(dataDir(), "audit.jsonl");
const GENESIS = "0".repeat(64);
const SECRET = /(sk-ant-[\w-]+|Bearer\s+[\w.-]+|x-api-key[^,}]*)/gi;

function redact(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null).replace(SECRET, "[REDACTED]"));
}
export function hashOf(r: Omit<AuditRecord, "hash">) {
  return crypto.createHash("sha256").update(JSON.stringify([r.seq, r.ts, r.run_id, r.event, r.data, r.prev])).digest("hex");
}
export function readAudit(): AuditRecord[] {
  if (!fs.existsSync(file())) return [];
  return fs.readFileSync(file(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
/** Append-only: we only ever open the file with the "a" flag. */
export function audit(run_id: string, event: string, data: unknown): AuditRecord {
  const all = readAudit();
  const last = all[all.length - 1];
  const base = { seq: (last?.seq ?? -1) + 1, ts: new Date().toISOString(), run_id, event, data: redact(data), prev: last?.hash ?? GENESIS };
  const rec = { ...base, hash: hashOf(base) };
  fs.appendFileSync(file(), JSON.stringify(rec) + "\n", { flag: "a" });
  return rec;
}
export function verifyChain(recs = readAudit()): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const r of recs) {
    const { hash, ...rest } = r;
    if (r.prev !== prev || hashOf(rest) !== hash) return { ok: false, brokenAt: r.seq };
    prev = hash;
  }
  return { ok: true };
}
