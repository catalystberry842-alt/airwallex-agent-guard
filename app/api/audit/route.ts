import { readAudit, verifyChain } from "@/lib/audit";
import { loadPending } from "@/lib/store";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET() {
  const recs = readAudit();
  return Response.json({ chain: verifyChain(recs), records: recs.slice(-200).reverse(), pending: Object.values(loadPending()) });
}
