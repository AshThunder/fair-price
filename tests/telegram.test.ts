import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
  configureTelegramBot,
  handleTelegramUpdate,
  MENU,
  setTelegramSender,
  SITE_URL,
} from "../server/telegram.js";
import app from "../server/app.js";

const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
let messageSeq = 100;

beforeAll(() => {
  setTelegramSender(async (method, body) => {
    sent.push({ method, body });
    if (method === "sendMessage") {
      messageSeq += 1;
      return { ok: true, result: { message_id: messageSeq } };
    }
    return { ok: true };
  });
});
afterAll(() => setTelegramSender(null));

function lastOf(method = "sendMessage") {
  return [...sent].reverse().find((s) => s.method === method);
}
const lastText = () => String(lastOf("sendMessage")?.body.text ?? lastOf("editMessageText")?.body.text ?? "");
const lastMarkup = () => lastOf()?.body.reply_markup as Record<string, unknown> | undefined;
const callbackDatas = (markup?: Record<string, unknown>) => {
  const rows = (markup?.inline_keyboard as Array<Array<{ callback_data?: string; text?: string; url?: string }>>) ?? [];
  return rows.flat().map((b) => b.callback_data).filter(Boolean) as string[];
};
const buttonLabels = (markup?: Record<string, unknown>) => {
  const inline = (markup?.inline_keyboard as Array<Array<{ text: string }>> | undefined) ?? [];
  const reply = (markup?.keyboard as Array<Array<{ text: string }>> | undefined) ?? [];
  return [...inline, ...reply].flat().map((b) => b.text);
};

const msg = (chat: number, text: string) => ({
  update_id: Math.floor(Math.random() * 1e9),
  message: { message_id: 1, chat: { id: chat }, text, from: { is_bot: false } },
});
const cb = (chat: number, data: string, messageId = 1) => ({
  update_id: Math.floor(Math.random() * 1e9),
  callback_query: {
    id: `cb-${Math.floor(Math.random() * 1e9)}`,
    data,
    from: { is_bot: false },
    message: { message_id: messageId, chat: { id: chat }, text: "" },
  },
});

