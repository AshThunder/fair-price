import { telegramToken } from "./env.js";
import { handleTelegramUpdate } from "./telegram.js";

const token = telegramToken();
if (!token) {
  process.stderr.write("FAIRPRICE_TELEGRAM_BOT_TOKEN is not set.\n");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;
let offset = 0;

process.stdout.write("Fair Price Telegram long-poll started. Open the bot and send /start.\n");

async function loop() {
  while (true) {
    try {
      const url = `${API}/getUpdates?timeout=30&offset=${offset}`;
      const response = await fetch(url);
      const body = (await response.json()) as {
        ok?: boolean;
        result?: Array<{ update_id: number } & Record<string, unknown>>;
      };
      if (!body.ok || !body.result) {
        await wait(2000);
        continue;
      }
      for (const update of body.result) {
        offset = update.update_id + 1;
        await handleTelegramUpdate(update as Parameters<typeof handleTelegramUpdate>[0]);
      }
    } catch {
      await wait(2000);
    }
  }
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

void loop();
