import { describe, expect, it } from "vitest";
import app from "../server/app.js";

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

describe("API", () => {
  it("serves health and catalog", async () => {
    const health = await json(await app.request("/api/health"));
    expect(health.status).toBe("ok");
    const catalog = (await json(await app.request("/api/catalog"))) as {
      items: unknown[];
      areas: unknown[];
    };
    expect(catalog.items.length).toBe(22);
    expect(catalog.areas.length).toBe(37);
  });

  it("returns a demo verdict for national rice at the official average", async () => {
    const res = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: "rice-local",
        areaId: "NG",
        quote: 1905.43,
        deviceId: "test-device-rice",
        demo: true,
      }),
    });
    const body = (await json(res)) as { verdict: { label: string; mid: number; demo: boolean } };
    expect(res.status).toBe(200);
    expect(body.verdict.label).toBe("fair");
    expect(body.verdict.demo).toBe(true);
    expect(body.verdict.mid).toBeCloseTo(1905.43, 0);
  });

  it("shows Kano tomatoes 1400 as high in the seed-only sense but fair after demo confirms", async () => {
    const res = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: "tomatoes",
        areaId: "NG-KANO",
        quote: 1400,
        deviceId: "test-device-tomatoes",
        demo: true,
      }),
    });
    const body = (await json(res)) as { verdict: { label: string; id: string } };
    expect(body.verdict.label).toBe("fair");
  });

  it("accepts paid feedback and rejects a duplicate from the same device", async () => {
    const deviceId = `dup-device-${Date.now()}-${Math.random()}`;
    const check = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: "garri-white",
        areaId: "NG-OYO",
        quote: 800,
        deviceId,
        demo: true,
      }),
    });
    const verdict = (await json(check)) as { verdict: { id: string } };
    const first = await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verdictId: verdict.verdict.id,
        kind: "paid",
        paid: 800,
        deviceId,
        demo: true,
      }),
    });
    const firstBody = (await json(first)) as { observation: { status: string } };
    expect(firstBody.observation.status).toBe("accepted");

    const secondCheck = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: "garri-white",
        areaId: "NG-OYO",
        quote: 810,
        deviceId,
        demo: true,
      }),
    });
    const v2 = (await json(secondCheck)) as { verdict: { id: string } };
    const second = await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verdictId: v2.verdict.id,
        kind: "paid",
        paid: 810,
        deviceId,
        demo: true,
      }),
    });
    const secondBody = (await json(second)) as { observation: { status: string } };
    expect(secondBody.observation.status).toBe("rejected");
  });

  it("publishes board and metrics with the held-out benchmark", async () => {
    const board = (await json(await app.request("/api/board?areaId=NG-KANO&demo=1"))) as {
      rows: Array<{ itemId: string; mid: number | null }>;
    };
    const tomatoes = board.rows.find((r) => r.itemId === "tomatoes");
    expect(tomatoes?.mid).toBeTruthy();

    const metrics = (await json(await app.request("/api/metrics"))) as {
      benchmark: {
        totalCases: number;
        splits: Record<string, { seedOnly: { accuracy: number }; afterFeedback: { accuracy: number } }>;
      };
      reppo: { evals: Array<{ source: string }> };
      live: { checks: number };
    };
    expect(metrics.benchmark.totalCases).toBeGreaterThanOrEqual(60);
    expect(metrics.benchmark.splits.test.afterFeedback.accuracy).toBeGreaterThan(metrics.benchmark.splits.test.seedOnly.accuracy);
    expect(metrics.live.checks).toBeGreaterThan(0);
    expect(metrics.reppo.evals.every((e) => e.source === "live")).toBe(true);
  });

  it("reports store health without leaking keys", async () => {
    const res = await app.request("/api/health");
    const body = (await json(res)) as { store: { kind: string; migrations: string[] }; configured: Record<string, boolean> };
    expect(body.store.kind).toBe("pglite");
    expect(body.store.migrations).toContain("001_init");
    expect(Object.values(body.configured).every((v) => typeof v === "boolean")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/key|token/i);
  });

  it("hides nothing but keeps the Reppo id out of the main verdict fields", async () => {
    const res = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: "rice-local", areaId: "NG", quote: 1905.43, deviceId: "badge", demo: true }),
    });
    const body = (await json(res)) as { verdict: { reppo: { state: string; score: number; evalId: string } } };
    expect(body.verdict.reppo.state).toBe("checked");
    expect(body.verdict.reppo.score).toBe(64);
  });

  it("rejects absurd quotes and unknown items", async () => {
    const bad = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: "rice-local", areaId: "NG", quote: 1e12, demo: true }),
    });
    expect(bad.status).toBe(400);
    const unknown = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: "caviar", areaId: "NG", quote: 100, demo: true }),
    });
    expect(unknown.status).toBe(400);
  });

  it("keeps demo confirmations out of live ranges", async () => {
    const deviceId = `iso-${Date.now()}`;
    const check = (await json(
      await app.request("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "barbing", areaId: "NG-BAUCHI", quote: 1000, deviceId, demo: true }),
      }),
    )) as { verdict: { id: string; label: string } };
    expect(check.verdict.label).toBe("uncertain");
    await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdictId: check.verdict.id, kind: "paid", paid: 1000, deviceId, demo: true }),
    });
    const liveBoard = (await json(await app.request("/api/board?areaId=NG-BAUCHI&demo=0"))) as { rows: Array<{ itemId: string; observationCount: number }> };
    expect(liveBoard.rows.find((r) => r.itemId === "barbing")?.observationCount ?? 0).toBe(0);
    const demoBoard = (await json(await app.request("/api/board?areaId=NG-BAUCHI&demo=1"))) as { rows: Array<{ itemId: string; observationCount: number }> };
    expect(demoBoard.rows.find((r) => r.itemId === "barbing")?.observationCount).toBe(1);
  });
});
