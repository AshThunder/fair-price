import {
  applyAntiGaming,
  codeVerdict,
  deviceHash,
  mape,
} from "./engine.js";
import { areaFromId } from "./geo.js";
import type { Area, BenchmarkCase, BenchmarkFile, Item, Observation, OfficialRef, VerdictLabel } from "./types.js";

/** Deterministic PRNG so every run of the benchmark sees the same feedback stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FeedbackSimOptions {
  seed: number;
  /** Share of item and area pairs that receive any confirmations. */
  coverage: number;
  /** Honest confirmations per covered pair, inclusive range. */
  minConfirms: number;
  maxConfirms: number;
  /** Honest payers scatter uniformly within +/- this share of the reference. */
  scatter: number;
  /** Payers tend to pay slightly above the reference. */
  bias: number;
  /** Chance that a covered pair also gets a wild outlier from a new device. */
  outlierRate: number;
  /** Chance that one honest device tries to confirm twice within 24 hours. */
  duplicateRate: number;
}

export const DEFAULT_FEEDBACK_SIM: FeedbackSimOptions = {
  seed: 2026,
  coverage: 0.75,
  minConfirms: 2,
  maxConfirms: 5,
  scatter: 0.12,
  bias: 0.02,
  outlierRate: 0.3,
  duplicateRate: 0.3,
};

function roundLikeTrader(n: number, currency = "NGN"): number {
  // Other currencies: keep three significant figures, so $4.48 or ₹102 stay realistic.
  if (currency !== "NGN") return Number(n.toPrecision(3));
  if (n < 2000) return Math.round(n / 10) * 10;
  if (n < 20000) return Math.round(n / 50) * 50;
  return Math.round(n / 250) * 250;
}

export interface SimulatedFeedback {
  observations: Observation[];
  stats: { pairs: number; coveredPairs: number; submitted: number; accepted: number; quarantined: number; rejected: number };
}

/**
 * Generate paid confirmations from each pair's reference price (never from the
 * quotes or labels) and push each one through the real anti-gaming gate.
 */
export function simulateFeedback(
  bench: Pick<BenchmarkFile, "truths">,
  refs: OfficialRef[],
  areas: Area[],
  asOf: Date,
  opts: FeedbackSimOptions = DEFAULT_FEEDBACK_SIM,
): SimulatedFeedback {
  const rand = mulberry32(opts.seed);
  const observations: Observation[] = [];
  const stats = { pairs: bench.truths.length, coveredPairs: 0, submitted: 0, accepted: 0, quarantined: 0, rejected: 0 };
  let clock = asOf.getTime() - 14 * 24 * 3600_000;
  let deviceCounter = 0;

  const submit = (itemId: string, areaId: string, price: number, device: string, currency: string) => {
    clock += 3 * 3600_000;
    const now = new Date(clock);
    const gate = applyAntiGaming({
      itemId,
      areaId,
      price: price,
      deviceHash: device,
      now,
      observations,
      refs,
      areas,
    });
    stats.submitted += 1;
    if (gate.status === "accepted") stats.accepted += 1;
    else if (gate.status === "quarantine") stats.quarantined += 1;
    else stats.rejected += 1;
    observations.push({
      id: `sim-${observations.length + 1}`,
      itemId,
      areaId,
      price: price,
      currency,
      source: "typed",
      status: gate.status,
      trust: gate.trust,
      deviceHash: device,
      createdAt: now.toISOString(),
      tag: "live",
      note: gate.reason,
    });
  };

  for (const t of bench.truths) {
    if (rand() >= opts.coverage) continue;
    const cur = t.currency ?? areaFromId(areas, t.areaId)?.currency ?? "NGN";
    stats.coveredPairs += 1;
    const n = opts.minConfirms + Math.floor(rand() * (opts.maxConfirms - opts.minConfirms + 1));
    const devices: string[] = [];
    for (let i = 0; i < n; i++) {
      const device = deviceHash(`sim-device-${++deviceCounter}`);
      devices.push(device);
      const u = (rand() * 2 - 1) * opts.scatter;
      submit(t.itemId, t.areaId, roundLikeTrader(t.truthAmount * (1 + opts.bias + u), cur), device, cur);
    }
    if (rand() < opts.duplicateRate) {
      // Same device, same pair, within the window: must be rejected.
      submit(t.itemId, t.areaId, roundLikeTrader(t.truthAmount * 1.05, cur), devices[0], cur);
    }
    if (rand() < opts.outlierRate) {
      submit(t.itemId, t.areaId, roundLikeTrader(t.truthAmount * 3.5, cur), deviceHash(`sim-device-${++deviceCounter}`), cur);
    }
  }
  return { observations, stats };
}

export interface ScoreBlock {
  cases: number;
  correct: number;
  accuracy: number;
  answered: number;
  coverage: number;
  answeredAccuracy: number | null;
  mape: number | null;
}

