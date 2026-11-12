import { telegramToken } from "./env.js";
import { getSeed, getStore } from "./store.js";
import app from "./app.js";
import {
  perUnit,
  countryFromLocale,
  countryName,
  CURRENCY_BY_COUNTRY,
  findCountry,
  itemUnit,
  localeFor,
  money,
  resolveItem,
  unitOptions,
} from "../shared/geo.js";

const VERDICT_WORDS: Record<string, string> = {
  fair: "Fair price",
  high: "Too high",
  low: "Suspiciously low",
  uncertain: "Not sure yet, be the first to confirm",
};

const STACK_LINE: Record<string, string> = {
  fair: "Inside the usual range",
  high: "Above the usual range",
  low: "Below the usual range",
  uncertain: "Not enough local prices for a range",
};

export const SITE_URL = (process.env.FAIRPRICE_PUBLIC_URL ?? "https://fairprice-global.vercel.app").replace(/\/$/, "");

export const MENU = {
  check: "Check a price",
  board: "Price board",
  how: "How it works",
  country: "Change country",
  metrics: "Accuracy",
} as const;

const TYPE_ITEM = "Something else";
const TYPE_UNIT = "Type a unit";
const TYPE_PLACE = "Type a city";
const WHOLE_COUNTRY = "Whole country";

/** Seeded countries first, then a few more people often pick, plus Other as a button. */
const COMMON_COUNTRIES = ["NG", "US", "GB", "IN", "KE", "BR", "GH", "ZA", "CA"];

export const BOT_SHORT_DESCRIPTION = "A fair price check for anything, anywhere. Know before you pay.";

export const BOT_DESCRIPTION =
  "Fair Price checks whether a quoted price is fair, for anything, anywhere, in local currency. The Fair Price engine finds the usual range from cited public prices and confirmed payments. SERV Reasoning by OpenServ explains the verdict. When you confirm what you paid, Reppo's Eval Router scores the check independently, and that score sets how much the confirmation counts.";

const API = "https://api.telegram.org";

type Step = "idle" | "country" | "item" | "unit" | "place" | "price" | "verdict" | "paid";

type ChatSession = {
  step: Step;
  country?: string;
  itemText?: string;
  unit?: string;
  place?: string;
  quote?: number;
  verdictId?: string;
  reppoMessageId?: number;
  afterCountry?: "check" | "menu";
  demo: boolean;
};

type TelegramMessage = {
  message_id?: number;
  chat?: { id?: number };
  text?: string;
  photo?: unknown[];
  from?: { is_bot?: boolean; language_code?: string };
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    data?: string;
    from?: { is_bot?: boolean; language_code?: string };
    message?: TelegramMessage;
  };
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

export async function configureTelegramBot(opts?: { setWebhook?: boolean; webhookSecret?: string }): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  results.setMyCommands = await telegramApi("setMyCommands", {
    commands: [{ command: "start", description: "Open Fair Price" }],
  });
  results.setMyShortDescription = await telegramApi("setMyShortDescription", { short_description: BOT_SHORT_DESCRIPTION });
  results.setMyDescription = await telegramApi("setMyDescription", { description: BOT_DESCRIPTION });
  const menu = await telegramApi("setChatMenuButton", {
    menu_button: { type: "web_app", text: "Open Fair Price", web_app: { url: SITE_URL } },
  });
  results.setChatMenuButton = menu;
  if (menu && typeof menu === "object" && (menu as { ok?: boolean }).ok === false) {
    results.setChatMenuButtonFallback = await telegramApi("setChatMenuButton", { menu_button: { type: "commands" } });
  }
  if (opts?.setWebhook) {
    const body: Record<string, unknown> = {
      url: `${SITE_URL}/api/telegram`,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    };
    if (opts.webhookSecret) body.secret_token = opts.webhookSecret;
    results.setWebhook = await telegramApi("setWebhook", body);
  }
  return results;
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

function unique(list: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const t = item?.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

function replyKeyboard(labels: string[], perRow = 2, persistent = false) {
  const rows: Array<Array<{ text: string }>> = [];
  for (let i = 0; i < labels.length; i += perRow) rows.push(labels.slice(i, i + perRow).map((text) => ({ text })));
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: !persistent, is_persistent: persistent };
}

