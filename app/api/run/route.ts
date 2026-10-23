import { runPipeline } from "@/lib/pipeline";
export const runtime = "nodejs"; export const maxDuration = 60;
export async function POST(req: Request) {
  const { request, dryRun } = await req.json();
  if (typeof request !== "string" || !request.trim() || request.length > 1000) return Response.json({ error: "request must be 1-1000 chars" }, { status: 400 });
  return Response.json(await runPipeline({ request: request.trim(), dryRun: !!dryRun }));
}
