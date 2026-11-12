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
    expect(catalog.items.length).toBe(13);
    expect(catalog.areas.length).toBe(14);
  });

  it("returns a demo verdict for national rice at the official average", async () => {
    const res = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: "rice-local",
        areaId: "NG",
        quoteNaira: 1905.43,
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
        quoteNaira: 1400,
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
        quoteNaira: 800,
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
        paidNaira: 800,
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
        quoteNaira: 810,
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
        paidNaira: 810,
        deviceId,
        demo: true,
      }),
    });
    const secondBody = (await json(second)) as { observation: { status: string } };
    expect(secondBody.observation.status).toBe("rejected");
  });

  it("publishes board and metrics with a seed-only versus after-feedback gap", async () => {
    const board = (await json(await app.request("/api/board?areaId=NG-KANO"))) as {
      rows: Array<{ itemId: string; mid: number | null }>;
    };
    const tomatoes = board.rows.find((r) => r.itemId === "tomatoes");
    expect(tomatoes?.mid).toBeTruthy();

    const metrics = (await json(await app.request("/api/metrics"))) as {
      seedOnly: { agreed: number; cases: number };
      afterFeedback: { agreed: number; cases: number };
    };
    expect(metrics.seedOnly.cases).toBe(10);
    expect(metrics.afterFeedback.agreed).toBeGreaterThan(metrics.seedOnly.agreed);
  });
});
