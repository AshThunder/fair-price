export type VerdictLabel = "fair" | "high" | "low" | "uncertain";

export type AreaKind = "national" | "zone" | "state";

export interface Item {
  id: string;
  name: string;
  unit: string;
  category: "food" | "fuel" | "transport" | "repair" | "rent";
  nbsLabel: string | null;
}

export interface Area {
  id: string;
  name: string;
  kind: AreaKind;
  state: string | null;
  zone: string | null;
  country: string;
}

export interface OfficialRef {
  id: string;
  itemId: string;
  areaId: string;
  priceNaira: number;
  grain: "national" | "zone" | "state";
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
  priceNaira: number;
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
  quoteNaira: number;
  expected: VerdictLabel;
  trueNaira: number | null;
  note: string;
}

export interface SeedFile {
  currency: string;
  country: string;
  generated: string;
  disclaimer: string;
  items: Item[];
  areas: Area[];
  officialRefs: OfficialRef[];
  demoObservations: Array<Omit<Observation, "createdAt"> & { createdAt?: string }>;
  benchmark: BenchmarkCase[];
}

export interface EvidencePoint {
  id: string;
  kind: "official" | "observation";
  priceNaira: number;
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
  fallback: "local" | "zone" | "national" | "none";
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
}

export interface StoredVerdict {
  id: string;
  itemId: string;
  areaId: string;
  quoteNaira: number;
  unit: string;
  code: CodeVerdict;
  serv: ServJudgment | null;
  servError?: string;
  final: VerdictLabel;
  tip: string;
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
  paidNaira?: number;
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
  createdAt: string;
  completedAt?: string;
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
