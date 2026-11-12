import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "data/seed.json")) || existsSync(join(dir, ".env.example"))) return dir;
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
