import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyAntiGaming,
  buildRange,
  classifyQuote,
  codeVerdict,
  deviceHash,
  hardRulesOverride,
  reconcileVerdict,
  isOutlier,
  median,
  naira,
  officialAgeWeight,
  scoreBenchmark,
  weightedMedian,
} from "../shared/engine.js";
import { evidencePackText, sanitizeForEval } from "../shared/sanitize.js";
import type { Observation, SeedFile } from "../shared/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(readFileSync(join(root, "data/seed.json"), "utf8")) as SeedFile;
const asOf = new Date("2026-11-12T15:00:00Z");

function demos(): Observation[] {
  return seed.demoObservations.map((o, i) => ({
    ...o,
    createdAt: o.createdAt ?? `2026-11-01T0${i}:00:00Z`,
  }));
}

describe("naira and stats", () => {
  it("formats naira without a currency word", () => {
    expect(naira(1905.43)).toBe("₦1,905");
  });

  it("computes median and weighted median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(weightedMedian([
      { price: 10, weight: 1 },
      { price: 20, weight: 3 },
    ])).toBe(20);
  });

  it("ages May 2026 official weights below 1 by November 2026", () => {
    const w = officialAgeWeight("2026-05", asOf);
    expect(w).toBeGreaterThan(0.4);
    expect(w).toBeLessThan(0.8);
  });
});

describe("range and verdicts against May 2026 anchors", () => {
  const rice = seed.items.find((i) => i.id === "rice-local")!;
  const national = seed.areas.find((a) => a.id === "NG")!;

  it("calls the national rice average fair", () => {
    const v = codeVerdict(rice, national, 1905.43, seed.officialRefs, [], seed.areas, asOf, {
      seedOnly: true,
    });
    expect(v.label).toBe("fair");
    expect(v.range.mid).toBeCloseTo(1905.43, 1);
    expect(v.range.fallback).toBe("national");
  });

  it("calls 3200 naira rice high and 900 naira rice low", () => {
    const high = codeVerdict(rice, national, 3200, seed.officialRefs, [], seed.areas, asOf, {
      seedOnly: true,
    });
    const low = codeVerdict(rice, national, 900, seed.officialRefs, [], seed.areas, asOf, {
      seedOnly: true,
    });
    expect(high.label).toBe("high");
    expect(low.label).toBe("low");
  });

  it("uses the Kano state PMS figure, not the national average", () => {
    const pms = seed.items.find((i) => i.id === "pms")!;
    const kano = seed.areas.find((a) => a.id === "NG-KANO")!;
    const v = codeVerdict(pms, kano, 1607.27, seed.officialRefs, [], seed.areas, asOf, {
      seedOnly: true,
    });
    expect(v.range.fallback).toBe("local");
    expect(v.range.mid).toBeCloseTo(1607.27, 1);
    expect(v.label).toBe("fair");
  });

  it("falls back to the North-West tomato average for Kano with no confirms", () => {
    const tomatoes = seed.items.find((i) => i.id === "tomatoes")!;
    const kano = seed.areas.find((a) => a.id === "NG-KANO")!;
    const range = buildRange("tomatoes", "NG-KANO", seed.officialRefs, [], seed.areas, asOf, {
      seedOnly: true,
    });
    expect(range.fallback).toBe("zone");
    expect(range.mid).toBeCloseTo(1182.39, 1);
    expect(classifyQuote(1400, range)).toBe("high");
    const after = codeVerdict(tomatoes, kano, 1400, seed.officialRefs, demos(), seed.areas, asOf);
    expect(after.label).toBe("fair");
    expect(after.range.observationCount).toBe(3);
  });

  it("returns uncertain for phone-screen with no official or local confirms", () => {
    const phone = seed.items.find((i) => i.id === "phone-screen")!;
    const enugu = seed.areas.find((a) => a.id === "NG-ENUGU")!;
    const v = codeVerdict(phone, enugu, 25000, seed.officialRefs, [], seed.areas, asOf);
    expect(v.label).toBe("uncertain");
    expect(v.reasonCodes).toContain("no-evidence");
  });
});