function mainMenuKeyboard() {
  return replyKeyboard([MENU.check, MENU.board, MENU.how, MENU.country, MENU.metrics], 2, true);
}

function inline(rows: Array<Array<{ text: string; callback_data?: string; url?: string }>>) {
  return { inline_keyboard: rows };
}

function countryKeyboard() {
  const buttons = COMMON_COUNTRIES.map((code) => ({ text: countryName(code), callback_data: `cc:${code}` }));
  buttons.push({ text: "Other", callback_data: "cc:_other" });
  const rows: Array<typeof buttons> = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  return inline(rows);
}

function urlButton(text: string, path: string) {
  return inline([[{ text, url: `${SITE_URL}${path}` }]]);
}

function verdictKeyboard() {
  return inline([
    [
      { text: "I paid this", callback_data: "fb:paid" },
      { text: "Looks fair", callback_data: "fb:fair" },
      { text: "Looks off", callback_data: "fb:off" },
    ],
    [
      { text: "Check another", callback_data: "fb:again" },
      { text: "Main menu", callback_data: "fb:menu" },
    ],
  ]);
}

function reppoKeyboard() {
  return inline([
    [{ text: "Refresh score", callback_data: "rp:refresh" }],
    [
      { text: "Check another", callback_data: "fb:again" },
      { text: "Main menu", callback_data: "fb:menu" },
    ],
  ]);
}

function paidAmountKeyboard(quote: number, currency: string, locale: string) {
  return inline([
    [{ text: `I paid ${money(quote, currency, locale)}`, callback_data: "fb:quoted" }],
    [{ text: "Main menu", callback_data: "fb:menu" }],
  ]);
}

function itemSuggestions(country: string): string[] {
  const seed = getSeed();
  const ids = new Set(
    seed.officialRefs.filter((r) => seed.areas.find((a) => a.id === r.areaId)?.country === country).map((r) => r.itemId),
  );
  const fromSeed = seed.items.filter((i) => ids.has(i.id)).slice(0, 8).map((i) => i.names?.[country] ?? i.name);
  if (fromSeed.length >= 3) return fromSeed;
  return unique([...fromSeed, "Eggs", "Petrol", "Bread", "Milk", "A haircut", "Monthly rent"]).slice(0, 8);
}

function unitSuggestions(country: string, itemText?: string): string[] {
  const seed = getSeed();
  const item = itemText ? resolveItem(seed.items, { text: itemText, country }) : undefined;
  const usual = item && !item.custom ? itemUnit(item, country) : undefined;
  return unique([usual, ...unitOptions(country)]).slice(0, 8);
}

function placeSuggestions(country: string): string[] {
  const areas = getSeed().areas.filter((a) => a.country === country && a.kind !== "country");
  // Prefer cities and named states over wide zones so the buttons stay useful.
  const preferred = areas.filter((a) => !a.id.includes("-Z-"));
  const names = (preferred.length ? preferred : areas).slice(0, 6).map((a) => a.name);
  return unique([...names, WHOLE_COUNTRY, TYPE_PLACE]);
}

const WELCOME = `Ada here. Fair Price checks whether a quoted price is fair, for anything, anywhere, in local currency.

The Fair Price engine finds the usual range from cited public prices and confirmed payments. SERV Reasoning by OpenServ explains the verdict. When you confirm what you paid, Reppo's Eval Router scores the check independently, and that score sets how much the confirmation counts.

Pick a button to start.`;

