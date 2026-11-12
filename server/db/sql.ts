// A tiny SQL executor interface so the store can run on Postgres in production
// and on PGlite (embedded Postgres in WASM) for local dev and tests.
export interface SqlExecutor {
  kind: "postgres" | "pglite";
  durable: boolean;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

export async function postgresExecutor(url: string): Promise<SqlExecutor> {
  const { default: postgres } = await import("postgres");
  // prepare:false keeps this compatible with PgBouncer-style poolers (Neon, Vercel Postgres).
  const sql = postgres(url, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? "3"),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  return {
    kind: "postgres",
    durable: true,
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export async function pgliteExecutor(dataDir: string): Promise<SqlExecutor> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = dataDir === "memory://" ? new PGlite() : new PGlite(dataDir);
  await db.waitReady;
  return {
    kind: "pglite",
    durable: dataDir !== "memory://",
    async query<T>(text: string, params: unknown[] = []) {
      const result = await db.query(text, params);
      return result.rows as T[];
    },
    async exec(text: string) {
      await db.exec(text);
    },
    async close() {
      await db.close();
    },
  };
}
