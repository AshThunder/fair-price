// Live end-to-end run against a running server (npm run build && npm start).
// Spends one SERV inference and one Reppo eval (about 440 credits). Never prints keys.
// Run: npx tsx scripts/e2e-live.ts [itemId] [areaId] [quote] [paid]
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const [itemId = "tomatoes", areaId = "NG-KANO", quote = "1400", paid = "1350"] = process.argv.slice(2);
const deviceId = `e2e-${Date.now()}`;

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { status: res.status, body: (await res.json()) as T, ms: Date.now() - t0 };
}

type V = { verdict: Record<string, any> };
const health = await call<Record<string, any>>("/api/health");
console.log("health", JSON.stringify(health.body));

const check = await call<V>("/api/check", {
  method: "POST",
  body: JSON.stringify({ itemId, areaId, quote: Number(quote), deviceId, demo: false, source: "typed" }),
});
if (check.status !== 200) throw new Error(`check failed ${check.status} ${JSON.stringify(check.body)}`);
const v = check.body.verdict;
console.log("check", check.ms, "ms", v.label, v.low, v.mid, v.high, "serv:", v.servAvailable, v.servError ?? "");

const fb = await call<Record<string, any>>("/api/feedback", {
  method: "POST",
  body: JSON.stringify({ verdictId: v.id, kind: "paid", paid: Number(paid), deviceId, demo: false }),
});
console.log("feedback", fb.status, JSON.stringify(fb.body));

const pollStart = Date.now();
let latest = v;
while (Date.now() - pollStart < 240_000) {
  await new Promise((r) => setTimeout(r, 5000));
  latest = (await call<V>(`/api/verdict/${v.id}`)).body.verdict;
  process.stdout.write(`poll ${Math.round((Date.now() - pollStart) / 1000)}s ${latest.reppo?.state} ${latest.reppo?.status ?? ""}\n`);
  if (latest.reppo?.state !== "pending") break;
}
const evalId = latest.reppo?.evalId;
const stored = evalId ? (await call<Record<string, any>>(`/api/reppo/${evalId}`)).body : null;

const report = {
  ranAt: new Date().toISOString(),
  input: { itemId, areaId, quote: Number(quote), paid: Number(paid) },
  health: health.body,
  check: {
    httpMs: check.ms,
    verdictId: v.id,
    label: v.label,
    range: { low: v.low, mid: v.mid, high: v.high, unit: v.unit, fallback: v.fallback, sampleSize: v.sampleSize },
    servAvailable: v.servAvailable,
    servError: v.servError,
    confidence: v.confidence,
    reasons: v.reasons,
    tip: v.tip,
  },
  feedback: fb.body,
  reppo: latest.reppo,
  reppoStored: stored,
};
mkdirSync("reports", { recursive: true });
writeFileSync("reports/e2e-live.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
