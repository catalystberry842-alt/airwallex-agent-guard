import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
process.env.GUARD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
const { runPipeline, decide } = await import("../lib/pipeline");
const { readAudit, verifyChain } = await import("../lib/audit");
const { savePolicy, loadPolicy } = await import("../lib/store");

const intent = { action: "transfer", beneficiary: "Acme", amount: 5, currency: "USD", invoice_id: "43", reference: "INV-43", reason: "payment_to_supplier" };
let executed = 0;
const deps = (o: any = {}) => ({
  plan: async () => intent,
  verify: async () => ({ decision: "approve" as const, reason: "faithful", risk: "low" as const }),
  execute: async (p: any) => { executed++; return { ok: true, status: 201, body: { id: "t-" + p.request_id, status: "SCHEDULED", short_reference_id: "P-TEST", beneficiary_id: p.beneficiary_id } }; },
  ...o,
});
beforeEach(() => { executed = 0; for (const f of ["ledger.json", "pending.json"]) fs.rmSync(path.join(process.env.GUARD_DATA_DIR!, f), { force: true }); });

describe("pipeline", () => {
  it("executes when all gates pass", async () => {
    const r = await runPipeline({ request: "pay Acme 5 USD for invoice 43", deps: deps() });
    expect(r.outcome).toBe("executed"); expect(executed).toBe(1);
    expect(r.stages.map((s) => s.status)).toEqual(["pass", "pass", "pass", "skip", "pass"]);
  });
  it("blocks the second identical payment (duplicate)", async () => {
    await runPipeline({ request: "pay Acme 5 USD for invoice 43", deps: deps() });
    const r = await runPipeline({ request: "pay Acme 5 USD for invoice 43", deps: deps() });
    expect(r.outcome).toBe("blocked"); expect(executed).toBe(1);
  });
  it("verifier reject blocks even when checks pass", async () => {
    const r = await runPipeline({ request: "pay Acme 5 USD for invoice 43", deps: deps({ verify: async () => ({ decision: "reject", reason: "suspicious", risk: "high" }) }) });
    expect(r.outcome).toBe("blocked"); expect(executed).toBe(0);
  });
  it("verifier outage fails closed", async () => {
    const r = await runPipeline({ request: "pay Acme 5 USD for invoice 43", deps: deps({ verify: async () => { throw new Error("timeout"); } }) });
    expect(r.outcome).toBe("blocked"); expect(executed).toBe(0);
  });
  it("compromised planner (tampered amount) never reaches verifier or executor", async () => {
    let verified = 0;
    const r = await runPipeline({ request: "pay Acme 5 USD for invoice 43", deps: deps({ plan: async () => ({ ...intent, amount: 999 }), verify: async () => { verified++; return { decision: "approve", reason: "", risk: "low" }; } }) });
    expect(r.outcome).toBe("blocked"); expect(verified).toBe(0); expect(executed).toBe(0);
  });
  it("human approval gate holds then executes on approve", async () => {
    const p = loadPolicy(); savePolicy({ ...p, humanApprovalAbove: { ...p.humanApprovalAbove, USD: 1 } });
    const r = await runPipeline({ request: "pay Acme 5 USD for invoice 43", deps: deps() });
    expect(r.outcome).toBe("pending_approval"); expect(executed).toBe(0);
    const d = await decide(r.run_id, true, "tester", deps());
    expect(d?.outcome).toBe("executed"); expect(executed).toBe(1);
    savePolicy(p);
  });
  it("audit log is hash-chained and tamper-evident", async () => {
    await runPipeline({ request: "pay Acme 5 USD for invoice 43", dryRun: true, deps: deps() });
    const recs = readAudit(); expect(recs.length).toBeGreaterThan(3); expect(verifyChain(recs).ok).toBe(true);
    const t = recs.map((r) => ({ ...r })); (t[1] as any).data = { tampered: true };
    expect(verifyChain(t)).toEqual({ ok: false, brokenAt: 1 });
  });
});
