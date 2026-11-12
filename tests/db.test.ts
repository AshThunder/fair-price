import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStore, type SqlStore } from "../server/db/index.js";
import type { StoredVerdict } from "../shared/types.js";

let store: SqlStore;

beforeAll(async () => {
  store = await createStore({ pgliteDir: "memory://" });
});
afterAll(async () => {
  await store.close();
});

function verdict(id: string): StoredVerdict {
  return {
    id,
    itemId: "rice-local",
    areaId: "NG",
    quoteNaira: 1900,
    unit: "1 kg",
    code: {
      label: "fair",
      reasonCodes: ["inside-band"],
      range: { mid: 1905, low: 1620, high: 2191, sampleSize: 1, officialCount: 1, observationCount: 0, thin: true, fallback: "national", points: [], method: "test" },
    },
    serv: null,
    final: "fair",
    tip: "Confirm the unit.",
    reasons: ["Inside the band."],
    quotes: [],
    confidence: "medium",
    createdAt: "2026-11-12T10:00:00.000Z",
    demo: false,
  };
}

describe("SqlStore on PGlite", () => {
  it("runs migrations once and records them", async () => {
    expect(await store.appliedMigrations()).toEqual(["001_init"]);
    await store.init();
    expect(store.kind).toBe("pglite");
    expect(store.durable).toBe(false);
  });

  it("stores, reads and patches verdicts", async () => {
    await store.addVerdict(verdict("v-1"));
    const got = await store.getVerdict("v-1");
    expect(got?.code.range.mid).toBe(1905);
    const patched = await store.updateVerdict("v-1", { reppoEvalId: "e-1", reppoStatus: "QUEUED" });
    expect(patched?.reppoEvalId).toBe("e-1");
    expect((await store.getVerdict("v-1"))?.reppoStatus).toBe("QUEUED");
    expect(await store.getVerdict("missing")).toBeUndefined();
    expect(await store.countVerdicts()).toBe(1);
  });

  it("stores observations and filters by item", async () => {
    await store.addObservation({ itemId: "pms", areaId: "NG-KANO", priceNaira: 1420, source: "typed", status: "accepted", trust: 0.45, deviceHash: "d1", tag: "live" });
    await store.addObservation({ itemId: "yam", areaId: "NG-KANO", priceNaira: 2300, source: "typed", status: "quarantine", trust: 0.2, deviceHash: "d2", tag: "live", note: "outlier" });
    const pms = await store.listObservations({ itemId: "pms" });
    expect(pms).toHaveLength(1);
    expect(pms[0].priceNaira).toBe(1420);
    expect(typeof pms[0].createdAt).toBe("string");
    expect((await store.listObservations()).length).toBe(2);
  });

  it("stores feedback linked to a verdict", async () => {
    await store.addFeedback({ verdictId: "v-1", kind: "paid", paidNaira: 1850, deviceHash: "d1" });
    const all = await store.listFeedback();
    expect(all[0].paidNaira).toBe(1850);
  });

  it("claims the 24-hour device slot atomically", async () => {
    const now = new Date("2026-11-12T10:00:00Z");
    const args = { deviceHash: "dev-a", itemId: "pms", areaId: "NG-KANO", windowMs: 24 * 3600_000 };
    expect(await store.claimDeviceKey({ ...args, now })).toBe(true);
    expect(await store.claimDeviceKey({ ...args, now: new Date(now.getTime() + 3600_000) })).toBe(false);
    const results = await Promise.all([1, 2, 3].map((h) => store.claimDeviceKey({ ...args, now: new Date(now.getTime() + h * 60_000) })));
    expect(results.every((r) => r === false)).toBe(true);
    expect(await store.claimDeviceKey({ ...args, now: new Date(now.getTime() + 25 * 3600_000) })).toBe(true);
    expect(await store.claimDeviceKey({ ...args, itemId: "yam", now })).toBe(true);
  });

  it("tracks device trust from outcomes", async () => {
    expect((await store.getDevice("fresh")).trust).toBe(0.45);
    await store.recordDeviceOutcome("fresh", "accepted");
    expect(await store.recordDeviceOutcome("fresh", "accepted")).toBe(0.75);
    const after = await store.recordDeviceOutcome("fresh", "quarantine");
    expect(after).toBeCloseTo(0.55, 5);
    expect(await store.getDevice("fresh")).toMatchObject({ accepted: 2, quarantined: 1, rejected: 0 });
  });

  it("upserts Reppo evals without losing earlier fields", async () => {
    await store.upsertReppo({ evalId: "e-1", verdictId: "v-1", taskType: "claim", status: "QUEUED", score: null, decision: null, route: null, reason: null, creditsCharged: 440, createdAt: "2026-11-12T10:00:00.000Z" });
    await store.upsertReppo({ evalId: "e-1", verdictId: "", taskType: "claim", status: "COMPLETED", score: 81, decision: "accept", route: "ship", reason: "ok", creditsCharged: null, latencyMs: 52000, createdAt: "2026-11-12T10:00:00.000Z", completedAt: "2026-11-12T10:00:52.000Z" });
    const r = await store.getReppo("e-1");
    expect(r).toMatchObject({ verdictId: "v-1", status: "COMPLETED", score: 81, creditsCharged: 440, latencyMs: 52000 });
    expect(await store.countReppoSince(new Date("2026-11-12T00:00:00Z"))).toBe(1);
    expect(await store.countReppoSince(new Date("2026-11-13T00:00:00Z"))).toBe(0);
  });

  it("keeps Telegram sessions", async () => {
    expect(await store.getSession("42")).toBeUndefined();
    await store.setSession("42", { step: "price", itemId: "pms", demo: true });
    await store.setSession("42", { step: "verdict", itemId: "pms", demo: true });
    expect(await store.getSession("42")).toEqual({ step: "verdict", itemId: "pms", demo: true });
  });
});

describe("store selection", () => {
  it("persists to a PGlite directory across reopen", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "fp-pglite-"));
    const a = await createStore({ pgliteDir: dir });
    expect(a.durable).toBe(true);
    await a.addVerdict(verdict("v-persist"));
    await a.close();
    const b = await createStore({ pgliteDir: dir });
    expect((await b.getVerdict("v-persist"))?.id).toBe("v-persist");
    expect(await b.appliedMigrations()).toEqual(["001_init"]);
    await b.close();
  });
});
