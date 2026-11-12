import { telegramToken } from "./env.js";
import { getSeed, getStore } from "./store.js";
import app from "./app.js";
import { perUnit, countryFromLocale, countryName, CURRENCY_BY_COUNTRY, findCountry, localeFor, money } from "../shared/geo.js";

const VERDICT_WORDS: Record<string, string> = {
  fair: "Fair price",
  high: "Too high",
  low: "Suspiciously low",
  uncertain: "Not sure yet, be the first to confirm",
};

const API = "https://api.telegram.org";

type ChatSession = {
  step: "idle" | "country" | "item" | "place" | "price" | "verdict";
  country?: string;
  itemText?: string;
  place?: string;
  quote?: number;
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

function keyboard(labels: string[], perRow = 2) {
  const rows: Array<Array<{ text: string }>> = [];
  for (let i = 0; i < labels.length; i += perRow) rows.push(labels.slice(i, i + perRow).map((text) => ({ text })));
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: true };
}

function countryKeyboard() {
  return keyboard(getSeed().countries.map((c) => c.name), 3);
}

function itemSuggestions(country: string): string[] {
  const seed = getSeed();
  const ids = new Set(
    seed.officialRefs.filter((r) => seed.areas.find((a) => a.id === r.areaId)?.country === country).map((r) => r.itemId),
  );
  return seed.items.filter((i) => ids.has(i.id)).slice(0, 8).map((i) => i.names?.[country] ?? i.name);
}

function placeSuggestions(country: string): string[] {
  const areas = getSeed().areas.filter((a) => a.country === country && a.kind !== "country").slice(0, 6).map((a) => a.name);
  return [...areas, "Whole country"];
}

const HELP = `Fair Price checks whether a price is fair, for anything, anywhere: market food, fuel, fares, repairs, rent, haircuts.

How it works: Fair Price's own engine computes the usual range from cited public prices and confirmed payments. SERV Reasoning by OpenServ reads your quote against that range and explains the verdict with a haggling tip. When you confirm what you paid, Reppo's Eval Router scores the check independently, and that score feeds back into how much the confirmation counts.

Send /check to start. Fair Price asks for your country once, then you can type any item and any town.

Commands:
/check: start a price check
/country: change your country (for example /country Kenya)
/board: price board for your country
/metrics: accuracy before and after confirmations
/demo on or /demo off: use seeded demo data
/help: this message`;

export async function handleTelegramUpdate(update: {
  message?: {
    chat?: { id?: number };
    text?: string;
    photo?: unknown[];
    from?: { is_bot?: boolean; language_code?: string };
  };
}): Promise<void> {
  const message = update.message;
  const chatId = message?.chat?.id;
  if (!chatId || message?.from?.is_bot) return;
  const text = (message.text ?? "").trim().slice(0, 500);
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
  const s = await loadSession(chatId);
  // Telegram language codes rarely carry a region, but use one when they do (for example pt-BR).
  if (!s.country) s.country = countryFromLocale(message.from?.language_code);
  try {
    await route(chatId, s, text, hasPhoto);
  } finally {
    await saveSession(chatId, s);
  }
}

async function say(chatId: number, text: string, reply_markup?: unknown) {
  await telegramApi("sendMessage", { chat_id: chatId, text, ...(reply_markup ? { reply_markup } : {}) });
}

async function askCountry(chatId: number, s: ChatSession) {
  s.step = "country";
  await say(chatId, "Which country are you in? Pick one or type any country name or code, for example Ghana or DE.", countryKeyboard());
}

async function askItem(chatId: number, s: ChatSession) {
  s.step = "item";
  const cc = s.country!;
  await say(
    chatId,
    `Checking a price in ${countryName(cc)} (${CURRENCY_BY_COUNTRY[cc]}). What are you buying? Type anything, for example eggs, petrol, or a haircut.`,
    keyboard(itemSuggestions(cc)),
  );
}

