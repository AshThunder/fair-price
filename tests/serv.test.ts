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
