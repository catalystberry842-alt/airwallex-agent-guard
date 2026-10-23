import crypto from "node:crypto";
import { audit } from "./audit";
import { fingerprint, runChecks } from "./checks";
import * as llm from "./llm";
import * as awx from "./airwallex";
import { appendLedger, loadLedger, loadPending, loadPolicy, savePending } from "./store";
import type { Intent, RunResult, Stage } from "./types";
import type { Beneficiary } from "./types";

export type Deps = {
  plan: (req: string, policy: ReturnType<typeof loadPolicy>) => Promise<unknown>;
  verify: typeof llm.verify;
  execute: (p: Parameters<typeof awx.createTransfer>[0]) => Promise<{ ok: boolean; status: number; body: any }>;
};
export const liveDeps: Deps = { plan: llm.plan, verify: llm.verify, execute: awx.createTransfer };

export type RunOpts = { request: string; request_id?: string; dryRun?: boolean; deps?: Deps };

export async function runPipeline({ request, request_id = crypto.randomUUID(), dryRun = false, deps = liveDeps }: RunOpts): Promise<RunResult> {
  const run_id = crypto.randomUUID();
  const stages: Stage[] = [];
  const res: RunResult = { run_id, request_id, request, outcome: "blocked", reason: "", stages };
  const policy = loadPolicy();
  delete llm.modelUsed.planner; delete llm.modelUsed.verifier;
  audit(run_id, "request.received", { request, request_id, dryRun, policy_version: policy.version });
  const block = (reason: string) => { res.outcome = "blocked"; res.reason = reason; audit(run_id, "run.blocked", { reason }); return res; };
  const timed = async <T,>(fn: () => Promise<T>) => { const t = Date.now(); const v = await fn(); return [v, Date.now() - t] as const; };

  // 1 — planner
  let raw: unknown;
  try {
    const [v, ms] = await timed(() => deps.plan(request, policy));
    raw = v;
    stages.push({ name: "planner", status: "pass", detail: `${llm.modelUsed.planner ?? llm.PLANNER_MODEL} proposed an intent`, data: raw, ms });
    audit(run_id, "planner.intent", { model: llm.modelUsed.planner ?? llm.PLANNER_MODEL, intent: raw });
  } catch (e) {
    stages.push({ name: "planner", status: "fail", detail: String((e as Error).message) });
    return block(`Planner failed: ${(e as Error).message}`);
  }

  // 2 — deterministic checks
  const t2 = Date.now();
  const out = runChecks({ request, intent: raw, request_id, policy, ledger: loadLedger() });
  const failed = out.checks.filter((c) => !c.pass);
  stages.push({ name: "checks", status: out.ok ? "pass" : "fail", detail: out.ok ? `${out.checks.length}/${out.checks.length} checks passed` : failed.map((f) => f.id).join(", "), data: out.checks, ms: Date.now() - t2 });
  audit(run_id, "checks.result", { ok: out.ok, checks: out.checks });
  res.intent = out.intent;
  if (!out.ok) return block(`Policy check failed: ${failed.map((f) => f.detail).join(" | ")}`);
  const intent = out.intent!, ben = out.beneficiary!;

  // 3 — independent verifier
  try {
    const [v, ms] = await timed(() => deps.verify(request, intent, out.checks));
    const pass = v.decision === "approve";
    stages.push({ name: "verifier", status: pass ? "pass" : "fail", detail: `${llm.modelUsed.verifier ?? llm.VERIFIER_MODEL}: ${v.decision} (${v.risk}) — ${v.reason}`, data: v, ms });
    audit(run_id, "verifier.verdict", { model: llm.modelUsed.verifier ?? llm.VERIFIER_MODEL, ...v });
    if (!pass) return block(`Verifier rejected: ${v.reason}`);
  } catch (e) {
    stages.push({ name: "verifier", status: "fail", detail: String((e as Error).message) });
    return block(`Verifier unavailable (fail-closed): ${(e as Error).message}`);
  }

  // 4 — human approval
  if (out.needsHuman) {
    stages.push({ name: "approval", status: "pending", detail: `Amount above ${policy.humanApprovalAbove[intent.currency]} ${intent.currency} — awaiting human` });
    const p = loadPending(); p[run_id] = { run_id, request_id, request, intent, ben, stages, created: new Date().toISOString() }; savePending(p);
    audit(run_id, "approval.requested", { threshold: policy.humanApprovalAbove[intent.currency] });
    res.outcome = "pending_approval"; res.reason = "Awaiting human approval";
    return res;
  }
  stages.push({ name: "approval", status: "skip", detail: "Below human-approval threshold" });
  return execute(res, intent, ben, dryRun, deps);
}