const HOW_IT_WORKS = `How Fair Price works

1. Fair Price engine finds the usual range from cited public prices and confirmed payments in your currency. It never mixes currencies.

2. SERV Reasoning by OpenServ reads your quote against that range and explains the verdict, with a haggling tip.

3. When you confirm what you paid, Reppo's Eval Router scores the check independently. High scores raise how much that confirmation counts, low scores cut it.

Open the site for the full walk-through.`;

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const callback = update.callback_query;
  if (callback) {
    const chatId = callback.message?.chat?.id;
    if (!chatId || callback.from?.is_bot) {
      if (callback.id) await telegramApi("answerCallbackQuery", { callback_query_id: callback.id });
      return;
    }
    const s = await loadSession(chatId);
    if (!s.country) s.country = countryFromLocale(callback.from?.language_code);
    try {
      await handleCallback(chatId, s, callback);
    } finally {
      await saveSession(chatId, s);
    }
    return;
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  if (!chatId || message?.from?.is_bot) return;
  const text = (message.text ?? "").trim().slice(0, 500);
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
  const s = await loadSession(chatId);
  if (!s.country) s.country = countryFromLocale(message.from?.language_code);
  try {
    await route(chatId, s, text, hasPhoto);
  } finally {
    await saveSession(chatId, s);
  }
}

async function say(chatId: number, text: string, reply_markup?: unknown): Promise<number | undefined> {
  const res = (await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(reply_markup ? { reply_markup } : {}),
  })) as { result?: { message_id?: number } } | undefined;
  return res?.result?.message_id;
}

async function edit(chatId: number, messageId: number | undefined, text: string, reply_markup?: unknown): Promise<void> {
  if (!messageId) {
    await say(chatId, text, reply_markup);
    return;
  }
  await telegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(reply_markup ? { reply_markup } : {}),
  });
}

