import { afterEach, describe, expect, it, vi } from "vitest";
import { judgeWithServ, ServUnavailableError } from "../server/serv.js";
import { codeVerdict } from "../shared/engine.js";
import { getSeed } from "../server/store.js";

const seed = getSeed();
const item = seed.items.find((i) => i.id === "tomatoes")!;
const area = seed.areas.find((a) => a.id === "NG-KANO")!;
const code = codeVerdict(item, area, 1400, seed.officialRefs, [], seed.areas, new Date("2026-11-12"));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENSERV_API_KEY;
});

describe("judgeWithServ", () => {
  it("sends a system message and no custom temperature, and parses the JSON verdict", async () => {
    process.env.OPENSERV_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.messages[0].role).toBe("system");
      expect(body).not.toHaveProperty("temperature");
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"verdict":"high","confidence":"medium","reasons":["Above the band"],"negotiation_tip":"Offer less."}' } }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const j = await judgeWithServ({ item, area, quote: 1400, code });
    expect(j.verdict).toBe("high");
    expect(j.reasons).toEqual(["Above the band"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("raises ServUnavailableError on an HTTP error", async () => {
    process.env.OPENSERV_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"bad"}}', { status: 400 })));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(judgeWithServ({ item, area, quote: 1400, code })).rejects.toBeInstanceOf(ServUnavailableError);
  });
});

describe("/api/check when SERV disagrees with the band", () => {
  it("keeps the band's label, drops SERV's contradicting text, and shows its note", async () => {
    const { default: app } = await import("../server/app.js");
    process.env.OPENSERV_API_KEY = "test-key";
    const content = JSON.stringify({
      verdict: "fair",
      confidence: "high",
      reasons: ["This price is perfectly fair."],
      quotes: [],
      negotiation_tip: "Pay it.",
      evidence_ids: [],
      note: "The only anchor is a monthly average and Kano stall prices rose this week.",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })));
    const res = await app.request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "tomatoes", areaId: "NG-KANO", quote: 2500, deviceId: "t-serv-disagree", demo: false }),
    });
    const { verdict } = (await res.json()) as { verdict: Record<string, any> };
    expect(verdict.label).toBe("high");
    expect(verdict.quote).toBeGreaterThan(verdict.high);
    expect(verdict.reasons.join(" ")).not.toMatch(/perfectly fair/);
    expect(verdict.tip).not.toBe("Pay it.");
    expect(verdict.note).toMatch(/monthly average/);
    expect(verdict.servAvailable).toBe(true);
  });

  it("uses SERV's reasons and tip when it agrees", async () => {
    const { default: app } = await import("../server/app.js");
    process.env.OPENSERV_API_KEY = "test-key";
    const content = JSON.stringify({ verdict: "high", confidence: "medium", reasons: ["Above the Kano band."], quotes: [], negotiation_tip: "Offer the middle of the band.", evidence_ids: [], note: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })));
    const res = await app.request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "tomatoes", areaId: "NG-KANO", quote: 2500, deviceId: "t-serv-agree", demo: false }),
    });
    const { verdict } = (await res.json()) as { verdict: Record<string, any> };
    expect(verdict.label).toBe("high");
    expect(verdict.reasons).toContain("Above the Kano band.");
    expect(verdict.tip).toBe("Offer the middle of the band.");
    expect(verdict.note).toBeNull();
  });
});

describe("judgeWithServ retry", () => {
  it("retries once when the reply is unreadable", async () => {
    process.env.OPENSERV_API_KEY = "test-key";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const replies = ["", '{"verdict":"high","reasons":[],"negotiation_tip":"x"}'];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: replies.shift() } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const j = await judgeWithServ({ item, area, quote: 1400, code });
    expect(j.verdict).toBe("high");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("plainWords", () => {
  it("replaces internal jargon in SERV text", async () => {
    const { plainWords } = await import("../server/serv.js");
    expect(plainWords("The evidence pack shows one sample.")).toBe("The data shows one sample.");
    expect(plainWords("Above the code high band of ₦1,848.")).toBe("Above the high end of the usual range of ₦1,848.");
    expect(plainWords("Inside the computed band.")).toBe("Inside the usual range.");
  });
});
