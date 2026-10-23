/**
 * Offline fallback used ONLY when GUARD_LLM_FALLBACK=rules and the Anthropic API is unreachable.
 * It is clearly labelled in the pipeline/audit and is not a substitute for the model gates.
 */
import { amountsInText, currenciesInText, norm } from "./checks";
import type { Check, Intent, Policy } from "./types";
import type { Verdict } from "./llm";

export function rulePlan(request: string, policy: Policy): Intent {
  const n = norm(request);
  const ben = policy.beneficiaries.flatMap((b) => b.aliases).sort((a, b) => b.length - a.length).find((a) => n.includes(norm(a)));
  const inv = request.match(/invoice\s*#?\s*([A-Za-z0-9-]+)/i)?.[1] ?? null;
  const amounts = amountsInText(request.replace(/invoice\s*#?\s*[A-Za-z0-9-]+/gi, ""));
  return {
    action: "transfer", beneficiary: ben ?? "unknown", amount: amounts[0] ?? 0, currency: currenciesInText(request)[0] ?? "XXX",
    invoice_id: inv, reference: inv ? `INV-${inv}` : "AGENT-PAYMENT", reason: "payment_to_supplier", planner_notes: "offline rules planner",
  };
}
export function ruleVerify(_req: string, _intent: Intent, checks: Check[]): Verdict {
  const ok = checks.every((c) => c.pass);
  return { decision: ok ? "approve" : "reject", reason: ok ? "Offline rules verifier: all deterministic checks passed" : "Offline rules verifier: failing checks", risk: ok ? "medium" : "high" };
}
