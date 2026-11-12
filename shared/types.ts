export type VerdictLabel = "fair" | "high" | "low" | "uncertain";

/** country > region (state, province, zone) > city. Areas never cross a country. */
export type AreaKind = "country" | "region" | "city";

export type Category = "food" | "fuel" | "transport" | "repair" | "rent" | "service" | "other";

export interface Item {
  id: string;
  /** Default display name. */
  name: string;
  /** Default unit, metric. */
  unit: string;
  category: Category;
  /** Per-country names, e.g. { US: "Gasoline (regular)" }. */
  names?: Record<string, string>;
  /** Per-country units, e.g. { US: "1 US gallon" }. Prices in a country always use its unit. */
  units?: Record<string, string>;
  /** Extra words people type for this item. */
  aliases?: string[];
  /** Set for free-text items that are not in the catalog. */
  custom?: boolean;
  nbsLabel?: string | null;
}

export interface Area {
  id: string;
  name: string;
  kind: AreaKind;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** ISO 4217. Every price in this area is in this currency. */
  currency: string;
  parentId: string | null;
  aliases?: string[];
  /** Set for free-text places that are not in the seed. */
  custom?: boolean;
}

export interface OfficialRef {
  id: string;
  itemId: string;
  areaId: string;
  price: number;
  currency: string;
  grain: AreaKind;
  period: string;
  source: string;
  series: string;
  sourceUrl: string;
  retrieved: string;
  licenceNote: string;
  note?: string;
}

export interface Observation {
  id: string;
  itemId: string;
  areaId: string;
  price: number;
  currency: string;
  unit?: string;
  itemName?: string;
  verdictId?: string;
  source: "typed" | "photo-confirmed" | "demo-seed" | "telegram";
  status: "pending" | "accepted" | "rejected" | "quarantine";
  trust: number;
  deviceHash: string;
  createdAt: string;
  tag?: "demo" | "live";
  note?: string;
}

export interface BenchmarkCase {
  id: string;
  itemId: string;
  areaId: string;
  quote: number;
  currency?: string;
  country?: string;
  expected: VerdictLabel;
  trueAmount: number | null;
  note: string;
  split?: "dev" | "test";
  truthSource?: string;
  category?: Item["category"];
  /** "control" when the truth is the same figure as the seed anchor. */
  kind?: "cross-source" | "control";
}

export interface BenchmarkSource {
  id: string;
  title: string;
  url: string;
  published: string;
  kind: "official" | "press-report-of-official" | "press" | "listing-aggregate";
  note: string;
}

export interface BenchmarkFile {
  version: string;
  asOf: string;
  method: string[];
  labelRule: string;
  sources: BenchmarkSource[];
  truths: Array<{ itemId: string; areaId: string; truthAmount: number; source: string; reasoning: string; currency?: string }>;
  cases: BenchmarkCase[];
}

export interface CountryInfo {
  code: string;
  name: string;
  currency: string;
  locale: string;
  /** "imperial" uses lb and US gallons for new items; "metric" uses kg and litres. */
  units: "metric" | "imperial";
  seeded: boolean;
}

export interface SeedFile {
  generated: string;
  countries: CountryInfo[];
  disclaimer: string;
  items: Item[];
  areas: Area[];
  officialRefs: OfficialRef[];
  demoObservations: Array<Omit<Observation, "createdAt"> & { createdAt?: string }>;
  benchmark?: BenchmarkCase[];
}

export interface EvidencePoint {
  id: string;
  kind: "official" | "observation";
  price: number;
  weight: number;
  label: string;
  period?: string;
  series?: string;
  sourceUrl?: string;
}

export interface RangeResult {
  mid: number | null;
  low: number | null;
  high: number | null;
  sampleSize: number;
  officialCount: number;
  observationCount: number;
  thin: boolean;
  fallback: "local" | "region" | "national" | "none";
  currency: string;
  points: EvidencePoint[];
  method: string;
}

export interface CodeVerdict {
  label: VerdictLabel;
  range: RangeResult;
  reasonCodes: string[];
}

export interface ServJudgment {
  verdict: VerdictLabel;
  range_low: number | null;
  range_high: number | null;
  unit: string;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  quotes: string[];
  negotiation_tip: string;
  evidence_ids: string[];
  /** Set only when SERV disagrees with the code verdict for a specific reason. Shown as "Ada's note". */
  note?: string | null;
}

export interface StoredVerdict {
  id: string;
  itemId: string;
  areaId: string;
  quote: number;
  currency: string;
  country: string;
  unit: string;
  itemName?: string;
  areaName?: string;
  /** SERV's rough range when there is no local data. Shown as a guess, never used as the band. */
  guess?: { low: number; high: number } | null;
  code: CodeVerdict;
  serv: ServJudgment | null;
  servError?: string;
  final: VerdictLabel;
  tip: string;
  /** SERV's flagged disagreement with the band, if any. Never changes the label. */
  note?: string | null;
  reasons: string[];
  quotes: string[];
  confidence: "low" | "medium" | "high";
  createdAt: string;
  demo: boolean;
  reppoEvalId?: string;
  reppoStatus?: string;
  reppoScore?: number | null;
  reppoRoute?: string | null;
  reppoDecision?: string | null;
  reppoReason?: string | null;
}

export interface FeedbackRecord {
  id: string;
  verdictId: string;
  kind: "paid" | "fair" | "not-fair";
  paid?: number;
  currency?: string;
  createdAt: string;
  deviceHash: string;
}

export interface ReppoRecord {
  evalId: string;
  verdictId: string;
  taskType: "claim" | "response" | "action";
  status: string;
  score: number | null;
  decision: string | null;
  route: string | null;
  reason: string | null;
  creditsCharged: number | null;
  latencyMs?: number | null;
  createdAt: string;
  completedAt?: string;
  lastPolledAt?: string;
  /** How this score changed the trust of the confirmation it scored. */
  trustEffect?: string | null;
}

export interface MetricSnapshot {
  mode: "seed-only" | "after-feedback";
  agreementRate: number;
  cases: number;
  agreed: number;
  mape: number | null;
  medianReppoScore: number | null;
  reppoCount: number;
  computedAt: string;
}
