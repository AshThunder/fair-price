// Apply migrations to DATABASE_URL (or POSTGRES_URL). Prints only the migration list.
// Run: DATABASE_URL=... npx tsx scripts/db-migrate.ts   (or: vercel env run -- npx tsx scripts/db-migrate.ts)
import { createStore } from "../server/db/index.js";
import { databaseUrl } from "../server/env.js";

const url = databaseUrl();
if (!url) throw new Error("Set DATABASE_URL or POSTGRES_URL");
const store = await createStore({ url });
console.log(JSON.stringify({ kind: store.kind, durable: store.durable, migrations: await store.appliedMigrations() }));
await store.close();