describe("demo confirms move the tomato range", () => {
  it("calls Kano tomatoes at 1400 high on the seed and fair after demo confirms", () => {
    const item = seed.items.find((i) => i.id === "tomatoes")!;
    const area = seed.areas.find((a) => a.id === "NG-KANO")!;
    const before = codeVerdict(item, area, 1400, seed.officialRefs, demos(), seed.areas, asOf, { seedOnly: true });
    const after = codeVerdict(item, area, 1400, seed.officialRefs, demos(), seed.areas, asOf, { includeDemo: true });
    expect(before.label).toBe("high");
    expect(after.label).toBe("fair");
  });

  it("legacy scoreBenchmark still scores a small case list", () => {
    const cases = [
      { id: "a", itemId: "rice-local", areaId: "NG", quoteNaira: 1905.43, expected: "fair" as const, trueNaira: 1905.43, note: "" },
      { id: "b", itemId: "rice-local", areaId: "NG", quoteNaira: 3200, expected: "high" as const, trueNaira: 1905.43, note: "" },
    ];
    const r = scoreBenchmark(cases, seed.items, seed.areas, seed.officialRefs, [], asOf, { seedOnly: true });
    expect(r.agreed).toBe(2);
  });
});


describe("anti-gaming", () => {
  it("flags prices far from the peer band as outliers", () => {
    expect(isOutlier(20_000, [1900, 1910, 1890, 1920])).toBe(true);
    expect(isOutlier(1915, [1900, 1910, 1890, 1920])).toBe(false);
  });

  it("rejects a second confirm from the same device in the window", () => {
    const first: Observation = {
      id: "o1",
      itemId: "rice-local",
      areaId: "NG",
      priceNaira: 1900,
      source: "typed",
      status: "accepted",
      trust: 0.45,
      deviceHash: "abcd",
      createdAt: "2026-11-12T10:00:00Z",
      tag: "live",
    };
    const again = applyAntiGaming({
      itemId: "rice-local",
      areaId: "NG",
      priceNaira: 1910,
      deviceHash: "abcd",
      now: new Date("2026-11-12T12:00:00Z"),
      observations: [first],
      refs: seed.officialRefs,
      areas: seed.areas,
    });
    expect(again.status).toBe("rejected");
    expect(again.reason).toBe("duplicate-device-window");
  });

  it("quarantines a wild outlier from a new device", () => {
    const result = applyAntiGaming({
      itemId: "rice-local",
      areaId: "NG",
      priceNaira: 50_000,
      deviceHash: "newdev",
      now: asOf,
      observations: [],
      refs: seed.officialRefs,
      areas: seed.areas,
    });
    expect(result.status).toBe("quarantine");
  });

  it("hashes device ids stably", () => {
    expect(deviceHash("phone-a")).toBe(deviceHash("phone-a"));
    expect(deviceHash("phone-a")).not.toBe(deviceHash("phone-b"));
  });
});

describe("hard rules", () => {
  it("keeps the code band when SERV disagrees with a backed range", () => {
    const rice = seed.items.find((i) => i.id === "rice-local")!;
    const range = buildRange("rice-local", "NG", seed.officialRefs, [], seed.areas, asOf, {
      seedOnly: true,
    });
    const overruled = hardRulesOverride(rice, 3200, range, {
      verdict: "fair",
      range_low: range.low,
      range_high: range.high,
      unit: rice.unit,
      confidence: "low",
      reasons: ["Invented"],
      quotes: [],
      negotiation_tip: "None",
      evidence_ids: [],
    });
    expect(overruled.label).toBe("high");
  });

  it("returns uncertain when the quote is not a number", () => {
    const rice = seed.items.find((i) => i.id === "rice-local")!;
    const range = buildRange("rice-local", "NG", seed.officialRefs, [], seed.areas, asOf);
    expect(hardRulesOverride(rice, -3, range, null).label).toBe("uncertain");
  });
});