async function answer(callbackId: string, text?: string): Promise<void> {
  await telegramApi("answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

async function sendWelcome(chatId: number, s: ChatSession) {
  s.step = "idle";
  const countryLine = s.country
    ? `\n\nYour country is set to ${countryName(s.country)} (${CURRENCY_BY_COUNTRY[s.country]}). You can change it any time.`
    : "";
  await say(chatId, WELCOME + countryLine, mainMenuKeyboard());
}

async function askCountry(chatId: number, s: ChatSession, next: "check" | "menu") {
  s.step = "country";
  s.afterCountry = next;
  await say(chatId, "Which country are you in? Pick one, or tap Other and type any country name or code, for example Ghana or DE.", countryKeyboard());
}

async function askItem(chatId: number, s: ChatSession) {
  s.step = "item";
  const cc = s.country!;
  const suggestions = itemSuggestions(cc);
  await say(
    chatId,
    `Checking a price in ${countryName(cc)} (${CURRENCY_BY_COUNTRY[cc]}). What are you buying? Pick a common item or type anything, for example eggs, petrol, or a haircut.`,
    replyKeyboard([...suggestions, TYPE_ITEM]),
  );
}

async function startCheck(chatId: number, s: ChatSession) {
  s.itemText = undefined;
  s.unit = undefined;
  s.place = undefined;
  s.quote = undefined;
  s.verdictId = undefined;
  s.reppoMessageId = undefined;
  if (!s.country) {
    await askCountry(chatId, s, "check");
    return;
  }
  await askItem(chatId, s);
}

async function handleCallback(
  chatId: number,
  s: ChatSession,
  callback: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const data = (callback.data ?? "").slice(0, 64);
  const id = callback.id;

  if (data.startsWith("cc:")) {
    const code = data.slice(3);
    if (code === "_other") {
      s.step = "country";
      await answer(id);
      await say(chatId, "Type any country name or two-letter code, for example Ghana or DE.");
      return;
    }
    if (!CURRENCY_BY_COUNTRY[code]) {
      await answer(id, "I could not use that country.");
      return;
    }
    s.country = code;
    await answer(id, `Country set to ${countryName(code)}.`);
    const next = s.afterCountry ?? "check";
    s.afterCountry = undefined;
    if (next === "menu") {
      await sendWelcome(chatId, s);
    } else {
      await askItem(chatId, s);
    }
    return;
  }

  if (data === "fb:paid") {
    await answer(id);
    await askPaidAmount(chatId, s);
    return;
  }
  if (data === "fb:quoted") {
    await answer(id);
    await confirmPaid(chatId, s, s.quote ?? 0);
    return;
  }
  if (data === "fb:fair" || data === "fb:off") {
    await answer(id);
    await sendSoftFeedback(chatId, s, data === "fb:fair" ? "fair" : "not-fair");
    return;
  }
  if (data === "fb:again") {
    await answer(id);
    await startCheck(chatId, s);
    return;
  }
  if (data === "fb:menu") {
    await answer(id);
    await sendWelcome(chatId, s);
    return;
  }
  if (data === "rp:refresh") {
    await refreshReppoScore(chatId, s, id, callback.message?.message_id);
    return;
  }

  await answer(id);
}

async function route(chatId: number, s: ChatSession, text: string, hasPhoto: boolean): Promise<void> {
  if (text === "/start" || text === "/help") {
    await sendWelcome(chatId, s);
    return;
  }
  if (text.startsWith("/demo")) {
    s.demo = !text.includes("off");
    await say(
      chatId,
      s.demo
        ? "Demo mode is on. Checks use seeded data and saved Reppo scores, with no live credit spend."
        : "Demo mode is off. Live checks ask SERV, and a confirmed payment is scored by Reppo.",
      mainMenuKeyboard(),
    );
    return;
  }
  if (text === MENU.metrics || text === "/metrics") {
    await sendMetrics(chatId);
    return;
  }
  if (text === MENU.board || text.startsWith("/board")) {
    await sendBoard(chatId, s, text === MENU.board ? "" : text.replace("/board", "").trim());
    return;
  }
  if (text === MENU.how) {
    await say(chatId, HOW_IT_WORKS, urlButton("How it works on the web", "/how"));
    return;
  }
  if (text === MENU.country || text.startsWith("/country")) {
    if (text.startsWith("/country")) {
      const cc = findCountry(text.replace("/country", ""));
      if (cc) {
        s.country = cc;
        s.step = "idle";
        await say(chatId, `Country set to ${countryName(cc)}. Prices are in ${CURRENCY_BY_COUNTRY[cc]}.`, mainMenuKeyboard());
        return;
      }
    }
    await askCountry(chatId, s, "menu");
    return;
  }
  if (hasPhoto) {
    await say(chatId, "Photo received. Fair Price never sends photos anywhere. Type the amount you can see when I ask for the price.");
    return;
  }
  if (text === MENU.check || text === "/check") {
    await startCheck(chatId, s);
    return;
  }

  if (s.step === "country") {
    const cc = findCountry(text);
    if (!cc) {
      await say(chatId, "I could not find that country. Try its name or two-letter code, for example Kenya or KE.", countryKeyboard());
      return;
    }
    s.country = cc;
    const next = s.afterCountry ?? "check";
    s.afterCountry = undefined;
    if (next === "menu") {
      await sendWelcome(chatId, s);
    } else {
      await askItem(chatId, s);
    }
    return;
  }

  if (s.step === "idle" && text && !text.startsWith("/")) {
    if (!s.country) {
      await startCheck(chatId, s);
      return;
    }
    await startCheck(chatId, s);
    await captureItem(chatId, s, text);
    return;
  }

  if (s.step === "item") {
    if (text === TYPE_ITEM) {
      await say(chatId, "Type what you are buying, for example tomatoes or a taxi ride.");
      return;
    }
    await captureItem(chatId, s, text);
    return;
  }
  if (s.step === "unit") {
    if (text === TYPE_UNIT) {
      await say(chatId, "Type the unit, for example 1 kg, 1 litre, or per trip.");
      return;
    }
    await captureUnit(chatId, s, text);
    return;
  }
  if (s.step === "place") {
    if (text === TYPE_PLACE) {
      await say(chatId, "Type a town or city name.");
      return;
    }
    s.place = /^(whole country|skip|-)$/i.test(text) ? undefined : text.slice(0, 60);
    s.step = "price";
    await say(chatId, `What price were you quoted, in ${CURRENCY_BY_COUNTRY[s.country!]}? Type the number only.`, { remove_keyboard: true });
    return;
  }
  if (s.step === "price" || s.step === "verdict" || s.step === "paid") {
    if (text.toLowerCase().startsWith("paid")) {
      const amount = Number(text.replace(/paid/i, "").replace(/[^\d.]/g, "")) || s.quote;
      await confirmPaid(chatId, s, amount ?? 0);
      return;
    }
    if (s.step === "paid") {
      await capturePaidAmount(chatId, s, text);
      return;
    }
    if (s.step === "verdict" && !/^\s*[\d.,]+/.test(text)) {
      await say(chatId, "Pick a button under the verdict, or type paid and the amount you paid.", verdictKeyboard());
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
  s.step = "unit";
  const units = unitSuggestions(s.country!, clean);
  await say(
    chatId,
    `What unit is that price for? ${clean} is often priced ${perUnit(units[0] ?? "each")}. Pick one or type a unit.`,
    replyKeyboard([...units, TYPE_UNIT]),
  );
}

async function captureUnit(chatId: number, s: ChatSession, text: string) {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 24);
  if (clean.length < 1) {
    await say(chatId, "Pick or type a unit, for example 1 kg or per trip.");
    return;
  }
  s.unit = clean;
  s.step = "place";
  await say(
    chatId,
    `Where are you buying ${s.itemText!.toLowerCase()}? Pick a place, type a town or city, or choose ${WHOLE_COUNTRY}.`,
    replyKeyboard(placeSuggestions(s.country!)),
  );
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
      unit: s.unit,
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
      demo?: boolean;
      reppo?: { state?: string } | null;
    };
  };
  if (!response.ok || !body.verdict) {
    await say(chatId, body.error ?? "The check could not be completed just now.", mainMenuKeyboard());
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
  const stack = [
    STACK_LINE[v.label] ?? "",
    "Range by Fair Price engine",
    v.demo ? "Demo text, no SERV call" : v.servAvailable ? "Explained by SERV" : "SERV unavailable",
    v.reppo?.state === "checked" ? "Scored by Reppo" : "Reppo scores it once you confirm",
  ]
    .filter(Boolean)
    .join(". ");
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
    `${stack}.`,
    "If you paid, tap I paid this, or send the amount, for example: paid " + String(v.quote),
  ].join("\n");
  await say(chatId, textOut, verdictKeyboard());
}

async function askPaidAmount(chatId: number, s: ChatSession) {
  if (!s.verdictId || !s.quote || !s.country) {
    await say(chatId, "Start with a price check first.", mainMenuKeyboard());
    return;
  }
  s.step = "paid";
  const currency = CURRENCY_BY_COUNTRY[s.country];
  const locale = localeFor(s.country);
  await say(
    chatId,
    `What did you pay, in ${currency}? Type the number, or tap the quoted amount.`,
    paidAmountKeyboard(s.quote, currency, locale),
  );
}

async function capturePaidAmount(chatId: number, s: ChatSession, text: string) {
  const amount = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    await say(chatId, "Please send what you paid as a number, for example 1900 or 4.50.");
    return;
  }
  await confirmPaid(chatId, s, amount);
}

