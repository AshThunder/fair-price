// Renders a real conversation transcript by running the actual Telegram handler
// on synthetic updates and capturing the exact bot replies and keyboards.
// Nobody is messaged and no Reppo eval is spent (demo mode is turned on first).
// Run: npx tsx scripts/telegram-transcript.ts
process.env.FAIRPRICE_STORE = "memory";
delete process.env.TELEGRAM_WEBHOOK_SECRET;

import { mkdirSync, writeFileSync } from "node:fs";
import { handleTelegramUpdate, MENU, setTelegramSender } from "../server/telegram.js";

const chat = 880001;
const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
let messageSeq = 200;
let updateId = 1;

setTelegramSender(async (method, body) => {
  sent.push({ method, body });
  if (method === "sendMessage") {
    messageSeq += 1;
    return { ok: true, result: { message_id: messageSeq } };
  }
  return { ok: true };
});

type Turn = {
  from: "user" | "bot";
  kind: "message" | "callback" | "edit" | "answer";
  text?: string;
  callback_data?: string;
  hidden?: boolean;
  method?: string;
  reply_markup?: unknown;
  message_id?: number;
};

const turns: Turn[] = [];

function captureNew(fromIndex: number) {
  for (const event of sent.slice(fromIndex)) {
    const body = event.body;
    if (event.method === "answerCallbackQuery") {
      turns.push({
        from: "bot",
        kind: "answer",
        method: event.method,
        text: body.text ? String(body.text) : undefined,
      });
      continue;
    }
    if (event.method === "editMessageText") {
      turns.push({
        from: "bot",
        kind: "edit",
        method: event.method,
        text: String(body.text ?? ""),
        reply_markup: body.reply_markup,
        message_id: body.message_id as number | undefined,
      });
      continue;
    }
    if (event.method === "sendMessage") {
      turns.push({
        from: "bot",
        kind: "message",
        method: event.method,
        text: String(body.text ?? ""),
        reply_markup: body.reply_markup,
        message_id: messageSeq,
      });
    }
  }
}

async function userSays(text: string, opts?: { hidden?: boolean }) {
  turns.push({ from: "user", kind: "message", text, hidden: opts?.hidden });
  const before = sent.length;
  await handleTelegramUpdate({
    update_id: updateId++,
    message: { message_id: updateId, chat: { id: chat }, text, from: { is_bot: false } },
  });
  const start = turns.length;
  captureNew(before);
  if (opts?.hidden) {
    for (const turn of turns.slice(start)) turn.hidden = true;
  }
}

async function userTaps(data: string, label: string) {
  turns.push({ from: "user", kind: "callback", text: label, callback_data: data });
  const before = sent.length;
  const lastBot = [...turns].reverse().find((t) => t.from === "bot" && t.message_id);
  await handleTelegramUpdate({
    update_id: updateId++,
    callback_query: {
      id: `cb-${updateId}`,
      data,
      from: { is_bot: false },
      message: { message_id: lastBot?.message_id, chat: { id: chat }, text: lastBot?.text ?? "" },
    },
  });
  captureNew(before);
}

await userSays("/demo on", { hidden: true });
await userSays("/start");
await userSays(MENU.how);
await userSays(MENU.check);
await userTaps("cc:KE", "Kenya");
await userSays("Petrol");
await userSays("1 litre");
await userSays("Nairobi");
await userSays("220");
await userTaps("fb:paid", "I paid this");
await userTaps("fb:quoted", "I paid the quoted amount");
await userSays(MENU.metrics);
await userTaps("fb:menu", "Main menu");
await userSays(MENU.board);

const out = {
  generatedAt: new Date().toISOString(),
  site: "https://fairprice-global.vercel.app",
  bot: "@FairpriceSERV_bot",
  note: "Synthetic updates through the real handler with a captured sender. Demo mode is on, so no SERV or Reppo credits are spent and nobody is messaged. Hidden turns are setup only and should be omitted from the demo video.",
  chatId: chat,
  turns,
};

const dir = new URL("../reports/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const path = `${dir}telegram-transcript.json`;
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
const visible = turns.filter((t) => !t.hidden);
process.stdout.write(
  `wrote reports/telegram-transcript.json (${turns.length} turns, ${visible.length} visible, ${visible.filter((t) => t.from === "bot").length} bot replies)\n`,
);