export interface CaseResult {
  id: string;
  itemId: string;
  areaId: string;
  country: string;
  currency: string;
  kind: "cross-source" | "control";
  category: string;
  split: "dev" | "test";
  quote: number;
  expected: VerdictLabel;
  trueAmount: number | null;
  seedOnly: { label: VerdictLabel; mid: number | null };
  afterFeedback: { label: VerdictLabel; mid: number | null };
  note: string;
}

function score(results: CaseResult[], mode: "seedOnly" | "afterFeedback"): ScoreBlock {
  const correct = results.filter((r) => r[mode].label === r.expected).length;
  const answered = results.filter((r) => r[mode].label !== "uncertain");
  const answeredCorrect = answered.filter((r) => r[mode].label === r.expected).length;
  const pairs = results
    .filter((r) => r[mode].mid != null && r.trueAmount != null)
    .map((r) => ({ predicted: r[mode].mid as number, actual: r.trueAmount as number }));
  return {
    cases: results.length,
    correct,
    accuracy: results.length ? correct / results.length : 0,
    answered: answered.length,
    coverage: results.length ? answered.length / results.length : 0,
    answeredAccuracy: answered.length ? answeredCorrect / answered.length : null,
    mape: mape(pairs),
  };
}

export interface BenchmarkReport {
  version: string;
  asOf: string;
  totalCases: number;
  splits: Record<"dev" | "test" | "all", { seedOnly: ScoreBlock; afterFeedback: ScoreBlock }>;
  byCategory: Record<string, { seedOnly: ScoreBlock; afterFeedback: ScoreBlock }>;
  /** Per country, with how many cases are cross-source versus control. */
  byCountry: Record<string, { seedOnly: ScoreBlock; afterFeedback: ScoreBlock; testSeedOnly: ScoreBlock; testAfterFeedback: ScoreBlock; currency: string; crossSource: number; control: number }>;
  feedback: SimulatedFeedback["stats"] & { options: FeedbackSimOptions };
  results: CaseResult[];
  labelRule: string;
  method: string[];
  sources: BenchmarkFile["sources"];
}

export function runBenchmark(
  bench: BenchmarkFile,
  items: Item[],
  areas: Area[],
  refs: OfficialRef[],
  opts: FeedbackSimOptions = DEFAULT_FEEDBACK_SIM,
): BenchmarkReport {
  const asOf = new Date(`${bench.asOf}T12:00:00Z`);
  const sim = simulateFeedback(bench, refs, areas, asOf, opts);
  const results: CaseResult[] = [];
  for (const c of bench.cases as BenchmarkCase[]) {
    const item = items.find((i) => i.id === c.itemId);
    const area = areaFromId(areas, c.areaId);
    if (!item || !area) continue;
    const country = area.country;
    const seedV = codeVerdict(item, area, c.quote, refs, [], areas, asOf, { seedOnly: true });
    const afterV = codeVerdict(item, area, c.quote, refs, sim.observations, areas, asOf, { includeDemo: false });
    results.push({
      id: c.id,
      itemId: c.itemId,
      areaId: c.areaId,
      country,
      currency: area.currency,
      kind: c.kind ?? "cross-source",
      category: c.category ?? item.category,
      split: c.split ?? "test",
      quote: c.quote,
      expected: c.expected,
      trueAmount: c.trueAmount,
      seedOnly: { label: seedV.label, mid: seedV.range.mid },
      afterFeedback: { label: afterV.label, mid: afterV.range.mid },
      note: c.note,
    });
  }
  const block = (rs: CaseResult[]) => ({ seedOnly: score(rs, "seedOnly"), afterFeedback: score(rs, "afterFeedback") });
  const categories = [...new Set(results.map((r) => r.category))];
  const countries = [...new Set(results.map((r) => r.country))];
  const countryBlock = (cc: string) => {
    const rs = results.filter((r) => r.country === cc);
    const test = rs.filter((r) => r.split === "test");
    return {
      ...block(rs),
      testSeedOnly: score(test, "seedOnly"),
      testAfterFeedback: score(test, "afterFeedback"),
      currency: rs[0]?.currency ?? "",
      crossSource: rs.filter((r) => r.kind === "cross-source").length,
      control: rs.filter((r) => r.kind === "control").length,
    };
  };
  return {
    version: bench.version,
    asOf: bench.asOf,
    totalCases: results.length,
    splits: {
      dev: block(results.filter((r) => r.split === "dev")),
      test: block(results.filter((r) => r.split === "test")),
      all: block(results),
    },
    byCategory: Object.fromEntries(categories.map((cat) => [cat, block(results.filter((r) => r.category === cat))])),
    byCountry: Object.fromEntries(countries.map((cc) => [cc, countryBlock(cc)])),
    feedback: { ...sim.stats, options: opts },
    results,
    labelRule: bench.labelRule,
    method: bench.method,
    sources: bench.sources,
  };
}
