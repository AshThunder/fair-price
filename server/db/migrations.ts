// Ordered, append-only schema migrations. Each runs once and is recorded in
// schema_migrations. The same SQL runs on Postgres (Neon, Vercel Postgres, any
// DATABASE_URL) and on PGlite for local dev and tests.
export interface Migration {
  version: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: "001_init",
    sql: `
create table if not exists verdicts (
  id text primary key,
  item_id text not null,
  area_id text not null,
  quote_naira double precision not null,
  final text not null,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists verdicts_created_idx on verdicts (created_at desc);

create table if not exists observations (
  id text primary key,
  item_id text not null,
  area_id text not null,
  price_naira double precision not null,
  source text not null,
  status text not null,
  trust double precision not null,
  device_hash text not null,
  tag text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists observations_item_area_idx on observations (item_id, area_id);
create index if not exists observations_device_idx on observations (device_hash);

create table if not exists feedback (
  id text primary key,
  verdict_id text not null references verdicts(id) on delete cascade,
  kind text not null,
  paid_naira double precision,
  device_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists feedback_verdict_idx on feedback (verdict_id);

-- One row per device, item and area. Holds the time of the last accepted
-- confirmation so a 24-hour duplicate window can be claimed atomically.
create table if not exists device_keys (
  device_hash text not null,
  item_id text not null,
  area_id text not null,
  last_at timestamptz not null,
  primary key (device_hash, item_id, area_id)
);

create table if not exists devices (
  device_hash text primary key,
  accepted integer not null default 0,
  quarantined integer not null default 0,
  rejected integer not null default 0,
  trust double precision not null default 0.45,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists reppo_evals (
  eval_id text primary key,
  verdict_id text,
  task_type text not null,
  status text not null,
  score double precision,
  decision text,
  route text,
  reason text,
  credits_charged integer,
  latency_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  last_polled_at timestamptz
);
create index if not exists reppo_evals_verdict_idx on reppo_evals (verdict_id);
create index if not exists reppo_evals_created_idx on reppo_evals (created_at desc);

create table if not exists tg_sessions (
  chat_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
`,
  },
  {
    // Fair Price goes global: amounts are in the area's own currency, never naira by
    // assumption. Existing rows were all Nigerian, so they default to NGN.
    version: "002_global_currency",
    sql: `
alter table verdicts rename column quote_naira to quote;
alter table verdicts add column if not exists currency text not null default 'NGN';
alter table verdicts add column if not exists country text not null default 'NG';

alter table observations rename column price_naira to price;
alter table observations add column if not exists currency text not null default 'NGN';
alter table observations add column if not exists unit text;
alter table observations add column if not exists item_name text;
alter table observations add column if not exists verdict_id text;
create index if not exists observations_item_currency_idx on observations (item_id, currency);
create index if not exists observations_verdict_idx on observations (verdict_id);

alter table feedback rename column paid_naira to paid;
alter table feedback add column if not exists currency text not null default 'NGN';

-- What a completed Reppo score did to the trust of the confirmation it scored.
alter table reppo_evals add column if not exists trust_effect text;
`,
  },
];
