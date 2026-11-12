/**
 * Submit a small batch of sanitized Fair Price evidence packs to Reppo
 * and wait until COMPLETED/FAILED. Writes data/demo-evals.json.
 * Run only when you intend to spend Reppo credits (440 per completed eval).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { codeVerdict } from "../shared/engine.js";
import { evidencePackText } from "../shared/sanitize.js";
import { submitEval, pollEval } from "../server/reppo.js";
import { getSeed, allObservations } from "../server/store.js";
import { ROOT } from "../server/env.js";
import { defaultTip } from "../shared/engine.js";

const cases = [
  { id: "demo-rice-fair", itemId: "rice-local", areaId: "NG", quote: 1905.43, label: "fair" },
  { id: "demo-tomatoes-feedback", itemId: "tomatoes", areaId: "NG-KANO", quote: 1400, label: "fair" },
];

async function main() {
  const seed = getSeed();
  const asOf = new Date("2026-11-12T15:00:00Z");
  const obs = allObservations();
  const evals = [];
  for (const c of cases) {
    const item = seed.items.find((i) => i.id === c.itemId)!;
    const area = seed.areas.find((a) => a.id === c.areaId)!;
    const code = codeVerdict(item, area, c.quote, seed.officialRefs, obs, seed.areas, asOf);
    const pack = evidencePackText({
      itemName: item.name,
      areaName: area.name,
      unit: item.unit,
      quoteNaira: c.quote,
      mid: code.range.mid,
      low: code.range.low,
      high: code.range.high,
      fallback: code.range.fallback,
      points: code.range.points,
      reasons: [`Code verdict ${code.label}. ${c.label} case for the Fair Price demo.`],
      verdict: code.label,
      tip: defaultTip(code.label, item, code.range, c.quote),
    });
    process.stdout.write(`Submitting ${c.id} (${pack.length} chars)...\n`);
    const submitted = await submitEval({ taskType: "claim", input: pack, verdictId: c.id });
    process.stdout.write(`Queued ${submitted.evalId} status ${submitted.status}\n`);
    const done = await pollEval(submitted.evalId, { timeoutMs: 150_000, intervalMs: 6_000 });
    evals.push({
      evalId: done.id,
      verdictId: c.id,
      taskType: "claim" as const,
      status: done.status,
      score: done.score,
      decision: done.decision,
      route: done.route,
      reason: `${c.label}. ${done.reason ?? ""}`.trim(),
      creditsCharged: done.creditsCharged,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    process.stdout.write(`Finished ${done.id} status ${done.status} score ${done.score}\n`);
  }
  const out = join(ROOT, "data/demo-evals.json");
  writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), evals }, null, 2) + "\n");
  process.stdout.write(`Wrote ${evals.length} evals to data/demo-evals.json\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