describe("Telegram handler with synthetic updates", () => {
  it("walks a demo check from /start to a saved confirmation, including slash fallbacks", async () => {
    const chat = 990001;
    await handleTelegramUpdate(msg(chat, "/start"));
    expect(lastText()).toContain("Fair Price checks");
    expect(lastText()).toContain("SERV Reasoning");
    expect(lastText()).toContain("Reppo's Eval Router");
    expect(buttonLabels(lastMarkup())).toEqual([
      MENU.check,
      MENU.board,
      MENU.how,
      MENU.country,
      MENU.metrics,
    ]);

    await handleTelegramUpdate(msg(chat, "/demo on"));
    expect(lastText()).toContain("Demo mode is on");

    await handleTelegramUpdate(msg(chat, "/check"));
    expect(lastText()).toContain("Which country");
    expect(callbackDatas(lastMarkup())).toContain("cc:NG");
    expect(callbackDatas(lastMarkup())).toContain("cc:_other");

    await handleTelegramUpdate(msg(chat, "Narnia"));
    expect(lastText()).toContain("could not find");

    await handleTelegramUpdate(msg(chat, "Nigeria"));
    expect(lastText()).toContain("What are you buying");
    expect(buttonLabels(lastMarkup())).toContain("Fresh tomatoes");
    expect(buttonLabels(lastMarkup())).toContain("Something else");

    await handleTelegramUpdate(msg(chat, "Fresh tomatoes"));
    expect(lastText()).toContain("What unit");
    expect(buttonLabels(lastMarkup())).toContain("1 kg");

    await handleTelegramUpdate(msg(chat, "1 kg"));
    expect(lastText()).toContain("Where are you buying");
    expect(buttonLabels(lastMarkup())).toContain("Kano");

    await handleTelegramUpdate(msg(chat, "Kano"));
    expect(lastText()).toContain("NGN");
    expect(lastText()).toContain("What price");

    await handleTelegramUpdate(msg(chat, "1,400"));
    expect(lastText()).toMatch(/Verdict: Fair price/);
    expect(lastText()).toContain("₦1,400");
    expect(lastText()).toContain("Range by Fair Price engine");
    expect(lastText()).toMatch(/Reppo scores it once you confirm|Scored by Reppo/);
    expect(callbackDatas(lastMarkup())).toEqual(["fb:paid", "fb:fair", "fb:off", "fb:again", "fb:menu"]);

    await handleTelegramUpdate(msg(chat, "paid 1350"));
    expect(lastText()).toMatch(/Saved|ignored|quarantined/);
    expect(sent.filter((s) => s.body.chat_id === chat).every((s) => ["sendMessage", "editMessageText"].includes(s.method))).toBe(
      true,
    );
  });

  it("answers Accuracy and Price board with a short summary and a URL button", async () => {
    const chat = 990002;
    await handleTelegramUpdate(msg(chat, "/demo on"));
    await handleTelegramUpdate(msg(chat, MENU.metrics));
    expect(lastText()).toMatch(/Benchmark: \d+ price cases across \d+ countries/);
    expect(lastText()).toContain("Open the Metrics page");
    const metricsMarkup = lastMarkup();
    expect((metricsMarkup?.inline_keyboard as Array<Array<{ url: string }>>)[0][0].url).toBe(`${SITE_URL}/metrics`);

    await handleTelegramUpdate(msg(chat, "/board Kano"));
    expect(lastText()).toContain("Price board for Kano");
    expect((lastMarkup()?.inline_keyboard as Array<Array<{ url: string }>>)[0][0].url).toBe(`${SITE_URL}/board`);

    await handleTelegramUpdate(msg(chat, "/board UK"));
    expect(lastText()).toContain("GBP");
    expect(lastText()).toContain("£");
  });

  it("checks anything, anywhere: a town with no data gets Not sure yet in its own currency", async () => {
    const chat = 990003;
    await handleTelegramUpdate(msg(chat, "/demo on"));
    await handleTelegramUpdate(msg(chat, "/country Kenya"));
    expect(lastText()).toContain("KES");
    await handleTelegramUpdate(msg(chat, "/check"));
    await handleTelegramUpdate(msg(chat, "bicycle repair"));
    expect(lastText()).toContain("What unit");
    await handleTelegramUpdate(msg(chat, "service"));
    await handleTelegramUpdate(msg(chat, "Eldoret"));
    expect(lastText()).toContain("KES");
    await handleTelegramUpdate(msg(chat, "500"));
    expect(lastText()).toContain("Not sure yet, be the first to confirm");
    expect(lastText()).toContain("Eldoret, Kenya");
    expect(lastText()).not.toContain("₦");
  });

  it("walks the button flow: country grid, How it works, verdict callbacks, I paid this", async () => {
    const chat = 990004;
    await handleTelegramUpdate(msg(chat, "/start"));
    await handleTelegramUpdate(msg(chat, "/demo on"));

    await handleTelegramUpdate(msg(chat, MENU.how));
    expect(lastText()).toContain("Fair Price engine finds the usual range");
    expect(lastText()).toContain("SERV Reasoning by OpenServ");
    expect(lastText()).toContain("Reppo's Eval Router");
    expect(lastText()).not.toMatch(/\p{Extended_Pictographic}/u);
    expect((lastMarkup()?.inline_keyboard as Array<Array<{ url: string }>>)[0][0].url).toBe(`${SITE_URL}/how`);

    await handleTelegramUpdate(msg(chat, MENU.check));
    expect(lastText()).toContain("Which country");

    const before = sent.length;
    await handleTelegramUpdate(cb(chat, "cc:NG"));
    expect(sent.slice(before).some((s) => s.method === "answerCallbackQuery")).toBe(true);
    expect(lastText()).toContain("What are you buying");
    expect(lastText()).toContain("Nigeria");

    await handleTelegramUpdate(msg(chat, "Fresh tomatoes"));
    await handleTelegramUpdate(msg(chat, "1 kg"));
    await handleTelegramUpdate(msg(chat, "Kano"));
    await handleTelegramUpdate(msg(chat, "1400"));
    expect(lastText()).toMatch(/Verdict: Fair price/);

    await handleTelegramUpdate(cb(chat, "fb:fair"));
    expect(lastText()).toContain("Thanks, that feedback is saved");

    await handleTelegramUpdate(cb(chat, "fb:paid"));
    expect(lastText()).toContain("What did you pay");
    expect(callbackDatas(lastMarkup())).toContain("fb:quoted");

    await handleTelegramUpdate(cb(chat, "fb:quoted"));
    expect(lastText()).toMatch(/Saved|ignored|quarantined/);
  });

  it("lets someone type a country after Other, and Change country returns to the menu", async () => {
    const chat = 990005;
    await handleTelegramUpdate(msg(chat, "/start"));
    await handleTelegramUpdate(msg(chat, MENU.country));
    expect(lastText()).toContain("Which country");
    await handleTelegramUpdate(cb(chat, "cc:_other"));
    expect(lastText()).toContain("Type any country name");
    await handleTelegramUpdate(msg(chat, "Kenya"));
    expect(lastText()).toContain("Ada here");
    expect(lastText()).toContain("Kenya");
    expect(lastText()).toContain("KES");
  });

  it("refresh score answers the callback and does not wait, and posts no long-lived poll", async () => {
    const chat = 990006;
    await handleTelegramUpdate(msg(chat, "/demo on"));
    await handleTelegramUpdate(msg(chat, "/country NG"));
    await handleTelegramUpdate(msg(chat, "/check"));
    await handleTelegramUpdate(msg(chat, "Fresh tomatoes"));
    await handleTelegramUpdate(msg(chat, "1 kg"));
    await handleTelegramUpdate(msg(chat, "Kano"));
    await handleTelegramUpdate(msg(chat, "1400"));
    const verdictIdMatch = /paid (\d+)/.exec(lastText());
    expect(verdictIdMatch).toBeTruthy();

    const before = sent.length;
    await handleTelegramUpdate(cb(chat, "rp:refresh", 42));
    const after = sent.slice(before);
    expect(after.some((s) => s.method === "answerCallbackQuery")).toBe(true);
    expect(after.every((s) => s.method !== "getUpdates")).toBe(true);
    // Demo checks may already have a completed fixture score, or none yet.
    expect(after.length).toBeGreaterThan(0);
  });

  it("registers a minimal command menu and emoji-free descriptions", async () => {
    const before = sent.length;
    await configureTelegramBot();
    const calls = sent.slice(before);
    const commands = calls.find((s) => s.method === "setMyCommands")?.body.commands as Array<{ command: string }>;
    expect(commands).toEqual([{ command: "start", description: "Open Fair Price" }]);
    expect(calls.some((s) => s.method === "setMyShortDescription" && s.body.short_description === BOT_SHORT_DESCRIPTION)).toBe(
      true,
    );
    expect(calls.some((s) => s.method === "setMyDescription" && s.body.description === BOT_DESCRIPTION)).toBe(true);
    expect(BOT_SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
    expect(BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(BOT_SHORT_DESCRIPTION).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(BOT_DESCRIPTION).not.toMatch(/\p{Extended_Pictographic}/u);
    const menu = calls.find((s) => s.method === "setChatMenuButton")?.body.menu_button as { type: string; web_app?: { url: string } };
    expect(menu.type).toBe("web_app");
    expect(menu.web_app?.url).toBe(SITE_URL);
  });

  it("ignores bot senders, answers callback queries from bots, and rejects a webhook without the secret when one is set", async () => {
    const chat = 990007;
    const before = sent.length;
    await handleTelegramUpdate({ message: { chat: { id: chat }, text: "/start", from: { is_bot: true } } });
    expect(sent.length).toBe(before);
    await handleTelegramUpdate({
      callback_query: { id: "bot-cb", data: "fb:menu", from: { is_bot: true }, message: { chat: { id: chat } } },
    });
    expect(sent.at(-1)?.method).toBe("answerCallbackQuery");
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    const res = await app.request("/api/telegram", {
      method: "POST",
      body: JSON.stringify(msg(chat, "/start")),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });
});
