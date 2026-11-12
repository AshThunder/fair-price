// Sets the bot command menu, descriptions, menu button, and (optionally) the webhook
// allowed_updates so callback_query reaches the handler. Prints no secrets.
// Run: npx tsx scripts/configure-telegram.ts
import { telegramToken, telegramWebhookSecret } from "../server/env.js";
import { configureTelegramBot, SITE_URL } from "../server/telegram.js";

if (!telegramToken()) {
  process.stderr.write("FAIRPRICE_TELEGRAM_BOT_TOKEN is not set.\n");
  process.exit(1);
}

const secret = telegramWebhookSecret();
const results = await configureTelegramBot({ setWebhook: true, webhookSecret: secret });

function brief(value: unknown): { ok?: boolean; description?: string; error_code?: number } {
  if (value && typeof value === "object") {
    const o = value as { ok?: boolean; description?: string; error_code?: number };
    return { ok: o.ok, description: o.description, error_code: o.error_code };
  }
  return {};
}

for (const [name, value] of Object.entries(results)) {
  process.stdout.write(`${name} ${JSON.stringify(brief(value))}\n`);
}

const token = telegramToken()!;
const hook = (await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json()) as {
  ok: boolean;
  result?: {
    url?: string;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    allowed_updates?: string[];
  };
};
process.stdout.write(
  `getWebhookInfo ${JSON.stringify({
    ok: hook.ok,
    url: hook.result?.url,
    expected: `${SITE_URL}/api/telegram`,
    pending: hook.result?.pending_update_count,
    lastError: hook.result?.last_error_message ?? null,
    allowed: hook.result?.allowed_updates ?? null,
  })}\n`,
);
