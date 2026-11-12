export interface PriceHint {
  amount: number | null;
  currencyGuess: "NGN" | "unknown";
  raw: string | null;
}

const NAIRA = /(?:₦|ngn|naira)?\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,]([0-9]{1,2}))?/gi;

export function parsePriceFromText(text: string): PriceHint {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const matches: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(NAIRA);
  while ((m = re.exec(cleaned))) {
    const whole = (m[1] ?? "").replace(/[.,](?=\d{3}\b)/g, "").replace(/,/g, "");
    const amount = Number(whole + (m[2] ? "." + m[2] : ""));
    if (Number.isFinite(amount) && amount > 0) matches.push(amount);
  }
  if (matches.length === 0) return { amount: null, currencyGuess: "unknown", raw: null };
  // Prefer amounts that look like everyday naira prices, not years or tiny OCR crumbs.
  const plausible = matches.filter((n) => n >= 50 && n <= 20_000_000);
  const amount = (plausible.length ? plausible : matches).sort((a, b) => b - a)[0];
  const currencyGuess = /₦|ngn|naira/i.test(cleaned) ? "NGN" : "unknown";
  return { amount, currencyGuess, raw: String(amount) };
}
