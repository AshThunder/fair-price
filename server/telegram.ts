import { telegramToken } from "./env.js";
import { getSeed } from "./store.js";
import app from "./app.js";

const API = "https://api.telegram.org";

type ChatSession = {
  step: "idle" | "item" | "area" | "price" | "verdict";
  itemId?: string;
  areaId?: string;
  quoteNaira?: number;
  verdictId?: string;
  demo: boolean;
};

const sessions = new Map<number, ChatSession>();

function token(): string {
  const t = telegramToken();
  if (!t) throw new Error("Telegram token is not configured.");
  return t;
}

export async function telegramApi(method: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

function session(chatId: number): ChatSession {
  const existing = sessions.get(chatId);
  if (existing) return existing;
  const fresh: ChatSession = { step: "idle", demo: false };
  sessions.set(chatId, fresh);
  return fresh;
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

Official figures are May 2026 averages from the National Bureau of Statistics, not live stall prices.`;

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
  const text = (message.text ?? "").trim();
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
  const s = session(chatId);

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
        : "Demo mode is off. Live checks will call SERV and may queue a Reppo eval.",
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
      ? `Range ${Math.round(v.low)} to ${Math.round(v.high)} naira per ${v.unit}. Midpoint ${v.mid != null ? Math.round(v.mid) : "n/a"}.`
      : "No tight range yet.";
  const textOut = [
    `Verdict: ${v.label.toUpperCase()} for ${v.itemName} in ${v.areaName}.`,
    `Quoted ${Math.round(v.quoteNaira)} naira per ${v.unit}.`,
    range,
    "",
    v.reasons.join("\n"),
    "",
    `Tip: ${v.tip}`,
    "",
    "If you paid, send: paid 1900 (use the amount you actually paid).",
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
        : "Saved. Thank you — this helps the next person in your area.";
  s.step = "idle";
  await telegramApi("sendMessage", { chat_id: chatId, text: note });
}

async function sendMetrics(chatId: number) {
  const response = await app.request("/api/metrics");
  const m = (await response.json()) as {
    seedOnly: { agreementRate: number; agreed: number; cases: number; mape: number | null };
    afterFeedback: { agreementRate: number; agreed: number; cases: number; mape: number | null; medianReppoScore: number | null; reppoCount: number };
  };
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const mape = (n: number | null) => (n == null ? "n/a" : `${(n * 100).toFixed(1)}%`);
  const text = [
    "Fixed benchmark (10 held-out cases).",
    `Seed only: ${pct(m.seedOnly.agreementRate)} agreement (${m.seedOnly.agreed}/${m.seedOnly.cases}), MAPE ${mape(m.seedOnly.mape)}.`,
    `After feedback: ${pct(m.afterFeedback.agreementRate)} agreement (${m.afterFeedback.agreed}/${m.afterFeedback.cases}), MAPE ${mape(m.afterFeedback.mape)}.`,
    `Reppo completed evals: ${m.afterFeedback.reppoCount}. Median score: ${m.afterFeedback.medianReppoScore ?? "n/a"}.`,
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
