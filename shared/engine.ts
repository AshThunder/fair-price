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

export const FAIR_BAND = 0.15;
export const MIN_SAMPLES_FOR_CERTAIN = 1;
export const OUTLIER_MULT = 3;
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const NEW_DEVICE_TRUST = 0.45;
export const TRUSTED_DEVICE_TRUST = 0.9;
export const OFFICIAL_BASE_TRUST = 1;
export const MONTHS_UNTIL_OFFICIAL_HALF = 8;

export function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

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
  return areas.find((a) => a.id === areaId);
}

export function fallbackAreaIds(areas: Area[], areaId: string): { local?: string; zone?: string; national?: string } {
  const area = findArea(areas, areaId);
  const national = areas.find((a) => a.kind === "national")?.id;
  if (!area) return { national };
  if (area.kind === "national") return { national: area.id };
  if (area.kind === "zone") return { zone: area.id, national };
  const zone = areas.find((a) => a.kind === "zone" && a.zone === area.zone)?.id;
  return { local: area.id, zone, national };
}


function moreSpecific(a: "local" | "zone" | "national", b: "local" | "zone" | "national"): "local" | "zone" | "national" {
  const order = { local: 0, zone: 1, national: 2 };
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
  const accepted = seedOnly
    ? []
    : observations.filter((o) => {
        if (o.itemId !== itemId) return false;
        if (o.status !== "accepted") return false;
        if (!includeDemo && o.tag === "demo") return false;
        return true;
      });

  const ids = fallbackAreaIds(areas, areaId);
  const officialLevel = (["local", "zone", "national"] as const).find((key) => {
    const area = ids[key];
    return Boolean(area && refs.some((r) => r.itemId === itemId && r.areaId === area));
  });
  const obsLevel = (["local", "zone", "national"] as const).find((key) => {
    const area = ids[key];
    return Boolean(area && accepted.some((o) => o.areaId === area));
  });
  const fallback = officialLevel ?? obsLevel;
  if (fallback) {
    const officialArea = officialLevel ? ids[officialLevel] : undefined;
    const obsArea = obsLevel ? ids[obsLevel] : undefined;
    const localRefs = officialArea
      ? refs.filter((r) => r.itemId === itemId && r.areaId === officialArea)
      : [];
    const localObs = obsArea ? accepted.filter((o) => o.areaId === obsArea) : [];

    const points: EvidencePoint[] = [];
    for (const r of localRefs) {
      const w = OFFICIAL_BASE_TRUST * officialAgeWeight(r.period, asOf);
      points.push({
        id: r.id,
        kind: "official",
        priceNaira: r.priceNaira,
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
        priceNaira: o.priceNaira,
        weight: Math.max(0.1, Math.min(1.2, o.trust)),
        label: o.tag === "demo" ? "Demo confirmation" : "Confirmed payment",
      });
    }

    const mid = weightedMedian(points.map((p) => ({ price: p.priceNaira, weight: p.weight })));
    const prices = points.map((p) => p.priceNaira);
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

    const grain: RangeResult["fallback"] =
      officialLevel && obsLevel
        ? moreSpecific(officialLevel, obsLevel)
        : (fallback as RangeResult["fallback"]);

    return {
      mid,
      low,
      high,
      sampleSize: points.length,
      officialCount: localRefs.length,
      observationCount: localObs.length,
      thin: points.length < 2 && mid != null,
      fallback: grain,
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
  else if (range.fallback === "zone") reasonCodes.push("zone-fallback");
  else if (range.fallback === "national") reasonCodes.push("national-fallback");
  if (range.thin) reasonCodes.push("thin-sample");
  if (range.officialCount > 0) reasonCodes.push("has-official");
  if (range.observationCount > 0) reasonCodes.push("has-confirms");
  if (label === "high") reasonCodes.push("above-band");
  if (label === "low") reasonCodes.push("below-band");
  if (label === "fair") reasonCodes.push("inside-band");
  if (item.category === "repair" || item.category === "rent") {
    if (range.observationCount < 3) reasonCodes.push("needs-local-confirms");
  }
  return { label, range, reasonCodes };
}

export function hardRulesOverride(
  _item: Item,
  quote: number,
  range: RangeResult,
  serv: ServJudgment | null,
): { label: VerdictLabel; reasons: string[] } {
  const reasons: string[] = [];
  if (quote <= 0 || !Number.isFinite(quote)) {
    return { label: "uncertain", reasons: ["The quoted amount is not a usable price."] };
  }
  if (range.mid == null) {
    reasons.push("There is not enough dated evidence for this item in this area yet.");
    return { label: "uncertain", reasons };
  }
  const codeLabel = classifyQuote(quote, range);
  if (!serv) {
    reasons.push("The judgment service is unavailable, so this result uses the local price band only.");
    return { label: codeLabel, reasons };
  }
  // SERV may not invent a number outside the evidence pack. If SERV's verdict
  // disagrees with a well-supported code band, keep the code band and note it.
  const backed = range.officialCount > 0 || range.sampleSize >= 2;
  const disagreement = serv.verdict !== codeLabel && codeLabel !== "uncertain" && backed;
  if (disagreement && (serv.confidence === "low" || range.officialCount > 0 || range.observationCount >= 2)) {
    reasons.push("The local price band was kept because it is backed by dated official anchors or confirmed payments.");
    return { label: codeLabel, reasons };
  }
  return { label: serv.verdict, reasons };
}

export function defaultTip(label: VerdictLabel, item: Item, range: RangeResult, quote: number): string {
  if (label === "uncertain") {
    return `There is not a tight local band for ${item.name} here yet. If you pay, confirm the amount so the next person has a better range.`;
  }
  if (!range.mid || !range.low || !range.high) {
    return "Ask two nearby sellers and keep the lower quote if the goods match.";
  }
  if (label === "high") {
    return `Ask for a price closer to ${naira(range.mid)} per ${item.unit}. Sellers often move when you mention a recent area range of ${naira(range.low)} to ${naira(range.high)}.`;
  }
  if (label === "low") {
    return `The quote is below the recent area range. Check the quantity, quality, and unit before you pay — a ${naira(quote)} price can hide a short measure.`;
  }
  return `This sits inside the recent area range of ${naira(range.low)} to ${naira(range.high)} per ${item.unit}. Still confirm the unit before you pay.`;
}

export function applyAntiGaming(args: {
  itemId: string;
  areaId: string;
  priceNaira: number;
  deviceHash: string;
  now: Date;
  observations: Observation[];
  refs: OfficialRef[];
  areas: Area[];
}): { status: Observation["status"]; trust: number; reason: string } {
  const { itemId, areaId, priceNaira, deviceHash: hash, now, observations, refs, areas } = args;
  const windowStart = now.getTime() - DUPLICATE_WINDOW_MS;
  const sameDeviceRecent = observations.filter(
    (o) => o.deviceHash === hash && o.itemId === itemId && o.areaId === areaId && new Date(o.createdAt).getTime() >= windowStart,
  );
  if (sameDeviceRecent.length > 0) {
    return { status: "rejected", trust: 0, reason: "duplicate-device-window" };
  }

  const deviceHistory = observations.filter((o) => o.deviceHash === hash && o.status === "accepted");
  const trust = deviceHistory.length >= 2 ? TRUSTED_DEVICE_TRUST : NEW_DEVICE_TRUST;

  const range = buildRange(itemId, areaId, refs, observations, areas, now);
  const peers = range.points.map((p) => p.priceNaira);
  if (peers.length > 0 && isOutlier(priceNaira, peers)) {
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
    const v = codeVerdict(item, area, c.quoteNaira, refs, observations, areas, asOf, options);
    if (v.label === c.expected) agreed += 1;
    if (v.range.mid != null && c.trueNaira != null) {
      mapePairs.push({ predicted: v.range.mid, actual: c.trueNaira });
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
