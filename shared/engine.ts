import type {
  Area,
  BenchmarkCase,
  CodeVerdict,
  EvidencePoint,
  Item,
  OfficialRef,
  Observation,
  RangeResult,
  SeedFile,
  ServJudgment,
  VerdictLabel,
} from "./types.js";
import { areaChain, areaFromId, itemUnit, localeFor, money, perUnit } from "./geo.js";

export const FAIR_BAND = 0.15;
export const MIN_SAMPLES_FOR_CERTAIN = 1;
export const OUTLIER_MULT = 3;
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const NEW_DEVICE_TRUST = 0.45;
export const TRUSTED_DEVICE_TRUST = 0.9;
export const OFFICIAL_BASE_TRUST = 1;
export const MONTHS_UNTIL_OFFICIAL_HALF = 8;

/** Naira formatting, kept for older callers. Prefer money(amount, currency). */
export function naira(n: number): string {
  return money(n, "NGN", "en-NG");
}

export { money };

export function monthsBetween(fromIsoDate: string, asOf: Date): number {
  const from = new Date(fromIsoDate + (fromIsoDate.length === 10 ? "T00:00:00Z" : ""));
  const ms = asOf.getTime() - from.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24 * 30.437));
}

export function officialAgeWeight(periodEndIso: string, asOf: Date): number {
  // Mid-month of "YYYY-MM" official period.
  const [y, m] = periodEndIso.split("-").map(Number);
  const mid = new Date(Date.UTC(y, (m ?? 1) - 1, 15));
  const months = monthsBetween(mid.toISOString().slice(0, 10), asOf);
  const w = Math.pow(0.5, months / MONTHS_UNTIL_OFFICIAL_HALF);
  return Math.max(0.25, Math.min(1, w));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function weightedMedian(points: Array<{ price: number; weight: number }>): number | null {
  const clean = points.filter((p) => p.weight > 0 && Number.isFinite(p.price));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  let acc = 0;
  for (const p of sorted) {
    acc += p.weight;
    if (acc >= total / 2) return p.price;
  }
  return sorted[sorted.length - 1].price;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  const t = idx - lo;
  return s[lo] * (1 - t) + s[hi] * t;
}

export function iqrBounds(values: number[]): { lo: number; hi: number } | null {
  if (values.length < 4) return null;
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  if (q1 == null || q3 == null) return null;
  const iqr = q3 - q1;
  if (iqr <= 0) {
    const mid = median(values)!;
    return { lo: mid / OUTLIER_MULT, hi: mid * OUTLIER_MULT };
  }
  return { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr };
}

export function isOutlier(price: number, peers: number[]): boolean {
  if (peers.length === 0) return false;
  const mid = median(peers);
  if (mid == null || mid <= 0) return false;
  if (price <= 0) return true;
  if (price > mid * OUTLIER_MULT || price < mid / OUTLIER_MULT) return true;
  const bounds = iqrBounds(peers);
  if (!bounds) return false;
  return price < bounds.lo || price > bounds.hi;
}

export function deviceHash(raw: string): string {
  // Deterministic, non-cryptographic fingerprint for anti-gaming. Not a secret.
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function findArea(areas: Area[], areaId: string): Area | undefined {
  return areaFromId(areas, areaId);
}

type Level = "local" | "region" | "national";

/** Levels to try, most specific first. Every level is inside the same country. */
export function fallbackLevels(areas: Area[], areaId: string): Array<{ level: Level; areaId: string }> {
  const area = areaFromId(areas, areaId);
  if (!area) return [];
  const chain = areaChain(areas, area);
  return chain.map((a, i) => ({
    level: a.kind === "country" ? "national" : i === 0 ? "local" : "region",
    areaId: a.id,
  }));
}

function moreSpecific(a: Level, b: Level): Level {
  const order = { local: 0, region: 1, national: 2 };
  return order[a] <= order[b] ? a : b;
}

export function buildRange(
  itemId: string,
  areaId: string,
  refs: OfficialRef[],
  observations: Observation[],
  areas: Area[],
  asOf: Date,
  options?: { includeDemo?: boolean; seedOnly?: boolean },
): RangeResult {
  const includeDemo = options?.includeDemo ?? true;
  const seedOnly = options?.seedOnly ?? false;
  const area = areaFromId(areas, areaId);
  const currency = area?.currency ?? "";
  // Prices in another currency are never mixed in, even if an id collides.
  const sameMoney = (c: string | undefined) => (c ?? currency) === currency;
  const itemRefs = refs.filter((r) => r.itemId === itemId && sameMoney(r.currency));
  const accepted = seedOnly
    ? []
    : observations.filter((o) => {
        if (o.itemId !== itemId) return false;
        if (o.status !== "accepted") return false;
        if (!sameMoney(o.currency)) return false;
        if (!includeDemo && o.tag === "demo") return false;
        return true;
      });

  const levels = fallbackLevels(areas, areaId);
  const official = levels.find((l) => itemRefs.some((r) => r.areaId === l.areaId));
  const obs = levels.find((l) => accepted.some((o) => o.areaId === l.areaId));
  const fallback = official ?? obs;
  if (fallback) {
    const localRefs = official ? itemRefs.filter((r) => r.areaId === official.areaId) : [];
    const localObs = obs ? accepted.filter((o) => o.areaId === obs.areaId) : [];

    const points: EvidencePoint[] = [];
    for (const r of localRefs) {
      const w = OFFICIAL_BASE_TRUST * officialAgeWeight(r.period, asOf);
      points.push({
        id: r.id,
        kind: "official",
        price: r.price,
        weight: w,
        label: `${r.series} (${r.period})`,
        period: r.period,
        series: r.series,
        sourceUrl: r.sourceUrl,
      });
    }
    for (const o of localObs) {
      points.push({
        id: o.id,
        kind: "observation",
        price: o.price,
        weight: Math.max(0.1, Math.min(1.2, o.trust)),
        label: o.tag === "demo" ? "Demo confirmation" : "Confirmed payment",
      });
    }

    const mid = weightedMedian(points.map((p) => ({ price: p.price, weight: p.weight })));
    const prices = points.map((p) => p.price);
    let low = percentile(prices, 0.25);
    let high = percentile(prices, 0.75);
    if (mid != null) {
      const floorLow = mid * (1 - FAIR_BAND);
      const floorHigh = mid * (1 + FAIR_BAND);
      if (low == null || high == null || high - low < mid * 0.08) {
        low = floorLow;
        high = floorHigh;
      } else {
        low = Math.min(low, floorLow);
        high = Math.max(high, floorHigh);
      }
    }

    const grain: Level = official && obs ? moreSpecific(official.level, obs.level) : fallback.level;

    return {
      mid,
      low,
      high,
      sampleSize: points.length,
      officialCount: localRefs.length,
      observationCount: localObs.length,
      thin: points.length < 2 && mid != null,
      fallback: grain,
      currency,
      points,
      method: "weighted-median with at least a 15 percent band",
    };
  }

  return {
    mid: null,
    low: null,
    high: null,
    sampleSize: 0,
    officialCount: 0,
    observationCount: 0,
    thin: true,
    fallback: "none",
    currency,
    points: [],
    method: "no evidence",
  };
}

export function classifyQuote(quote: number, range: RangeResult): VerdictLabel {
  if (range.mid == null || range.low == null || range.high == null) return "uncertain";
  if (range.sampleSize < MIN_SAMPLES_FOR_CERTAIN) return "uncertain";
  if (quote > range.high) return "high";
  if (quote < range.low) return "low";
  return "fair";
}

export function codeVerdict(
  item: Item,
  area: Area,
  quote: number,
  refs: OfficialRef[],
  observations: Observation[],
  areas: Area[],
  asOf: Date,
  options?: { includeDemo?: boolean; seedOnly?: boolean },
): CodeVerdict {
  const range = buildRange(item.id, area.id, refs, observations, areas, asOf, options);
  const label = classifyQuote(quote, range);
  const reasonCodes: string[] = [];
  if (range.fallback === "none") reasonCodes.push("no-evidence");
  else if (range.fallback === "region") reasonCodes.push("region-fallback");
  else if (range.fallback === "national") reasonCodes.push("national-fallback");
  if (range.thin) reasonCodes.push("thin-sample");
  if (range.officialCount > 0) reasonCodes.push("has-official");
  if (range.observationCount > 0) reasonCodes.push("has-confirms");
  if (label === "high") reasonCodes.push("above-band");
  if (label === "low") reasonCodes.push("below-band");
  if (label === "fair") reasonCodes.push("inside-band");
  if (item.category === "repair" || item.category === "rent" || item.custom) {
    if (range.observationCount < 3) reasonCodes.push("needs-local-confirms");
  }
  return { label, range, reasonCodes };
}

export interface Reconciled {
  label: VerdictLabel;
  reasons: string[];
  /** True when SERV's reasons and tip agree with the final label and can be shown. */
  useServText: boolean;
  /** SERV's specific disagreement, shown as "Ada's note". */
  note: string | null;
}

function cleanNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const t = note.replace(/\s+/g, " ").trim();
  if (t.length < 12 || /^(none|null|n\/a|no note)\.?$/i.test(t)) return null;
  return t.length > 220 ? `${t.slice(0, 217).trimEnd()}...` : t;
}

/**
 * The code band is authoritative: the label always comes from where the quote sits
 * in the computed range, so the stamp, the range bar, and the text agree. SERV explains
 * and writes the tip. When SERV's verdict differs, its reasons and tip are dropped and
 * any specific reason it gave is kept only as a note.
 */
export function reconcileVerdict(quote: number, range: RangeResult, serv: ServJudgment | null): Reconciled {
  if (quote <= 0 || !Number.isFinite(quote)) {
    return { label: "uncertain", reasons: ["The quoted amount is not a usable price."], useServText: false, note: null };
  }
  const label: VerdictLabel = range.mid == null ? "uncertain" : classifyQuote(quote, range);
  const reasons: string[] = [];
  if (range.mid == null) reasons.push("There is not enough dated evidence for this item in this area yet.");
  if (!serv) {
    if (range.mid != null) reasons.push("The judgment service is unavailable, so this result uses the local price band only.");
    return { label, reasons, useServText: false, note: null };
  }
  const agrees = serv.verdict === label;
  const note = cleanNote(serv.note);
  return { label, reasons, useServText: agrees, note: agrees ? null : note };
}

/** Kept for older callers: the label from reconcileVerdict. */
export function hardRulesOverride(
  _item: Item,
  quote: number,
  range: RangeResult,
  serv: ServJudgment | null,
): { label: VerdictLabel; reasons: string[] } {
  const r = reconcileVerdict(quote, range, serv);
  return { label: r.label, reasons: r.reasons };
}

export function defaultTip(label: VerdictLabel, item: Item, range: RangeResult, quote: number, country?: string): string {
  const cur = range.currency || "NGN";
  const m = (n: number) => money(n, cur, country ? localeFor(country) : undefined);
  const unit = country ? itemUnit(item, country) : item.unit;
  if (label === "uncertain") {
    return `There is no local range for ${item.name.toLowerCase()} here yet. Ask two nearby sellers, and if you pay, confirm the amount so the next person gets a real range.`;
  }
  if (!range.mid || !range.low || !range.high) {
    return "Ask two nearby sellers and keep the lower quote if the goods match.";
  }
  if (label === "high") {
    return `Ask for a price closer to ${m(range.mid)} ${perUnit(unit)}. Sellers often move when you mention a recent range of ${m(range.low)} to ${m(range.high)}.`;
  }
  if (label === "low") {
    return `The quote is below the recent range. Check the quantity, quality, and unit before you pay. A ${m(quote)} price can hide a short measure.`;
  }
  return `This sits inside the recent range of ${m(range.low)} to ${m(range.high)} ${perUnit(unit)}. Still confirm the unit before you pay.`;
}

export interface DeviceStats {
  accepted: number;
  quarantined: number;
  rejected: number;
}

/**
 * Trust for a device's next confirmation. New devices start at 0.45, each
 * accepted confirmation adds 0.15 up to 0.9, and quarantined or duplicate
 * submissions pull trust down so a gaming device fades out of the range.
 */
export function deviceTrust(stats: DeviceStats): number {
  const raw = NEW_DEVICE_TRUST + 0.15 * stats.accepted - 0.2 * stats.quarantined - 0.05 * stats.rejected;
  return Math.round(Math.max(0.1, Math.min(TRUSTED_DEVICE_TRUST, raw)) * 100) / 100;
}

export function applyAntiGaming(args: {
  itemId: string;
  areaId: string;
  price: number;
  deviceHash: string;
  now: Date;
  observations: Observation[];
  refs: OfficialRef[];
  areas: Area[];
  /** Device history from the store; when given it sets trust instead of the observation scan. */
  device?: DeviceStats;
}): { status: Observation["status"]; trust: number; reason: string } {
  const { itemId, areaId, price, deviceHash: hash, now, observations, refs, areas } = args;
  if (!(price > 0) || !Number.isFinite(price)) {
    return { status: "rejected", trust: 0, reason: "invalid-price" };
  }
  const windowStart = now.getTime() - DUPLICATE_WINDOW_MS;
  const sameDeviceRecent = observations.filter(
    (o) => o.deviceHash === hash && o.itemId === itemId && o.areaId === areaId && new Date(o.createdAt).getTime() >= windowStart,
  );
  if (sameDeviceRecent.length > 0) {
    return { status: "rejected", trust: 0, reason: "duplicate-device-window" };
  }

  const trust = args.device
    ? deviceTrust(args.device)
    : observations.filter((o) => o.deviceHash === hash && o.status === "accepted").length >= 2
      ? TRUSTED_DEVICE_TRUST
      : NEW_DEVICE_TRUST;

  const range = buildRange(itemId, areaId, refs, observations, areas, now);
  const peers = range.points.map((p) => p.price);
  if (peers.length > 0 && isOutlier(price, peers)) {
    return { status: "quarantine", trust: Math.min(0.2, trust), reason: "outlier" };
  }
  return { status: "accepted", trust, reason: "ok" };
}

export function mape(pairs: Array<{ predicted: number; actual: number }>): number | null {
  const clean = pairs.filter((p) => p.actual !== 0 && Number.isFinite(p.predicted) && Number.isFinite(p.actual));
  if (clean.length === 0) return null;
  const sum = clean.reduce((s, p) => s + Math.abs((p.predicted - p.actual) / p.actual), 0);
  return sum / clean.length;
}

export function scoreBenchmark(
  cases: BenchmarkCase[],
  items: Item[],
  areas: Area[],
  refs: OfficialRef[],
  observations: Observation[],
  asOf: Date,
  options?: { includeDemo?: boolean; seedOnly?: boolean },
): { agreementRate: number; agreed: number; cases: number; mape: number | null; details: Array<{ id: string; predicted: VerdictLabel; expected: VerdictLabel; mid: number | null }> } {
  let agreed = 0;
  const mapePairs: Array<{ predicted: number; actual: number }> = [];
  const details: Array<{ id: string; predicted: VerdictLabel; expected: VerdictLabel; mid: number | null }> = [];
  for (const c of cases) {
    const item = items.find((i) => i.id === c.itemId);
    const area = areas.find((a) => a.id === c.areaId);
    if (!item || !area) continue;
    const v = codeVerdict(item, area, c.quote, refs, observations, areas, asOf, options);
    if (v.label === c.expected) agreed += 1;
    if (v.range.mid != null && c.trueAmount != null) {
      mapePairs.push({ predicted: v.range.mid, actual: c.trueAmount });
    }
    details.push({ id: c.id, predicted: v.label, expected: c.expected, mid: v.range.mid });
  }
  return {
    agreementRate: cases.length ? agreed / cases.length : 0,
    agreed,
    cases: cases.length,
    mape: mape(mapePairs),
    details,
  };
}

export function loadSeed(raw: SeedFile): SeedFile {
  return raw;
}
