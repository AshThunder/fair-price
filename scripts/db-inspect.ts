// Print row counts and the latest Reppo evals from the local store (stop the server first when using PGlite).
// Run: npx tsx scripts/db-inspect.ts
import { createStore } from "../server/db/index.js";
import { databaseUrl } from "../server/env.js";

const store = await createStore({ url: databaseUrl() });
console.log(JSON.stringify({ kind: store.kind, durable: store.durable, migrations: await store.appliedMigrations() }));
for (const t of ["verdicts", "observations", "feedback", "device_keys", "devices", "reppo_evals", "tg_sessions"]) {
  const rows = await store.db.query<{ n: number }>(`select count(*)::int as n from ${t}`);
  console.log(t.padEnd(14), rows[0]?.n);
}
const evals = await store.db.query(
  `select eval_id, verdict_id, status, score, decision, route, credits_charged, latency_ms from reppo_evals order by created_at desc limit 5`,
);
console.table(evals);
await store.close();