async function confirmPaid(chatId: number, s: ChatSession, amount: number) {
  if (!s.verdictId) {
    await say(chatId, "Start with a price check first.", mainMenuKeyboard());
    return;
  }
  const response = await app.request("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verdictId: s.verdictId, kind: "paid", paid: amount, deviceId: `tg-${chatId}`, demo: s.demo }),
  });
  const body = (await response.json()) as {
    observation?: { status?: string };
    error?: string;
    reppo?: { state?: string } | null;
  };
  if (!response.ok) {
    await say(chatId, body.error ?? "Feedback could not be saved.", verdictKeyboard());
    return;
  }
  const status = body.observation?.status ?? "accepted";
  if (status === "rejected") {
    s.step = "idle";
    await say(
      chatId,
      "This confirmation was ignored because the same device already sent a similar price today.",
      mainMenuKeyboard(),
    );
    return;
  }
  if (status === "quarantine") {
    s.step = "idle";
    await say(
      chatId,
      "This confirmation was quarantined as an outlier until more nearby prices agree.",
      mainMenuKeyboard(),
    );
    return;
  }
  if (body.reppo?.state === "pending") {
    s.step = "idle";
    const mid = await say(
      chatId,
      "Saved. Thank you, this helps the next person nearby. Reppo is scoring this, about a minute.",
      reppoKeyboard(),
    );
    s.reppoMessageId = mid;
    return;
  }
  s.step = "idle";
  const scored = await currentReppoLine(s.verdictId);
  await say(
    chatId,
    scored
      ? `Saved. Thank you, this helps the next person nearby. ${scored}`
      : "Saved. Thank you, this helps the next person nearby.",
    mainMenuKeyboard(),
  );
}

