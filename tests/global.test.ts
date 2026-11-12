import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../server/app.js";
import { createStore, type SqlStore } from "../server/db/index.js";
import { getSeed } from "../server/store.js";
import { buildRange } from "../shared/engine.js";
import {
  countryFromLocale,
  findCountry,
  money,
  resolveArea,
  resolveItem,
  unitOptions,
} from "../shared/geo.js";
import type { Observation } from "../shared/types.js";

const seed = getSeed();

describe("geo helpers", () => {
  it("formats money in each country's own currency", () => {
    expect(money(1905.43, "NGN", "en-NG")).toBe("₦1,905");
    expect(money(4.482, "USD", "en-US")).toBe("$4.48");
    expect(money(1.6845, "GBP", "en-GB")).toBe("£1.68");
    expect(money(227.85, "KES", "en-KE")).toMatch(/^Ksh\s?228$/);
    expect(money(6.51, "BRL", "pt-BR")).toMatch(/^R\$\s?6,51$/);
    expect(money(102.12, "INR", "en-IN")).toBe("₹102");
  });

  it("finds countries by code, name and alias, and from a locale", () => {
    expect(findCountry("ke")).toBe("KE");
    expect(findCountry("Brazil")).toBe("BR");
    expect(findCountry("UK")).toBe("GB");
    expect(findCountry("Narnia")).toBeUndefined();
    expect(countryFromLocale("pt-BR")).toBe("BR");
    expect(countryFromLocale("en")).toBeUndefined();
  });

  it("uses imperial units in the US and metric elsewhere", () => {
    expect(unitOptions("US")).toContain("1 lb");
    expect(unitOptions("KE")).toContain("1 kg");
  });

  it("resolves free-text places and items", () => {
    const nairobi = resolveArea(seed.areas, { country: "KE", place: "nairobi" });
    expect(nairobi?.id).toBe("KE-NAIROBI");
    const eldoret = resolveArea(seed.areas, { country: "KE", place: "Eldoret" });
    expect(eldoret).toMatchObject({ kind: "city", country: "KE", currency: "KES", parentId: "KE", custom: true });
    const fct = resolveArea(seed.areas, { country: "NG", place: "FCT" });
    expect(fct?.id).toBe("NG-ABUJA");
    expect(resolveItem(seed.items, { text: "petrol", country: "US" })?.id).toBe("pms");
    const custom = resolveItem(seed.items, { text: "Bicycle repair", unit: "1 job", country: "KE" });
    expect(custom?.custom).toBe(true);
    expect(custom?.id).toMatch(/^x-bicycle-repair--/);
  });
});

describe("currencies never mix", () => {
  it("ignores refs and confirmations in another currency", () => {
    const pms = seed.items.find((i) => i.id === "pms")!;
    const nairobi = seed.areas.find((a) => a.id === "KE-NAIROBI")!;
    const naira: Observation = {
      id: "o1", itemId: "pms", areaId: "KE-NAIROBI", price: 1400, currency: "NGN", source: "typed",
      status: "accepted", trust: 1, deviceHash: "d", tag: "live", createdAt: "2026-11-11T10:00:00Z",
    };
    const range = buildRange(pms.id, nairobi.id, seed.officialRefs, [naira], seed.areas, new Date("2026-11-12"));
    expect(range.currency).toBe("KES");
    expect(range.observationCount).toBe(0);
    expect(range.mid).toBeGreaterThan(200);
    expect(range.mid).toBeLessThan(250);
  });

  it("falls back to the national figure for a town with no data, inside one country", () => {
    const pms = seed.items.find((i) => i.id === "pms")!;
    const thika = resolveArea(seed.areas, { country: "KE", place: "Thika" })!;
    const range = buildRange(pms.id, thika.id, seed.officialRefs, [], seed.areas, new Date("2026-11-12"));
    expect(range.fallback).toBe("national");
    expect(range.mid).toBeCloseTo(227.85, 1);
  });

  it("says not sure yet for India towns with no figure at all", () => {
    const pms = seed.items.find((i) => i.id === "pms")!;
    const lucknow = resolveArea(seed.areas, { country: "IN", place: "Lucknow" })!;
    const range = buildRange(pms.id, lucknow.id, seed.officialRefs, [], seed.areas, new Date("2026-11-12"));
    expect(range.mid).toBeNull();
  });
});

