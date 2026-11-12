export interface PriceHint {
  amount: number | null;
  /** ISO code when a currency mark was read next to the amount, else "unknown". */
  currencyGuess: string;
  raw: string | null;
}

// A number, optionally led by a currency mark. OCR often reads ₦ as N, #, or §.
const AMOUNT = /(r\$|us\$|ksh|kes|rs\.?|inr|usd|gbp|brl|₦|ngn|naira|\$|£|€|₹|n|#|§)?\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,]([0-9]{1,2}))?(\s*(?:kg|g|cl|ml|l|ltr|litres?|liters?|pcs|%)\b)?/gi;

interface Candidate {
  amount: number;
  marked: boolean;
}

const MARKS: Array<[RegExp, string]> = [
  [/^(₦|ngn|naira|n|#|§)$/i, "NGN"],
  [/^r\$|brl$/i, "BRL"],
  [/^(us\$|\$|usd)$/i, "USD"],
  [/^(£|gbp)$/i, "GBP"],
  [/^€$/i, "EUR"],
  [/^(₹|rs\.?|inr)$/i, "INR"],
  [/^(ksh|kes)$/i, "KES"],
];
const markCurrency = (mark: string) => MARKS.find(([re]) => re.test(mark))?.[1] ?? "unknown";

/** Pull the most likely price from OCR text. `currency` is the country's currency, used for sanity bounds. */
export function parsePriceFromText(text: string, currency = "NGN"): PriceHint {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const found: Array<Candidate & { mark: string }> = [];
  const re = new RegExp(AMOUNT);
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    if (m[4]) continue; // a size such as 75cl or 1kg, not a price
    const prefix = m[1] ?? "";
    // A bare "n" only counts as a naira mark when it sits right before the digits.
    if (prefix && /^n$/i.test(prefix) && /\s/.test(m[0].slice(1, 2))) continue;
    const whole = (m[2] ?? "").replace(/[.,](?=\d{3}\b)/g, "").replace(/,/g, "");
    const amount = Number(whole + (m[3] ? "." + m[3] : ""));
    if (Number.isFinite(amount) && amount > 0) found.push({ amount, marked: Boolean(prefix), mark: prefix });
  }
  if (found.length === 0) return { amount: null, currencyGuess: "unknown", raw: null };
  // Prefer amounts that look like everyday prices in this currency, not years or tiny
  // OCR crumbs, and prefer ones written with a currency mark.
  const floor = currency === "NGN" ? 50 : 0.1;
  const plausible = found.filter((c) => c.amount >= floor && c.amount <= 20_000_000);
  const pool = plausible.length ? plausible : found;
  const marked = pool.filter((c) => c.marked);
  const best = (marked.length ? marked : pool).sort((a, b) => b.amount - a.amount)[0];
  const amount = best.amount;
  const currencyGuess = best.marked
    ? markCurrency(best.mark)
    : currency === "NGN" && /₦|ngn|naira/i.test(cleaned)
      ? "NGN"
      : "unknown";
  return { amount, currencyGuess, raw: String(amount) };
}