async function currentReppoLine(verdictId: string): Promise<string | null> {
  const response = await app.request(`/api/verdict/${verdictId}`);
  if (!response.ok) return null;
  const body = (await response.json()) as {
    verdict?: { reppo?: { state?: string; score?: number | null; decision?: string | null } | null };
  };
  return formatReppo(body.verdict?.reppo);
}

function formatReppo(reppo?: { state?: string; score?: number | null; decision?: string | null } | null): string | null {
  if (!reppo) return null;
  if (reppo.state === "checked") {
    const score = reppo.score != null ? `${Math.round(reppo.score)}/100` : "a score";
    const decision = reppo.decision ? `, ${reppo.decision}` : "";
    return `Reppo scored this check: ${score}${decision}.`;
  }
  if (reppo.state === "failed") return "Reppo could not score this check. Your confirmation is still saved.";
  return null;
}

async function refreshReppoScore(
  chatId: number,
  s: ChatSession,
  callbackId: string,
  messageId?: number,
): Promise<void> {
  if (!s.verdictId) {
    await answer(callbackId, "Start with a price check first.");
    return;
  }
  const response = await app.request(`/api/verdict/${s.verdictId}`);
  const body = (await response.json()) as {
    verdict?: { reppo?: { state?: string; score?: number | null; decision?: string | null } | null };
  };
  const reppo = body.verdict?.reppo;
  if (!reppo || reppo.state === "pending") {
    await answer(callbackId, "Still scoring, about a minute. Tap Refresh score again shortly.");
    return;
  }
  const line = formatReppo(reppo) ?? "Your confirmation is saved.";
  await answer(callbackId, reppo.state === "checked" ? "Score is in." : "Update is in.");
  const mid = messageId ?? s.reppoMessageId;
  s.step = "idle";
  await edit(chatId, mid, `Saved. Thank you, this helps the next person nearby. ${line}`, mainMenuFollowupInline());
}

function mainMenuFollowupInline() {
  return inline([
    [
      { text: "Check another", callback_data: "fb:again" },
      { text: "Main menu", callback_data: "fb:menu" },
    ],
  ]);
}

async function sendSoftFeedback(chatId: number, s: ChatSession, kind: "fair" | "not-fair") {
  if (!s.verdictId) {
    await say(chatId, "Start with a price check first.", mainMenuKeyboard());
    return;
  }
  const response = await app.request("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verdictId: s.verdictId, kind, deviceId: `tg-${chatId}`, demo: s.demo }),
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    await say(chatId, body.error ?? "Feedback could not be saved.", verdictKeyboard());
    return;
  }
  await say(
    chatId,
    "Thanks, that feedback is saved. It does not change the range until someone confirms what they paid.",
    verdictKeyboard(),
  );
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
    "Open the Metrics page for the full breakdown.",
  ].join("\n");
  await say(chatId, text, urlButton("Open accuracy on the web", "/metrics"));
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
  const rows = body.rows.slice(0, 8);
  for (const row of rows) {
    lines.push(
      row.mid == null
        ? `${row.itemName}: be the first to confirm a price.`
        : `${row.itemName} ${perUnit(row.unit)}: ${m(row.mid)} (${m(row.low ?? 0)} to ${m(row.high ?? 0)})`,
    );
  }
  if (body.rows.length === 0) lines.push("No prices here yet. Check a price and confirm what you pay to start one.");
  else if (body.rows.length > rows.length) lines.push("", `Showing ${rows.length} of ${body.rows.length} items. Open the board on the web for the rest.`);
  await say(chatId, lines.join("\n"), urlButton("Open the price board", "/board"));
}
