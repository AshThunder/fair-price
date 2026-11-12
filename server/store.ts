import type { BenchmarkFile, Observation, ReppoRecord, SeedFile } from "../shared/types.js";
import seedJson from "../data/seed.json" with { type: "json" };
import benchmarkJson from "../data/benchmark.json" with { type: "json" };
import demoEvalsJson from "../data/demo-evals.json" with { type: "json" };

export { getStore, setStore, createStore } from "./db/index.js";

// Static reference data (official anchors, items, areas, benchmark) ships with
// the bundle as JSON imports so serverless builds always include it.
// Everything users create lives in the database (see server/db).
const seed = seedJson as unknown as SeedFile;
const benchmark = benchmarkJson as unknown as BenchmarkFile;

const demoStamp = "2026-11-01T09:00:00.000Z";
const seededObs: Observation[] = seed.demoObservations.map((o, i) => ({
  ...o,
  createdAt: o.createdAt ?? new Date(Date.parse(demoStamp) + i * 3600_000).toISOString(),
  tag: o.tag ?? "demo",
}));

export function getSeed(): SeedFile {
  return seed;
}

export function getBenchmark(): BenchmarkFile {
  return benchmark;
}

export function demoObservations(): Observation[] {
  return seededObs;
}

export function loadDemoEvals(): ReppoRecord[] {
  return ((demoEvalsJson as unknown as { evals?: ReppoRecord[] }).evals ?? []);
}
