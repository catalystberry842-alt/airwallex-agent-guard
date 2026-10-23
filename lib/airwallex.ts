export const AW_BASE = process.env.AIRWALLEX_BASE_URL || "https://api-demo.airwallex.com/api/v1";
let cached: { token: string; exp: number } | null = null;

async function token() {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const id = process.env.AIRWALLEX_CLIENT_ID, key = process.env.AIRWALLEX_API_KEY;
  if (!id || !key) throw new Error("Airwallex credentials not configured");
  const r = await fetch(`${AW_BASE}/authentication/login`, { method: "POST", headers: { "x-client-id": id, "x-api-key": key, "content-type": "application/json" } });
  if (!r.ok) throw new Error(`Airwallex auth ${r.status}`);
  const j = await r.json();
  cached = { token: j.token, exp: Date.now() + 29 * 60_000 };
  return cached.token;
}
async function aw(path: string, init: RequestInit = {}) {
  const r = await fetch(`${AW_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, "content-type": "application/json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}
export async function getBalances() {
  const r = await aw("/balances/current");
  return r.ok ? { available: true, balances: r.body } : { available: false, status: r.status, note: "Balances endpoint not permitted for this key; relying on Airwallex funding check" };
}
export async function getBeneficiary(id: string) { return aw(`/beneficiaries/${id}`); }
export async function createTransfer(p: { request_id: string; beneficiary_id: string; amount: number; currency: string; method: string; reason: string; reference: string }) {
  return aw("/transfers/create", {
    method: "POST",
    body: JSON.stringify({
      request_id: p.request_id, beneficiary_id: p.beneficiary_id, source_currency: p.currency, transfer_currency: p.currency,
      transfer_amount: p.amount, transfer_method: p.method, reason: p.reason, reference: p.reference.slice(0, 35),
    }),
  });
}
export async function getTransfer(id: string) { return aw(`/transfers/${id}`); }