async function route(chatId: number, s: ChatSession, text: string, hasPhoto: boolean): Promise<void> {
  if (text === "/start" || text === "/help") {
    s.step = "idle";
    await say(chatId, HELP, { remove_keyboard: true });
    return;
  }
  if (text.startsWith("/demo")) {
    s.demo = !text.includes("off");
    await say(
      chatId,
      s.demo
        ? "Demo mode is on. Checks use seeded data and saved Reppo scores, with no live credit spend."
        : "Demo mode is off. Live checks ask SERV, and a confirmed payment is scored by Reppo.",
    );
    return;
  }
  if (text === "/metrics") {
    await sendMetrics(chatId);
    return;
  }
  if (text.startsWith("/board")) {
    await sendBoard(chatId, s, text.replace("/board", "").trim());
    return;
  }
  if (text.startsWith("/country")) {
    const cc = findCountry(text.replace("/country", ""));
    if (cc) {
      s.country = cc;
      await say(chatId, `Country set to ${countryName(cc)}. Prices are in ${CURRENCY_BY_COUNTRY[cc]}. Send /check to start.`, { remove_keyboard: true });
    } else {
      await askCountry(chatId, s);
    }
    return;
  }
  if (hasPhoto) {
    await say(chatId, "Photo received. Fair Price never sends photos anywhere. Type the amount you can see when I ask for the price.");
    return;
  }
  if (text === "/check" || (s.step === "idle" && text && !text.startsWith("/"))) {
    s.itemText = undefined;
    s.place = undefined;
    s.quote = undefined;
    if (!s.country) {
      await askCountry(chatId, s);
      return;
    }
    await askItem(chatId, s);
    if (text && text !== "/check") await captureItem(chatId, s, text);
    return;
  }
  if (s.step === "country") {
    const cc = findCountry(text);
    if (!cc) {
      await say(chatId, "I could not find that country. Try its name or two-letter code, for example Kenya or KE.", countryKeyboard());
      return;
    }
    s.country = cc;
    await askItem(chatId, s);
    return;
  }
  if (s.step === "item") {
    await captureItem(chatId, s, text);
    return;
  }
  if (s.step === "place") {
    s.place = /^(whole country|skip|-)$/i.test(text) ? undefined : text.slice(0, 60);
    s.step = "price";
    await say(chatId, `What price were you quoted, in ${CURRENCY_BY_COUNTRY[s.country!]}? Type the number only.`, { remove_keyboard: true });
    return;
  }
  if (s.step === "price" || s.step === "verdict") {
    if (text.toLowerCase().startsWith("paid")) {
      const amount = Number(text.replace(/paid/i, "").replace(/[^\d.]/g, "")) || s.quote;
      await confirmPaid(chatId, s, amount ?? 0);
      return;
    }
    await capturePrice(chatId, s, text);
  }
}

async function captureItem(chatId: number, s: ChatSession, text: string) {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 60);
  if (clean.length < 2) {
    await say(chatId, "Type what you are buying, for example tomatoes or a taxi ride.");
    return;
  }
  s.itemText = clean;
  s.step = "place";
  await say(chatId, `Where are you buying ${clean.toLowerCase()}? Type a town or city, or pick Whole country.`, keyboard(placeSuggestions(s.country!)));
}

async function capturePrice(chatId: number, s: ChatSession, text: string) {
  const quote = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(quote) || quote <= 0) {
    await say(chatId, "Please send the price as a number, for example 1900 or 4.50.");
    return;
  }
  s.quote = quote;
  const response = await app.request("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      country: s.country,
      itemText: s.itemText,
      place: s.place,
      quote,
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
      countryName: string;
      currency: string;
      locale: string;
      unit: string;
      quote: number;
      mid: number | null;
      low: number | null;
      high: number | null;
      guess: { low: number; high: number } | null;
      reasons: string[];
      tip: string;
      note?: string | null;
      servAvailable: boolean;
    };
  };
  if (!response.ok || !body.verdict) {
    await say(chatId, body.error ?? "The check could not be completed just now.");
    return;
  }
  const v = body.verdict;
  const m = (n: number) => money(n, v.currency, v.locale);
  s.verdictId = v.id;
  s.step = "verdict";
  const where = v.areaName === v.countryName ? v.countryName : `${v.areaName}, ${v.countryName}`;
  const range =
    v.low != null && v.high != null
      ? `Usual range ${m(v.low)} to ${m(v.high)}${v.mid != null ? `, middle ${m(v.mid)}` : ""}.`
      : v.guess
        ? `No local prices yet. SERV's rough guess: ${m(v.guess.low)} to ${m(v.guess.high)}. That is a guess, not local data.`
        : "No local prices yet.";
  const textOut = [
    `Verdict: ${VERDICT_WORDS[v.label] ?? v.label} for ${v.itemName} in ${where}.`,
    `Quoted ${m(v.quote)} ${perUnit(v.unit)}.`,
    range,
    "",
    v.reasons.join("\n"),
    "",
    `Tip: ${v.tip}`,
    ...(v.note ? ["", `Ada's note: ${v.note} The verdict still follows the price range.`] : []),
    "",
    v.servAvailable ? "Explained by SERV Reasoning. Range from Fair Price's engine." : "Range from Fair Price's engine. SERV was unavailable for this one.",
    `If you paid, send the amount, for example: paid ${v.quote}`,
  ].join("\n");
  await say(chatId, textOut);
}

