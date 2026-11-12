import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = join(dir, "..");
  }
  return start;
}

const root = findRoot(join(dirname(fileURLToPath(import.meta.url)), ".."));
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  config({ path: envPath, override: false, quiet: true });
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export const ROOT = root;
export const PORT = Number(readEnv("PORT") ?? "3001");
export const DEMO_DEFAULT = (readEnv("DEMO_DEFAULT") ?? "false").toLowerCase() === "true";

export function databaseUrl(): string | undefined {
  return readEnv("DATABASE_URL") ?? readEnv("POSTGRES_URL");
}

/** Hard cap on live Reppo evals per rolling 24 hours (each costs credits). */
export function reppoDailyCap(): number {
  const n = Number(readEnv("REPPO_DAILY_EVAL_CAP") ?? "10");
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

/** Optional secret Telegram sends in X-Telegram-Bot-Api-Secret-Token. */
export function telegramWebhookSecret(): string | undefined {
  return readEnv("TELEGRAM_WEBHOOK_SECRET");
}

export function servKey(): string | undefined {
  return readEnv("OPENSERV_API_KEY") ?? readEnv("SERV_API_KEY");
}

export function reppoKey(): string | undefined {
  return readEnv("REPPO_API_KEY");
}

export function telegramToken(): string | undefined {
  return readEnv("FAIRPRICE_TELEGRAM_BOT_TOKEN");
}

export function hasServ(): boolean {
  return Boolean(servKey());
}

export function hasReppo(): boolean {
  return Boolean(reppoKey());
}

export function hasTelegram(): boolean {
  return Boolean(telegramToken());
}