describe("reconcileVerdict", () => {
  const rice = seed.items.find((i) => i.id === "rice-local")!;
  const range = buildRange("rice-local", "NG", seed.officialRefs, [], seed.areas, asOf, { seedOnly: true });
  const serv = (verdict: "fair" | "high" | "low" | "uncertain", note: string | null = null) => ({
    verdict,
    range_low: range.low,
    range_high: range.high,
    unit: rice.unit,
    confidence: "high" as const,
    reasons: ["From SERV"],
    quotes: [],
    negotiation_tip: "SERV tip",
    evidence_ids: [],
    note,
  });

  it("always takes the label from where the quote sits in the band", () => {
    for (const quote of [range.low! * 0.5, range.mid!, range.high! * 1.5]) {
      for (const v of ["fair", "high", "low", "uncertain"] as const) {
        expect(reconcileVerdict(quote, range, serv(v)).label).toBe(classifyQuote(quote, range));
      }
    }
  });

  it("uses SERV text only when SERV agrees", () => {
    const agree = reconcileVerdict(range.mid!, range, serv("fair"));
    expect(agree).toMatchObject({ label: "fair", useServText: true, note: null });
    const disagree = reconcileVerdict(range.mid!, range, serv("high"));
    expect(disagree).toMatchObject({ label: "fair", useServText: false, note: null });
  });

  it("keeps a specific SERV disagreement as a note without changing the label", () => {
    const r = reconcileVerdict(range.mid!, range, serv("high", "The only anchor is five months old and prices rose since."));
    expect(r.label).toBe("fair");
    expect(r.note).toMatch(/five months old/);
    expect(reconcileVerdict(range.mid!, range, serv("high", "none")).note).toBeNull();
  });

  it("is uncertain with no band, whatever SERV says", () => {
    const empty = buildRange("phone-screen", "NG-ABUJA", seed.officialRefs, [], seed.areas, asOf);
    expect(empty.mid).toBeNull();
    expect(reconcileVerdict(25000, empty, serv("fair")).label).toBe("uncertain");
  });
});

describe("sanitize", () => {
  it("strips emails and numbers that look like phone numbers", () => {
    const out = sanitizeForEval("Call 08012345678 or me@example.com about 1900 naira rice.");
    expect(out).not.toMatch(/08012345678/);
    expect(out).not.toMatch(/me@example.com/);
    expect(out).toMatch(/1900 naira rice/);
  });

  it("builds a pack without photos or names", () => {
    const pack = evidencePackText({
      itemName: "Local short-grained rice",
      areaName: "Nigeria (national)",
      unit: "1 kg",
      quoteNaira: 1905,
      mid: 1905,
      low: 1620,
      high: 2190,
      fallback: "national",
      points: [
        { id: "ref-rice-local-NG", kind: "official", priceNaira: 1905.43, label: "Food Price Watch", period: "2026-05" },
      ],
      reasons: ["inside-band"],
      verdict: "fair",
      tip: "Confirm the unit before you pay.",
    });
    expect(pack).toContain("1905.43");
    expect(pack).not.toMatch(/@|080\d{8}|GPS coordinates/i);
  });
});