async function confirmPaid(chatId: number, s: ChatSession, amount: number) {
  if (!s.verdictId) {
    await say(chatId, "Start with /check first.");
    return;
  }
  const response = await app.request("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verdictId: s.verdictId, kind: "paid", paid: amount, deviceId: `tg-${chatId}`, demo: s.demo }),
  });
  const body = (await response.json()) as { observation?: { status?: string }; error?: string; reppo?: { state?: string } | null };
  if (!response.ok) {
    await say(chatId, body.error ?? "Feedback could not be saved.");
    return;
  }
  const status = body.observation?.status ?? "accepted";
  const note =
    status === "rejected"
      ? "This confirmation was ignored because the same device already sent a similar price today."
      : status === "quarantine"
        ? "This confirmation was quarantined as an outlier until more nearby prices agree."
        : body.reppo?.state === "pending"
          ? "Saved. Thank you, this helps the next person nearby. Reppo is now scoring this check, and its score sets how much your confirmation counts."
          : "Saved. Thank you, this helps the next person nearby.";
  s.step = "idle";
  await say(chatId, note);
}

async function sendMetrics(chatId: number) {
  const response = await app.request("/api/metrics");
  const m = (await response.json()) as {
    benchmark: {
      totalCases: number;
      splits: Record<"test" | "dev", { seedOnly: { accuracy: number; correct: number; cases: number }; afterFeedback: { accuracy: number; correct: number; cases: number } }>;
      byCountry: Record<string, unknown>;
    };
    reppo: { completed: number; medianScore: number | null };
  };
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const t = m.benchmark.splits.test;
  const text = [
    `Benchmark: ${m.benchmark.totalCases} price cases across ${Object.keys(m.benchmark.byCountry).length} countries, held-out test split ${t.seedOnly.cases} cases.`,
    `Public figures only: ${pct(t.seedOnly.accuracy)} correct (${t.seedOnly.correct}/${t.seedOnly.cases}).`,
    `After confirmations: ${pct(t.afterFeedback.accuracy)} correct (${t.afterFeedback.correct}/${t.afterFeedback.cases}).`,
    `Reppo scored ${m.reppo.completed} confirmed checks. Median score ${m.reppo.medianScore ?? "n/a"}.`,
  ].join("\n");
  await say(chatId, text);
}

async function sendBoard(chatId: number, s: ChatSession, arg: string) {
  const want = arg.toLowerCase();
  const area = want
    ? getSeed().areas.find((a) => a.kind !== "country" && (a.name.toLowerCase() === want || a.aliases?.some((x) => x.toLowerCase() === want)))
    : undefined;
  const cc = area?.country ?? findCountry(arg) ?? s.country ?? "NG";
  const query = area ? `areaId=${encodeURIComponent(area.id)}` : `country=${encodeURIComponent(cc)}`;
  const response = await app.request(`/api/board?${query}&demo=${s.demo ? 1 : 0}`);
  const body = (await response.json()) as {
    rows: Array<{ itemName: string; unit: string; mid: number | null; low: number | null; high: number | null }>;
    area: { name: string; currency: string; locale: string };
  };
  const m = (n: number) => money(n, body.area.currency, body.area.locale ?? localeFor(cc));
  const lines = [`Price board for ${body.area.name}, ${body.area.currency}. Middle and usual range.`, ""];
  for (const row of body.rows) {
    lines.push(
      row.mid == null
        ? `${row.itemName}: be the first to confirm a price.`
        : `${row.itemName} ${perUnit(row.unit)}: ${m(row.mid)} (${m(row.low ?? 0)} to ${m(row.high ?? 0)})`,
    );
  }
  if (body.rows.length === 0) lines.push("No prices here yet. Send /check and confirm what you pay to start one.");
  await say(chatId, lines.join("\n"));
}
