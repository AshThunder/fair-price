import { telegramToken } from "./env.js";
import { getSeed, getStore } from "./store.js";
import app from "./app.js";
import { naira } from "../shared/engine.js";

const VERDICT_WORDS: Record<string, string> = {
  fair: "Fair price",
  high: "Too high",
  low: "Suspiciously low",
  uncertain: "Not sure yet",
};

const API = "https://api.telegram.org";

type ChatSession = {
  step: "idle" | "item" | "area" | "price" | "verdict";
  itemId?: string;
  areaId?: string;
  quoteNaira?: number;
  verdictId?: string;
  demo: boolean;
};

function token(): string {
  const t = telegramToken();
  if (!t) throw new Error("Telegram token is not configured.");
  return t;
}

export type TelegramSender = (method: string, body: Record<string, unknown>) => Promise<unknown>;

async function httpSender(method: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return response.json();
}

let sender: TelegramSender = httpSender;

/** Swap the outbound transport (tests feed synthetic updates without messaging anyone). */
export function setTelegramSender(next: TelegramSender | null): void {
  sender = next ?? httpSender;
}

export async function telegramApi(method: string, body: Record<string, unknown>): Promise<unknown> {
  return sender(method, body);
}

// Sessions live in the database so webhook calls on different serverless
// instances see the same conversation state.
async function loadSession(chatId: number): Promise<ChatSession> {
  const store = await getStore();
  return (await store.getSession<ChatSession>(String(chatId))) ?? { step: "idle", demo: false };
}

async function saveSession(chatId: number, s: ChatSession): Promise<void> {
  const store = await getStore();
  await store.setSession(String(chatId), s);
}

function itemKeyboard() {
  const items = getSeed().items;
  return {
    keyboard: chunk(
      items.map((i) => ({ text: i.name })),
      2,
    ),
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function areaKeyboard() {
  const areas = getSeed().areas.filter((a) => a.kind === "state" || a.kind === "national");
  return {
    keyboard: chunk(
      areas.map((a) => ({ text: a.name })),
      2,
    ),
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const HELP = `Fair Price checks whether a stall, pump, fare, repair, or rent quote is fair for your area.

Send /check to start. You can also send a photo of a price and then type the amount so you can confirm it.

Commands:
/check — start a price check
/board — area price board
/metrics — seed-only versus after-feedback accuracy
/demo on or /demo off — use seeded demo data
/help — this message

Official figures are dated NBS monthly averages, not live stall prices.`;

export async function handleTelegramUpdate(update: {
  message?: {
    chat?: { id?: number };
    text?: string;
    photo?: unknown[];
    from?: { is_bot?: boolean };
  };
}): Promise<void> {
  const message = update.message;
  const chatId = message?.chat?.id;
  if (!chatId || message?.from?.is_bot) return;
  const text = (message.text ?? "").trim().slice(0, 500);
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
  const s = await loadSession(chatId);
  try {
    await route(chatId, s, text, hasPhoto);
  } finally {
    await saveSession(chatId, s);
  }
}

async function route(chatId: number, s: ChatSession, text: string, hasPhoto: boolean): Promise<void> {

  if (text === "/start" || text === "/help") {
    s.step = "idle";
    await telegramApi("sendMessage", { chat_id: chatId, text: HELP, reply_markup: { remove_keyboard: true } });
    return;
  }
  if (text.startsWith("/demo")) {
    s.demo = !text.includes("off");
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: s.demo
        ? "Demo mode is on. Checks use seeded data and pre-completed evals, with no live credit spend."
        : "Demo mode is off. Live checks ask SERV, and a confirmed payment is scored by Reppo.",
    });
    return;
  }
  if (text === "/metrics") {
    await sendMetrics(chatId);
    return;
  }
  if (text.startsWith("/board")) {
    await sendBoard(chatId, text.replace("/board", "").trim());
    return;
  }
  if (text === "/check" || s.step === "idle" && !hasPhoto && text && !text.startsWith("/")) {
    s.step = "item";
    s.itemId = undefined;
    s.areaId = undefined;
    s.quoteNaira = undefined;
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Which item are you checking?",
      reply_markup: itemKeyboard(),
    });
    if (text && text !== "/check") {
      await maybeCaptureItem(chatId, s, text);
    }
    return;
  }
  if (hasPhoto) {
    s.step = s.itemId ? (s.areaId ? "price" : "area") : "item";
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Photo received. Fair Price never sends photos to SERV or Reppo. Type the amount you can see, after you pick the item and area.",
      reply_markup: s.itemId ? (s.areaId ? undefined : areaKeyboard()) : itemKeyboard(),
    });
    return;
  }
  if (s.step === "item") {
    await maybeCaptureItem(chatId, s, text);
    return;
  }
  if (s.step === "area") {
    await maybeCaptureArea(chatId, s, text);
    return;
  }
  if (s.step === "price" || s.step === "verdict") {
    if (text.toLowerCase().startsWith("paid")) {
      const amount = Number(text.replace(/paid/i, "").replace(/[^\d.]/g, "")) || s.quoteNaira;
      await confirmPaid(chatId, s, amount ?? 0);
      return;
    }
    await maybeCapturePrice(chatId, s, text);
  }
}

async function maybeCaptureItem(chatId: number, s: ChatSession, text: string) {
  const seed = getSeed();
  const item = seed.items.find((i) => i.name.toLowerCase() === text.toLowerCase() || i.id === text);
  if (!item) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Please pick an item from the list.",
      reply_markup: itemKeyboard(),
    });
    return;
  }
  s.itemId = item.id;
  s.step = "area";
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: `Checking ${item.name} per ${item.unit}. Which area?`,
    reply_markup: areaKeyboard(),
  });
}