describe("device trust", () => {
  it("starts new devices low, rewards accepted confirms, and penalises quarantines", async () => {
    const { deviceTrust } = await import("../shared/engine.js");
    expect(deviceTrust({ accepted: 0, quarantined: 0, rejected: 0 })).toBe(0.45);
    expect(deviceTrust({ accepted: 2, quarantined: 0, rejected: 0 })).toBe(0.75);
    expect(deviceTrust({ accepted: 10, quarantined: 0, rejected: 0 })).toBe(0.9);
    expect(deviceTrust({ accepted: 0, quarantined: 3, rejected: 0 })).toBe(0.1);
    expect(deviceTrust({ accepted: 1, quarantined: 1, rejected: 2 })).toBeCloseTo(0.3, 5);
  });

  it("uses stored device stats for trust when given", () => {
    const r = applyAntiGaming({
      itemId: "garri-white",
      areaId: "NG-OYO",
      priceNaira: 820,
      deviceHash: deviceHash("trusted"),
      now: asOf,
      observations: [],
      refs: seed.officialRefs,
      areas: seed.areas,
      device: { accepted: 3, quarantined: 0, rejected: 0 },
    });
    expect(r.status).toBe("accepted");
    expect(r.trust).toBe(0.9);
  });

  it("rejects a non-positive price", () => {
    const r = applyAntiGaming({
      itemId: "garri-white",
      areaId: "NG-OYO",
      priceNaira: 0,
      deviceHash: "x",
      now: asOf,
      observations: [],
      refs: seed.officialRefs,
      areas: seed.areas,
    });
    expect(r.status).toBe("rejected");
  });
});

describe("stale anchors and fallback", () => {
  it("falls back to the national cooking gas anchor for Oyo and the zone anchor for Kano", () => {
    const item = seed.items.find((i) => i.id === "lpg-12kg")!;
    const oyo = seed.areas.find((a) => a.id === "NG-OYO")!;
    const kano = seed.areas.find((a) => a.id === "NG-KANO")!;
    const o = codeVerdict(item, oyo, 22000, seed.officialRefs, [], seed.areas, asOf, { seedOnly: true });
    const k = codeVerdict(item, kano, 22000, seed.officialRefs, [], seed.areas, asOf, { seedOnly: true });
    expect(o.range.fallback).toBe("national");
    expect(k.range.fallback).toBe("zone");
    expect(k.range.mid).toBeCloseTo(23276.95, 1);
  });

  it("lets a cluster of fresh confirmations outweigh one months-old anchor", () => {
    const item = seed.items.find((i) => i.id === "pms")!;
    const kano = seed.areas.find((a) => a.id === "NG-KANO")!;
    const obs: Observation[] = [1410, 1420, 1430].map((p, i) => ({
      id: `o${i}`,
      itemId: "pms",
      areaId: "NG-KANO",
      priceNaira: p,
      source: "typed",
      status: "accepted",
      trust: 0.45,
      deviceHash: `d${i}`,
      createdAt: "2026-11-10T10:00:00Z",
      tag: "live",
    }));
    const seedOnly = codeVerdict(item, kano, 1300, seed.officialRefs, obs, seed.areas, asOf, { seedOnly: true });
    const after = codeVerdict(item, kano, 1300, seed.officialRefs, obs, seed.areas, asOf, { includeDemo: false });
    expect(seedOnly.label).toBe("low");
    expect(after.label).toBe("fair");
    expect(after.range.mid).toBe(1430);
  });

  it("ignores quarantined and rejected confirmations when building a range", () => {
    const item = seed.items.find((i) => i.id === "barbing")!;
    const abuja = seed.areas.find((a) => a.id === "NG-ABUJA")!;
    const bad: Observation[] = [
      { id: "q", itemId: "barbing", areaId: "NG-ABUJA", priceNaira: 9000, source: "typed", status: "quarantine", trust: 0.2, deviceHash: "a", createdAt: "2026-11-10T10:00:00Z" },
      { id: "r", itemId: "barbing", areaId: "NG-ABUJA", priceNaira: 1500, source: "typed", status: "rejected", trust: 0, deviceHash: "b", createdAt: "2026-11-10T10:00:00Z" },
    ];
    const v = codeVerdict(item, abuja, 1500, seed.officialRefs, bad, seed.areas, asOf);
    expect(v.label).toBe("uncertain");
    expect(v.range.sampleSize).toBe(0);
  });
});
