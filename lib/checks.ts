import crypto from "node:crypto";
import { IntentSchema, type Beneficiary, type Check, type Intent, type LedgerEntry, type Policy } from "./types";

const MINOR_UNITS: Record<string, number> = { JPY: 0, KRW: 0, USD: 2, EUR: 2, GBP: 2, AUD: 2, SGD: 2, HKD: 2, CNY: 2 };
const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
const ISO = new Set("USD EUR GBP AUD CAD CHF CNY HKD JPY KRW SGD NZD SEK NOK DKK INR IDR MYR PHP THB VND NGN ZAR KES GHS AED SAR BRL MXN PLN CZK HUF TRY ILS".split(" "));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export function fingerprint(i: Pick<Intent, "beneficiary" | "amount" | "currency" | "invoice_id">) {
  return crypto.createHash("sha256").update([norm(i.beneficiary), i.amount.toFixed(2), i.currency, i.invoice_id ?? ""].join("|")).digest("hex").slice(0, 16);
}
/** Numbers literally present in the user's text (handles 1,250.50 and 1.5k). */
export function amountsInText(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/gi)) {
    const n = parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
export function currenciesInText(text: string): string[] {
  const s = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\b([A-Z]{3})\b/g)) if (ISO.has(m[1])) s.add(m[1]);
  for (const [sym, c] of Object.entries(SYMBOLS)) if (text.includes(sym)) s.add(c);
  for (const [w, c] of [["dollar", "USD"], ["euro", "EUR"], ["pound", "GBP"], ["naira", "NGN"]]) if (text.toLowerCase().includes(w)) s.add(c);
  return [...s];
}
export function resolveBeneficiary(name: string, policy: Policy): Beneficiary | undefined {
  const n = norm(name);
  return policy.beneficiaries.find((b) => b.key === n || b.aliases.some((a) => norm(a) === n));
}

export type CheckInput = { request: string; intent: unknown; request_id: string; policy: Policy; ledger: LedgerEntry[]; now?: Date };
export type CheckOutput = { ok: boolean; checks: Check[]; intent?: Intent; beneficiary?: Beneficiary; needsHuman: boolean };

export function runChecks({ request, intent: raw, request_id, policy, ledger, now = new Date() }: CheckInput): CheckOutput {
  const checks: Check[] = [];
  const add = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail });

  // 0. Prompt-injection screen on the raw human text (independent of the LLM).
  const hits = policy.injectionPatterns.map((p) => request.match(new RegExp(p, "i"))?.[0]).filter(Boolean).map((h) => `"${h}"`);
  add("injection_screen", hits.length === 0, hits.length ? `Request contains control-override language: ${hits.join(", ")}` : "No override language");

  add("request_id_uuid", UUID.test(request_id), UUID.test(request_id) ? "request_id is a UUID" : "request_id must be a UUID");

  const parsed = IntentSchema.safeParse(raw);
  add("schema", parsed.success, parsed.success ? "Intent matches schema" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (!parsed.success) return { ok: false, checks, needsHuman: false };
  const it = parsed.data;

  const mu = MINOR_UNITS[it.currency];
  const decOk = mu !== undefined && Math.round(it.amount * 10 ** mu) / 10 ** mu === it.amount;
  add("amount_precision", decOk, decOk ? `${it.amount} ${it.currency} has valid precision` : `Invalid precision/unknown currency for ${it.amount} ${it.currency}`);

  const inText = amountsInText(request);
  const amtOk = inText.some((n) => Math.abs(n - it.amount) < 1e-9);
  add("amount_grounded", amtOk, amtOk ? "Amount appears verbatim in the request" : `Amount ${it.amount} not found in request (saw: ${inText.join(", ") || "none"}) — possible tampering`);

  const curs = currenciesInText(request);
  const curOk = curs.includes(it.currency);
  add("currency_grounded", curOk, curOk ? "Currency stated in request" : `Currency ${it.currency} not stated in request (saw: ${curs.join(", ") || "none"})`);

  const blocked = policy.blockedCurrencies.includes(it.currency) || curs.some((c) => policy.blockedCurrencies.includes(c));
  add("currency_allowed", !blocked, blocked ? `Currency not supported (blocked: ${policy.blockedCurrencies.join(", ")})` : "Currency not on blocklist");

  const ben = resolveBeneficiary(it.beneficiary, policy);
  add("beneficiary_allowlisted", !!ben, ben ? `Resolved to allowlisted '${ben.key}' (${ben.airwallexId})` : `'${it.beneficiary}' is not an allowlisted beneficiary`);
  if (ben) {
    const named = ben.aliases.some((a) => norm(request).includes(norm(a)));
    add("beneficiary_grounded", named, named ? "Beneficiary named in request" : "Beneficiary not named in the request text");
    const corr = policy.supportedCorridors.some((c) => c.currency === it.currency && c.country === ben.country && c.method === ben.method);
    const match = ben.currency === it.currency;
    add("corridor", corr && match, corr && match ? `${it.currency} → ${ben.country} via ${ben.method}` : `Unsupported corridor ${it.currency} → ${ben.country} (beneficiary account is ${ben.currency})`);
  }

  const per = policy.perTxLimit[it.currency];
  add("per_tx_limit", per !== undefined && it.amount <= per, per === undefined ? `No limit configured for ${it.currency}` : `${it.amount} ≤ ${per}? ${it.amount <= per ? "yes" : "no"}`);

  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const today = ledger.filter((l) => new Date(l.at) >= dayStart && l.currency === it.currency).reduce((s, l) => s + l.amount, 0);
  const daily = policy.dailyLimit[it.currency];
  add("daily_limit", daily !== undefined && today + it.amount <= daily, `today ${today} + ${it.amount} vs daily ${daily ?? "n/a"}`);

  const hourAgo = now.getTime() - 3600_000;
  const recent = ledger.filter((l) => new Date(l.at).getTime() > hourAgo).length;
  add("velocity", recent < policy.maxTxPerHour, `${recent} transfers in last hour (max ${policy.maxTxPerHour})`);

  const idemDup = ledger.some((l) => l.request_id === request_id);
  add("idempotency", !idemDup, idemDup ? "request_id already used" : "request_id unused");
  const fp = fingerprint(it);
  const winStart = now.getTime() - policy.duplicateWindowMinutes * 60_000;
  const dup = ledger.find((l) => l.fingerprint === fp && new Date(l.at).getTime() > winStart);
  add("duplicate", !dup, dup ? `Same payment already executed at ${dup.at} (request ${dup.request_id})` : "No duplicate in window");

  if (it.invoice_id || policy.requireInvoice) {
    const inv = policy.invoices.find((v) => v.id === it.invoice_id);
    const paid = ledger.some((l) => l.invoice_id && l.invoice_id === it.invoice_id);
    const ok = !!inv && inv.status === "open" && !paid && inv.amount === it.amount && inv.currency === it.currency && (!ben || inv.beneficiary === ben.key);
    add("invoice_match", ok, !inv ? `Invoice '${it.invoice_id}' not found` : paid ? `Invoice ${inv.id} already paid` : ok ? `Invoice ${inv.id} matches ${inv.amount} ${inv.currency} to ${inv.beneficiary}` : `Invoice ${inv.id} expects ${inv.amount} ${inv.currency} to ${inv.beneficiary}`);
  }

  const ok = checks.every((c) => c.pass);
  const thr = policy.humanApprovalAbove[it.currency];
  return { ok, checks, intent: it, beneficiary: ben, needsHuman: thr !== undefined && it.amount > thr };
}