async function maybeCaptureArea(chatId: number, s: ChatSession, text: string) {
  const seed = getSeed();
  const area = seed.areas.find((a) => a.name.toLowerCase() === text.toLowerCase() || a.id === text);
  if (!area) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Please pick an area from the list.",
      reply_markup: areaKeyboard(),
    });
    return;
  }
  s.areaId = area.id;
  s.step = "price";
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: "What price were you quoted, in naira? Type the number only.",
    reply_markup: { remove_keyboard: true },
  });
}

async function maybeCapturePrice(chatId: number, s: ChatSession, text: string) {
  const quote = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(quote) || quote <= 0) {
    await telegramApi("sendMessage", { chat_id: chatId, text: "Please send the price as a number, for example 1900." });
    return;
  }
  s.quoteNaira = quote;
  const response = await app.request("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId: s.itemId,
      areaId: s.areaId,
      quoteNaira: quote,
      deviceId: `tg-${chatId}`,
      demo: s.demo,
      source: "telegram",
    }),
  });
  const body = (await response.json()) as {
    error?: string;
    verdict?: {
      id: string;
      label: string;
      itemName: string;
      areaName: string;
      unit: string;
      quoteNaira: number;
      mid: number | null;
      low: number | null;
      high: number | null;
      reasons: string[];
      tip: string;
      note?: string | null;
    };
  };
  if (!response.ok || !body.verdict) {
    await telegramApi("sendMessage", { chat_id: chatId, text: body.error ?? "The check could not be completed just now." });
    return;
  }
  const v = body.verdict;
  s.verdictId = v.id;
  s.step = "verdict";
  const range =
    v.low != null && v.high != null
      ? `Usual range ${naira(v.low)} to ${naira(v.high)}${v.mid != null ? `, middle ${naira(v.mid)}` : ""}.`
      : "No tight range yet.";
  const textOut = [
    `Verdict: ${VERDICT_WORDS[v.label] ?? v.label} for ${v.itemName} in ${v.areaName}.`,
    `Quoted ${naira(v.quoteNaira)} per ${v.unit}.`,
    range,
    "",
    v.reasons.join("\n"),
    "",
    `Tip: ${v.tip}`,
    ...(v.note ? ["", `Ada's note: ${v.note} The verdict still follows the price range.`] : []),
    "",
    `If you paid, send the amount, for example: paid ${Math.round(v.quoteNaira)}`,
  ].join("\n");
  await telegramApi("sendMessage", { chat_id: chatId, text: textOut });
}

async function confirmPaid(chatId: number, s: ChatSession, amount: number) {
  if (!s.verdictId) {
    await telegramApi("sendMessage", { chat_id: chatId, text: "Start with /check first." });
    return;
  }
  const response = await app.request("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verdictId: s.verdictId,
      kind: "paid",
      paidNaira: amount,
      deviceId: `tg-${chatId}`,
      demo: s.demo,
    }),
  });
  const body = (await response.json()) as { observation?: { status?: string }; error?: string };
  if (!response.ok) {
    await telegramApi("sendMessage", { chat_id: chatId, text: body.error ?? "Feedback could not be saved." });
    return;
  }
  const status = body.observation?.status ?? "accepted";
  const note =
    status === "rejected"
      ? "This confirmation was ignored because the same device already sent a similar price today."
      : status === "quarantine"
        ? "This confirmation was quarantined as an outlier until more nearby prices agree."
        : "Saved. Thank you, this helps the next person in your area.";
  s.step = "idle";
  await telegramApi("sendMessage", { chat_id: chatId, text: note });
}

async function sendMetrics(chatId: number) {
  const response = await app.request("/api/metrics");
  const m = (await response.json()) as {
    benchmark: {
      totalCases: number;
      splits: Record<"test" | "dev", { seedOnly: { accuracy: number; correct: number; cases: number }; afterFeedback: { accuracy: number; correct: number; cases: number } }>;
    };
    reppo: { completed: number; medianScore: number | null };
  };
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const t = m.benchmark.splits.test;
  const text = [
    `Benchmark: ${m.benchmark.totalCases} Nigerian price cases, held-out test split ${t.seedOnly.cases} cases.`,
    `Seed data only: ${pct(t.seedOnly.accuracy)} correct (${t.seedOnly.correct}/${t.seedOnly.cases}).`,
    `After confirmations: ${pct(t.afterFeedback.accuracy)} correct (${t.afterFeedback.correct}/${t.afterFeedback.cases}).`,
    `Reppo checked ${m.reppo.completed} verdicts. Median score ${m.reppo.medianScore ?? "n/a"}.`,
  ].join("\n");
  await telegramApi("sendMessage", { chat_id: chatId, text });
}

async function sendBoard(chatId: number, areaName: string) {
  const seed = getSeed();
  const area =
    seed.areas.find((a) => a.name.toLowerCase() === areaName.toLowerCase() || a.id === areaName) ??
    seed.areas.find((a) => a.id === "NG")!;
  const response = await app.request(`/api/board?areaId=${encodeURIComponent(area.id)}`);
  const body = (await response.json()) as {
    rows: Array<{ itemName: string; unit: string; mid: number | null; low: number | null; high: number | null }>;
    area: { name: string };
  };
  const lines = [`Price board for ${body.area.name}. Midpoint and range, naira.`, ""];
  for (const row of body.rows) {
    if (row.mid == null) {
      lines.push(`${row.itemName}: not enough evidence yet.`);
    } else {
      lines.push(`${row.itemName} per ${row.unit}: ${Math.round(row.mid)} (${Math.round(row.low ?? 0)}–${Math.round(row.high ?? 0)})`);
    }
  }
  await telegramApi("sendMessage", { chat_id: chatId, text: lines.join("\n") });
}
