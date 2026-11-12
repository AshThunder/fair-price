import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { ROOT, databaseUrl } from "../env.js";
import { pgliteExecutor, postgresExecutor } from "./sql.js";
import { SqlStore } from "./store.js";

export { SqlStore } from "./store.js";

let current: Promise<SqlStore> | null = null;

/**
 * Pick the store:
 * - DATABASE_URL (or POSTGRES_URL): Postgres, e.g. Neon or Vercel Postgres. Durable.
 * - FAIRPRICE_STORE=memory: in-memory PGlite (tests, throwaway runs).
 * - otherwise: PGlite on disk at PGLITE_DIR (default data/.pglite). On a read-only
 *   host without a database URL it falls back to in-memory PGlite and /api/health
 *   reports durable:false.
 */
export async function createStore(opts?: { url?: string; pgliteDir?: string }): Promise<SqlStore> {
  const url = opts?.url ?? databaseUrl();
  if (url) {
    const store = new SqlStore(await postgresExecutor(url));
    await store.init();
    return store;
  }
  const dir = opts?.pgliteDir ?? pgliteDir();
  if (dir !== "memory://") {
    try {
      mkdirSync(dir, { recursive: true });
      const store = new SqlStore(await pgliteExecutor(dir));
      await store.init();
      return store;
    } catch {
      // Read-only filesystem (for example a serverless bundle). Use memory instead.
    }
  }
  const store = new SqlStore(await pgliteExecutor("memory://"));
  await store.init();
  return store;
}

function pgliteDir(): string {
  if ((process.env.FAIRPRICE_STORE ?? "").toLowerCase() === "memory") return "memory://";
  if (process.env.PGLITE_DIR) return process.env.PGLITE_DIR;
  if (process.env.VERCEL) return "memory://";
  return join(ROOT, "data/.pglite");
}

export function getStore(): Promise<SqlStore> {
  if (!current) {
    current = createStore().catch((err) => {
      current = null;
      throw err;
    });
  }
  return current;
}

/** Swap the process-wide store (tests and scripts). */
export function setStore(store: SqlStore | null): void {
  current = store ? Promise.resolve(store) : null;
}