describe("global API", () => {
  it("lists every country with its currency and seeded ones first", async () => {
    const res = (await (await app.request("/api/catalog")).json()) as { countries: Array<{ code: string; currency: string; seeded?: boolean }> };
    expect(res.countries.length).toBeGreaterThan(150);
    expect(res.countries.slice(0, 6).map((c) => c.code).sort()).toEqual(["BR", "GB", "IN", "KE", "NG", "US"]);
    expect(res.countries.find((c) => c.code === "JP")?.currency).toBe("JPY");
  });

  it("checks petrol in London in pounds", async () => {
    const res = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "GB", place: "London", itemText: "petrol", quote: 2.4, deviceId: "t-gb", demo: true }),
    });
    const body = (await res.json()) as { verdict: { label: string; currency: string; country: string; areaName: string; tip: string } };
    expect(body.verdict.currency).toBe("GBP");
    expect(body.verdict.country).toBe("GB");
    expect(body.verdict.label).toBe("high");
    expect(body.verdict.areaName).toBe("London");
    expect(body.verdict.tip).not.toContain("₦");
  });

  it("returns Not sure yet for a free-text item with no data", async () => {
    const res = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "JP", place: "Osaka", itemText: "umbrella repair", quote: 1500, deviceId: "t-jp", demo: true }),
    });
    const body = (await res.json()) as { verdict: { label: string; currency: string; custom: boolean } };
    expect(body.verdict.label).toBe("uncertain");
    expect(body.verdict.currency).toBe("JPY");
    expect(body.verdict.custom).toBe(true);
  });

  it("serves a board per country", async () => {
    const res = (await (await app.request("/api/board?country=US&demo=1")).json()) as {
      area: { currency: string };
      rows: Array<{ itemId: string; mid: number | null }>;
    };
    expect(res.area.currency).toBe("USD");
    expect(res.rows.find((r) => r.itemId === "eggs-dozen")?.mid).toBeCloseTo(2.272, 2);
  });
});

describe("Reppo trust feedback", () => {
  let store: SqlStore;
  beforeAll(async () => {
    store = await createStore({ pgliteDir: "memory://" });
  });
  afterAll(async () => store.close());

  async function seedEval(evalId: string, verdictId: string) {
    const o = await store.addObservation({
      itemId: "pms", areaId: "KE-NAIROBI", price: 227, currency: "KES", source: "typed", status: "accepted",
      trust: 0.5, deviceHash: `d-${evalId}`, tag: "live", verdictId,
    });
    await store.upsertReppo({
      evalId, verdictId, taskType: "claim", status: "COMPLETED", score: null, decision: null, route: null,
      reason: null, creditsCharged: null, createdAt: new Date().toISOString(),
    });
    return o;
  }

  it("boosts a high score once, and only once", async () => {
    await seedEval("e-hi", "v-hi");
    expect(await store.applyReppoTrust("e-hi", "v-hi", 92, "accept")).toBe("boosted");
    expect(await store.applyReppoTrust("e-hi", "v-hi", 92, "accept")).toBe("boosted");
    const obs = (await store.listObservations()).find((o) => o.verdictId === "v-hi")!;
    expect(obs.trust).toBeCloseTo(0.575, 3);
  });

  it("halves trust when Reppo rejects", async () => {
    await seedEval("e-lo", "v-lo");
    expect(await store.applyReppoTrust("e-lo", "v-lo", 40, "reject")).toBe("reduced");
    const obs = (await store.listObservations()).find((o) => o.verdictId === "v-lo")!;
    expect(obs.trust).toBeCloseTo(0.25, 3);
  });

  it("leaves middling scores alone", async () => {
    await seedEval("e-mid", "v-mid");
    expect(await store.applyReppoTrust("e-mid", "v-mid", 72, "accept")).toBe("unchanged");
  });
});
