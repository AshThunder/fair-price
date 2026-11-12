const PII = /\b(?:\+?234[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{4}|\d{11}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;

export function sanitizeForEval(text: string): string {
  return text
    .replace(PII, "[redacted]")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[redacted-ip]")
    .slice(0, 40_000);
}

export function evidencePackText(input: {
  itemName: string;
  areaName: string;
  /** ISO 4217 code; every amount in the pack is in this currency. */
  currency?: string;
  unit: string;
  quote: number;
  mid: number | null;
  low: number | null;
  high: number | null;
  fallback: string;
  points: Array<{ id: string; kind: string; price: number; label: string; period?: string }>;
  reasons: string[];
  verdict: string;
  tip: string;
  /** What the buyer reported paying after the check, if they confirmed. */
  paid?: number | null;
}): string {
  const cur = input.currency ?? "NGN";
  const amt = (n: number | null) => (n == null ? "none" : `${Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100} ${cur}`);
  const lines = [
    `Fair Price judgment pack (sanitized, no names, phones, photos, or exact GPS).`,
    `Item: ${input.itemName} per ${input.unit}.`,
    `Area: ${input.areaName}.`,
    `Currency: ${cur}. All amounts below are in ${cur}.`,
    `Quoted price: ${amt(input.quote)}.`,
    `Code range: mid ${amt(input.mid)}, low ${amt(input.low)}, high ${amt(input.high)}, fallback ${input.fallback}.`,
    `Verdict: ${input.verdict}.`,
    `Reasons: ${input.reasons.join("; ") || "none"}.`,
    `Negotiation tip: ${input.tip}`,
  ];
  if (input.paid != null) {
    lines.push(
      `Outcome: the buyer later confirmed paying ${amt(input.paid)}. Judge whether the verdict, range, and tip were accurate and useful given the evidence and this outcome.`,
    );
  }
  lines.push(`Evidence:`);
  for (const p of input.points) {
    lines.push(`- ${p.id} ${p.kind} ${amt(p.price)} (${p.label}${p.period ? ", " + p.period : ""})`);
  }
  return sanitizeForEval(lines.join("\n"));
}
