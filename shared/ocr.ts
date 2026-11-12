export interface PriceHint {
  amount: number | null;
  currencyGuess: "NGN" | "unknown";
  raw: string | null;
}

// A number, optionally led by a naira mark. OCR often reads ₦ as N, #, or §.
const AMOUNT = /(₦|ngn|naira|n|#|§)?\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,]([0-9]{1,2}))?(\s*(?:kg|g|cl|ml|l|ltr|litres?|liters?|pcs|%)\b)?/gi;

interface Candidate {
  amount: number;
  marked: boolean;
}

export function parsePriceFromText(text: string): PriceHint {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const found: Candidate[] = [];
  const re = new RegExp(AMOUNT);
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    if (m[4]) continue; // a size such as 75cl or 1kg, not a price
    const prefix = m[1] ?? "";
    // A bare "n" only counts as a naira mark when it sits right before the digits.
    if (prefix && /^n$/i.test(prefix) && /\s/.test(m[0].slice(1, 2))) continue;
    const whole = (m[2] ?? "").replace(/[.,](?=\d{3}\b)/g, "").replace(/,/g, "");
    const amount = Number(whole + (m[3] ? "." + m[3] : ""));
    if (Number.isFinite(amount) && amount > 0) found.push({ amount, marked: Boolean(prefix) });
  }
  if (found.length === 0) return { amount: null, currencyGuess: "unknown", raw: null };
  // Prefer amounts that look like everyday naira prices, not years or tiny OCR crumbs,
  // and prefer ones written with a naira mark.
  const plausible = found.filter((c) => c.amount >= 50 && c.amount <= 20_000_000);
  const pool = plausible.length ? plausible : found;
  const marked = pool.filter((c) => c.marked);
  const amount = (marked.length ? marked : pool).map((c) => c.amount).sort((a, b) => b - a)[0];
  const currencyGuess = marked.length || /₦|ngn|naira/i.test(cleaned) ? "NGN" : "unknown";
  return { amount, currencyGuess, raw: String(amount) };
}
