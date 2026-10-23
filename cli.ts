#!/usr/bin/env tsx
import fs from "node:fs";
import { runPipeline } from "./lib/pipeline";
import { readAudit, verifyChain } from "./lib/audit";

// Load Airwallex creds from a dotenv file without printing them.
const envFile = process.env.AIRWALLEX_ENV_FILE || "/home/box/.airwallex-sandbox.env";
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = l.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "audit") {
  const a = readAudit(); console.log(JSON.stringify({ records: a.length, chain: verifyChain(a), last: a.slice(-5) }, null, 2));
} else if (cmd === "run" || cmd === "dry") {
  const r = await runPipeline({ request: rest.join(" "), dryRun: cmd === "dry" });
  for (const s of r.stages) console.log(`${s.status.toUpperCase().padEnd(7)} ${s.name.padEnd(9)} ${s.detail}`);
  console.log(`\n=> ${r.outcome}: ${r.reason}`);
  if (r.transfer) console.log(JSON.stringify(r.transfer));
} else {
  console.log('usage: pnpm guard run "pay Acme 5 USD for invoice 43" | dry "<request>" | audit');
}
