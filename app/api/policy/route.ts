import { loadPolicy, savePolicy } from "@/lib/store";
import { audit } from "@/lib/audit";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET() { return Response.json(loadPolicy()); }
export async function PUT(req: Request) {
  if (process.env.POLICY_EDIT_TOKEN && req.headers.get("x-policy-token") !== process.env.POLICY_EDIT_TOKEN) return Response.json({ error: "policy edit token required" }, { status: 403 });
  let p; try { p = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  for (const k of ["perTxLimit", "dailyLimit", "humanApprovalAbove", "beneficiaries", "invoices", "supportedCorridors", "injectionPatterns"]) if (!(k in p)) return Response.json({ error: `missing ${k}` }, { status: 400 });
  try { for (const r of p.injectionPatterns) new RegExp(r); } catch { return Response.json({ error: "invalid regex in injectionPatterns" }, { status: 400 }); }
  const prev = loadPolicy(); p.version = (prev.version ?? 0) + 1; savePolicy(p);
  audit("policy", "policy.updated", { version: p.version });
  return Response.json(p);
}
