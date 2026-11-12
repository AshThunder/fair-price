// Checks the bot token with getMe (read-only), then feeds synthetic updates through the
// real webhook route with a captured sender, so no Telegram user is messaged.
// Uses an in-memory store and live SERV; it never sends "paid", so no Reppo eval is spent.
// Run: npx tsx scripts/telegram-live.ts
process.env.FAIRPRICE_STORE = "memory";
delete process.env.TELEGRAM_WEBHOOK_SECRET;

const { telegramToken, hasServ } = await import("../server/env.js");
const { setTelegramSender } = await import("../server/telegram.js");
const { default: app } = await import("../server/app.js");

const token = telegramToken();
if (!token) throw new Error("FAIRPRICE_TELEGRAM_BOT_TOKEN is not set");
const me = (await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json()) as {
  ok: boolean;
  result?: { id: number; username: string; is_bot: boolean };
};
console.log("getMe", JSON.stringify({ ok: me.ok, username: me.result?.username, is_bot: me.result?.is_bot }));
const hook = (await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json()) as {
  ok: boolean;
  result?: { url: string; pending_update_count: number };
};
console.log("getWebhookInfo", JSON.stringify({ ok: hook.ok, webhookSet: Boolean(hook.result?.url), pending: hook.result?.pending_update_count }));

const sent: string[] = [];
setTelegramSender(async (method, body) => {
  sent.push(`${method}: ${String(body.text ?? "")}`);
  return { ok: true };
});

const chat = 424242;
let n = 1;
async function say(text: string) {
  const before = sent.length;
  const t0 = Date.now();
  const res = await app.request("/api/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ update_id: n++, message: { message_id: n, chat: { id: chat, type: "private" }, from: { id: chat, is_bot: false }, text } }),
  });
  console.log(`\n> ${text}  [HTTP ${res.status}, ${Date.now() - t0} ms]`);
  for (const line of sent.slice(before)) console.log(line);
}

console.log("live SERV configured:", hasServ());
await say("/start");
await say("/check");
await say("Fresh tomatoes");
await say("Kano");
await say("₦1,600");
await say("/metrics");
