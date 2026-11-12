import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleTelegramUpdate, setTelegramSender } from "../server/telegram.js";
import app from "../server/app.js";

const sent: Array<{ method: string; body: Record<string, unknown> }> = [];

beforeAll(() => {
  setTelegramSender(async (method, body) => {
    sent.push({ method, body });
    return { ok: true };
  });
});
afterAll(() => setTelegramSender(null));

const chat = 990001;
const msg = (text: string) => ({ update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: chat }, text, from: { is_bot: false } } });
const last = () => String(sent[sent.length - 1]?.body.text ?? "");

describe("Telegram handler with synthetic updates", () => {
  it("walks a demo check from /start to a saved confirmation", async () => {
    await handleTelegramUpdate(msg("/start"));
    expect(last()).toContain("Fair Price checks");
    await handleTelegramUpdate(msg("/demo on"));
    expect(last()).toContain("Demo mode is on");
    await handleTelegramUpdate(msg("/check"));
    expect(last()).toContain("Which country");
    await handleTelegramUpdate(msg("Narnia"));
    expect(last()).toContain("could not find");
    await handleTelegramUpdate(msg("Nigeria"));
    expect(last()).toContain("What are you buying");
    await handleTelegramUpdate(msg("Fresh tomatoes"));
    expect(last()).toContain("Where are you buying");
    await handleTelegramUpdate(msg("Kano"));
    expect(last()).toContain("NGN");
    expect(last()).toContain("What price");
    await handleTelegramUpdate(msg("1,400"));
    expect(last()).toMatch(/Verdict: Fair price/);
    expect(last()).toContain("₦1,400");
    await handleTelegramUpdate(msg("paid 1350"));
    expect(last()).toMatch(/Saved|ignored|quarantined/);
    expect(sent.every((s) => s.method === "sendMessage" && s.body.chat_id === chat)).toBe(true);
  });

  it("answers /metrics and /board", async () => {
    await handleTelegramUpdate(msg("/metrics"));
    expect(last()).toMatch(/Benchmark: \d+ price cases across \d+ countries/);
    await handleTelegramUpdate(msg("/board Kano"));
    expect(last()).toContain("Price board for Kano");
    await handleTelegramUpdate(msg("/board UK"));
    expect(last()).toContain("GBP");
    expect(last()).toContain("£");
  });

  it("checks anything, anywhere: a town with no data gets Not sure yet in its own currency", async () => {
    await handleTelegramUpdate(msg("/demo on"));
    await handleTelegramUpdate(msg("/country Kenya"));
    expect(last()).toContain("KES");
    await handleTelegramUpdate(msg("/check"));
    await handleTelegramUpdate(msg("bicycle repair"));
    await handleTelegramUpdate(msg("Eldoret"));
    expect(last()).toContain("KES");
    await handleTelegramUpdate(msg("500"));
    expect(last()).toContain("Not sure yet, be the first to confirm");
    expect(last()).toContain("Eldoret, Kenya");
    expect(last()).not.toContain("₦");
  });

  it("ignores bot senders and rejects a webhook without the secret when one is set", async () => {
    const before = sent.length;
    await handleTelegramUpdate({ message: { chat: { id: chat }, text: "/start", from: { is_bot: true } } });
    expect(sent.length).toBe(before);
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    const res = await app.request("/api/telegram", { method: "POST", body: JSON.stringify(msg("/start")), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });
});
