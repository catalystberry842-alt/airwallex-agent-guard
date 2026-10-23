import { decide } from "@/lib/pipeline";
export const runtime = "nodejs"; export const maxDuration = 60;
export async function POST(req: Request) {
  const { run_id, approve } = await req.json();
  if (process.env.APPROVER_TOKEN && req.headers.get("x-approver-token") !== process.env.APPROVER_TOKEN) return Response.json({ error: "approver token required" }, { status: 403 });
  const r = await decide(String(run_id), !!approve, "dashboard-approver");
  return r ? Response.json(r) : Response.json({ error: "not pending" }, { status: 404 });
}