async function execute(res: RunResult, intent: Intent, ben: Beneficiary, dryRun: boolean, deps: Deps): Promise<RunResult> {
  const { run_id, request_id, stages } = res;
  const locked = process.env.LIVE_EXECUTION === "off";
  if (dryRun || locked) {
    stages.push({ name: "execute", status: "skip", detail: locked ? "Live execution disabled on this deployment (LIVE_EXECUTION=off)" : "Dry run — not sent to Airwallex" });
    res.outcome = "dry_run"; res.reason = "All gates passed (dry run)"; audit(run_id, "execute.dry_run", {});
    return res;
  }
  const t = Date.now();
  const payload = { request_id, beneficiary_id: ben.airwallexId, amount: intent.amount, currency: intent.currency, method: ben.method, reason: intent.reason, reference: intent.reference };
  audit(run_id, "execute.request", payload);
  let r;
  try { r = await deps.execute(payload); } catch (e) { r = { ok: false, status: 0, body: { message: (e as Error).message } }; }
  audit(run_id, "execute.response", { status: r.status, body: r.body });
  if (!r.ok) {
    stages.push({ name: "execute", status: "fail", detail: `Airwallex ${r.status}: ${r.body?.message || r.body?.code || "error"}`, data: r.body, ms: Date.now() - t });
    res.outcome = "blocked"; res.reason = `Airwallex rejected: ${r.body?.message || r.status}`;
    return res;
  }
  const b = r.body;
  res.transfer = { id: b.id, status: b.status, short_reference_id: b.short_reference_id, beneficiary_id: b.beneficiary_id };
  stages.push({ name: "execute", status: "pass", detail: `Transfer ${b.short_reference_id || b.id} — ${b.status}`, data: res.transfer, ms: Date.now() - t });
  appendLedger({ request_id, fingerprint: fingerprint(intent), beneficiary: ben.key, amount: intent.amount, currency: intent.currency, invoice_id: intent.invoice_id, at: new Date().toISOString(), airwallex_id: b.id });
  res.outcome = "executed"; res.reason = "Executed in Airwallex sandbox";
  audit(run_id, "run.executed", res.transfer);
  return res;
}

export async function decide(run_id: string, approve: boolean, approver: string, deps: Deps = liveDeps): Promise<RunResult | null> {
  const p = loadPending();
  const item = p[run_id] as any;
  if (!item) return null;
  delete p[run_id]; savePending(p);
  const res: RunResult = { run_id, request_id: item.request_id, request: item.request, outcome: "blocked", reason: "", stages: item.stages.filter((s: Stage) => s.name !== "approval"), intent: item.intent };
  audit(run_id, approve ? "approval.granted" : "approval.denied", { approver });
  if (!approve) { res.stages.push({ name: "approval", status: "fail", detail: `Denied by ${approver}` }); res.reason = "Denied by human"; return res; }
  // Re-run deterministic checks at execution time (limits/duplicates may have changed).
  const out = runChecks({ request: item.request, intent: item.intent, request_id: item.request_id, policy: loadPolicy(), ledger: loadLedger() });
  if (!out.ok) { res.stages.push({ name: "approval", status: "fail", detail: "Re-check failed after approval" }); res.reason = "Re-check failed: " + out.checks.filter((c) => !c.pass).map((c) => c.detail).join(" | "); audit(run_id, "run.blocked", { reason: res.reason }); return res; }
  res.stages.push({ name: "approval", status: "pass", detail: `Approved by ${approver}` });
  return execute(res, out.intent!, out.beneficiary!, false, deps);
}
