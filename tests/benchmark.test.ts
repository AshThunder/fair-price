import { describe, expect, it } from "vitest";
import benchmark from "../data/benchmark.json" with { type: "json" };
import seedJson from "../data/seed.json" with { type: "json" };
import { DEFAULT_FEEDBACK_SIM, mulberry32, runBenchmark, simulateFeedback } from "../shared/benchmark.js";
import type { BenchmarkFile, SeedFile } from "../shared/types.js";

const bench = benchmark as unknown as BenchmarkFile;
const seed = seedJson as unknown as SeedFile;

describe("benchmark file", () => {
  it("has at least 60 cases across every category, several states, and both splits", () => {
    expect(bench.cases.length).toBeGreaterThanOrEqual(60);
    const cats = new Set(bench.cases.map((c) => c.category));
    for (const cat of ["food", "fuel", "transport", "repair", "rent", "service"]) expect(cats.has(cat as never)).toBe(true);
    expect(new Set(bench.cases.map((c) => c.areaId)).size).toBeGreaterThanOrEqual(6);
    const test = bench.cases.filter((c) => c.split === "test").length;
    const dev = bench.cases.filter((c) => c.split === "dev").length;
    expect(test).toBeGreaterThan(dev);
    expect(dev).toBeGreaterThan(10);
  });

  it("labels every case by the fixed 15% rule against its reference, not by the engine", () => {
    for (const c of bench.cases) {
      const r = c.quoteNaira / (c.trueNaira as number);
      const expected = r > 1.15 ? "high" : r < 0.85 ? "low" : "fair";
      expect(c.expected, c.id).toBe(expected);
      expect(bench.sources.some((s) => s.id === c.truthSource), c.id).toBe(true);
    }
  });

  it("cites a URL for every source", () => {
    for (const s of bench.sources) expect(s.url).toMatch(/^https:\/\//);
  });
});

describe("feedback simulation", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const asOf = new Date("2026-11-12T12:00:00Z");
    const s1 = simulateFeedback(bench, seed.officialRefs, seed.areas, asOf);
    const s2 = simulateFeedback(bench, seed.officialRefs, seed.areas, asOf);
    expect(s1.stats).toEqual(s2.stats);
  });

  it("rejects every planted duplicate and quarantines planted outliers", () => {
    const asOf = new Date("2026-11-12T12:00:00Z");
    const sim = simulateFeedback(bench, seed.officialRefs, seed.areas, asOf, { ...DEFAULT_FEEDBACK_SIM, duplicateRate: 1, outlierRate: 1 });
    expect(sim.stats.rejected).toBe(sim.stats.coveredPairs);
    expect(sim.stats.quarantined).toBeGreaterThanOrEqual(Math.floor(sim.stats.coveredPairs * 0.9));
  });
});

describe("benchmark report", () => {
  const report = runBenchmark(bench, seed.items, seed.areas, seed.officialRefs);

  it("improves the held-out test split after feedback", () => {
    const t = report.splits.test;
    expect(t.afterFeedback.accuracy).toBeGreaterThan(t.seedOnly.accuracy);
    expect(t.afterFeedback.coverage).toBeGreaterThan(t.seedOnly.coverage);
  });

  it("gets the control cases right from the seed alone", () => {
    expect(report.byCategory.transport.seedOnly.accuracy).toBe(1);
  });

  it("does not improve when there is no feedback at all", () => {
    const none = runBenchmark(bench, seed.items, seed.areas, seed.officialRefs, { ...DEFAULT_FEEDBACK_SIM, coverage: 0 });
    expect(none.splits.all.afterFeedback.accuracy).toBe(none.splits.all.seedOnly.accuracy);
  });
});
