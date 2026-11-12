import { randomUUID } from "node:crypto";
import type { FeedbackRecord, Observation, ReppoRecord, StoredVerdict } from "../../shared/types.js";
import { deviceTrust, type DeviceStats } from "../../shared/engine.js";
import { MIGRATIONS } from "./migrations.js";
import type { SqlExecutor } from "./sql.js";

type Row = Record<string, unknown>;

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return new Date(v).toISOString();
  return new Date().toISOString();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function json<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

function toObservation(r: Row): Observation {
  return {
    id: String(r.id),
    itemId: String(r.item_id),
    areaId: String(r.area_id),
    priceNaira: Number(r.price_naira),
    source: r.source as Observation["source"],
    status: r.status as Observation["status"],
    trust: Number(r.trust),
    deviceHash: String(r.device_hash),
    tag: (r.tag ?? undefined) as Observation["tag"],
    note: (r.note ?? undefined) as string | undefined,
    createdAt: iso(r.created_at),
  };
}

function toReppo(r: Row): ReppoRecord {
  return {
    evalId: String(r.eval_id),
    verdictId: (r.verdict_id as string | null) ?? "",
    taskType: r.task_type as ReppoRecord["taskType"],
    status: String(r.status),
    score: num(r.score),
    decision: (r.decision as string | null) ?? null,
    route: (r.route as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    creditsCharged: num(r.credits_charged),
    latencyMs: num(r.latency_ms),
    createdAt: iso(r.created_at),
    completedAt: r.completed_at ? iso(r.completed_at) : undefined,
    lastPolledAt: r.last_polled_at ? iso(r.last_polled_at) : undefined,
  };
}

function toFeedback(r: Row): FeedbackRecord {
  return {
    id: String(r.id),
    verdictId: String(r.verdict_id),
    kind: r.kind as FeedbackRecord["kind"],
    paidNaira: num(r.paid_naira) ?? undefined,
    deviceHash: String(r.device_hash),
    createdAt: iso(r.created_at),
  };
}

export class SqlStore {
  private ready: Promise<void> | null = null;

  constructor(readonly db: SqlExecutor) {}

  get kind() {
    return this.db.kind;
  }

  get durable() {
    return this.db.durable;
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = this.migrate();
    return this.ready;
  }

  private async migrate(): Promise<void> {
    await this.db.exec(
      "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await this.db.query<{ version: string }>("select version from schema_migrations")).map((r) => r.version),
    );
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await this.db.exec(m.sql);
      await this.db.query("insert into schema_migrations (version) values ($1) on conflict do nothing", [m.version]);
    }
  }

  async appliedMigrations(): Promise<string[]> {
    await this.init();
    return (await this.db.query<{ version: string }>("select version from schema_migrations order by version")).map(
      (r) => r.version,
    );
  }

  // Verdicts -----------------------------------------------------------------

  async addVerdict(v: StoredVerdict): Promise<StoredVerdict> {
    await this.init();
    await this.db.query(
      `insert into verdicts (id, item_id, area_id, quote_naira, final, demo, created_at, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [v.id, v.itemId, v.areaId, v.quoteNaira, v.final, v.demo, v.createdAt, JSON.stringify(v)],
    );
    return v;
  }

  async getVerdict(id: string): Promise<StoredVerdict | undefined> {
    await this.init();
    const rows = await this.db.query<Row>("select data from verdicts where id = $1", [id]);
    return rows[0] ? json<StoredVerdict>(rows[0].data) : undefined;
  }

  async updateVerdict(id: string, patch: Partial<StoredVerdict>): Promise<StoredVerdict | undefined> {
    await this.init();
    const current = await this.getVerdict(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    await this.db.query("update verdicts set data = $2::jsonb, final = $3 where id = $1", [
      id,
      JSON.stringify(next),
      next.final,
    ]);
    return next;
  }

  async countVerdicts(): Promise<number> {
    await this.init();
    const rows = await this.db.query<{ n: unknown }>("select count(*) as n from verdicts");
    return Number(rows[0]?.n ?? 0);
  }

  // Observations ---------------------------------------------------------------

  async listObservations(filter?: { itemId?: string }): Promise<Observation[]> {
    await this.init();
    const rows = filter?.itemId
      ? await this.db.query<Row>("select * from observations where item_id = $1 order by created_at desc", [filter.itemId])
      : await this.db.query<Row>("select * from observations order by created_at desc");
    return rows.map(toObservation);
  }

  async addObservation(
    o: Omit<Observation, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ): Promise<Observation> {
    await this.init();
    const row: Observation = {
      ...o,
      id: o.id ?? `obs-${randomUUID()}`,
      createdAt: o.createdAt ?? new Date().toISOString(),
    };
    await this.db.query(
      `insert into observations (id, item_id, area_id, price_naira, source, status, trust, device_hash, tag, note, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.id,
        row.itemId,
        row.areaId,
        row.priceNaira,
        row.source,
        row.status,
        row.trust,
        row.deviceHash,
        row.tag ?? null,
        row.note ?? null,
        row.createdAt,
      ],
    );
    return row;
  }

  // Feedback ---------------------------------------------------------------------

  async addFeedback(
    f: Omit<FeedbackRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ): Promise<FeedbackRecord> {
    await this.init();
    const row: FeedbackRecord = {
      ...f,
      id: f.id ?? `fb-${randomUUID()}`,
      createdAt: f.createdAt ?? new Date().toISOString(),
    };
    await this.db.query(
      `insert into feedback (id, verdict_id, kind, paid_naira, device_hash, created_at) values ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.verdictId, row.kind, row.paidNaira ?? null, row.deviceHash, row.createdAt],
    );
    return row;
  }

  async listFeedback(): Promise<FeedbackRecord[]> {
    await this.init();
    return (await this.db.query<Row>("select * from feedback order by created_at desc")).map(toFeedback);
  }

  // Anti-gaming -------------------------------------------------------------------

  /**
   * Atomically claim the 24-hour confirmation slot for a device, item and area.
   * Returns true when the slot was free (first confirmation, or the last one is
   * older than the window) and false for a duplicate inside the window.
   */
  async claimDeviceKey(args: { deviceHash: string; itemId: string; areaId: string; now: Date; windowMs: number }) {
    await this.init();
    const cutoff = new Date(args.now.getTime() - args.windowMs).toISOString();
    const rows = await this.db.query<Row>(
      `insert into device_keys (device_hash, item_id, area_id, last_at) values ($1, $2, $3, $4)
       on conflict (device_hash, item_id, area_id)
       do update set last_at = excluded.last_at where device_keys.last_at < $5
       returning device_hash`,
      [args.deviceHash, args.itemId, args.areaId, args.now.toISOString(), cutoff],
    );
    return rows.length > 0;
  }

  async getDevice(deviceHash: string): Promise<DeviceStats & { trust: number }> {
    await this.init();
    const rows = await this.db.query<Row>("select * from devices where device_hash = $1", [deviceHash]);
    const r = rows[0];
    if (!r) return { accepted: 0, quarantined: 0, rejected: 0, trust: deviceTrust({ accepted: 0, quarantined: 0, rejected: 0 }) };
    return {
      accepted: Number(r.accepted),
      quarantined: Number(r.quarantined),
      rejected: Number(r.rejected),
      trust: Number(r.trust),
    };
  }

  async recordDeviceOutcome(deviceHash: string, outcome: "accepted" | "quarantine" | "rejected"): Promise<number> {
    await this.init();
    const prev = await this.getDevice(deviceHash);
    const next: DeviceStats = {
      accepted: prev.accepted + (outcome === "accepted" ? 1 : 0),
      quarantined: prev.quarantined + (outcome === "quarantine" ? 1 : 0),
      rejected: prev.rejected + (outcome === "rejected" ? 1 : 0),
    };
    const trust = deviceTrust(next);
    await this.db.query(
      `insert into devices (device_hash, accepted, quarantined, rejected, trust, first_seen, last_seen)
       values ($1, $2, $3, $4, $5, now(), now())
       on conflict (device_hash) do update set accepted = $2, quarantined = $3, rejected = $4, trust = $5, last_seen = now()`,
      [deviceHash, next.accepted, next.quarantined, next.rejected, trust],
    );
    return trust;
  }

  // Reppo evals ---------------------------------------------------------------------

  async upsertReppo(r: ReppoRecord): Promise<ReppoRecord> {
    await this.init();
    await this.db.query(
      `insert into reppo_evals (eval_id, verdict_id, task_type, status, score, decision, route, reason, credits_charged, latency_ms, created_at, completed_at, last_polled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (eval_id) do update set
         verdict_id = coalesce(nullif(excluded.verdict_id, ''), reppo_evals.verdict_id),
         status = excluded.status,
         score = coalesce(excluded.score, reppo_evals.score),
         decision = coalesce(excluded.decision, reppo_evals.decision),
         route = coalesce(excluded.route, reppo_evals.route),
         reason = coalesce(excluded.reason, reppo_evals.reason),
         credits_charged = coalesce(excluded.credits_charged, reppo_evals.credits_charged),
         latency_ms = coalesce(excluded.latency_ms, reppo_evals.latency_ms),
         completed_at = coalesce(excluded.completed_at, reppo_evals.completed_at),
         last_polled_at = coalesce(excluded.last_polled_at, reppo_evals.last_polled_at)`,
      [
        r.evalId,
        r.verdictId || null,
        r.taskType,
        r.status,
        r.score,
        r.decision,
        r.route,
        r.reason,
        r.creditsCharged,
        r.latencyMs ?? null,
        r.createdAt,
        r.completedAt ?? null,
        r.lastPolledAt ?? null,
      ],
    );
    return (await this.getReppo(r.evalId)) ?? r;
  }

  async getReppo(evalId: string): Promise<ReppoRecord | undefined> {
    await this.init();
    const rows = await this.db.query<Row>("select * from reppo_evals where eval_id = $1", [evalId]);
    return rows[0] ? toReppo(rows[0]) : undefined;
  }

  async listReppo(): Promise<ReppoRecord[]> {
    await this.init();
    return (await this.db.query<Row>("select * from reppo_evals order by created_at desc")).map(toReppo);
  }

  async countReppoSince(since: Date): Promise<number> {
    await this.init();
    const rows = await this.db.query<{ n: unknown }>("select count(*) as n from reppo_evals where created_at >= $1", [
      since.toISOString(),
    ]);
    return Number(rows[0]?.n ?? 0);
  }

  // Telegram chat sessions (serverless instances do not share memory) ------------------

  async getSession<T>(chatId: string): Promise<T | undefined> {
    await this.init();
    const rows = await this.db.query<Row>("select data from tg_sessions where chat_id = $1", [chatId]);
    return rows[0] ? json<T>(rows[0].data) : undefined;
  }

  async setSession(chatId: string, data: unknown): Promise<void> {
    await this.init();
    await this.db.query(
      `insert into tg_sessions (chat_id, data, updated_at) values ($1, $2::jsonb, now())
       on conflict (chat_id) do update set data = excluded.data, updated_at = now()`,
      [chatId, JSON.stringify(data)],
    );
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
