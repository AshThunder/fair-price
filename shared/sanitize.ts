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
  unit: string;
  quoteNaira: number;
  mid: number | null;
  low: number | null;
  high: number | null;
  fallback: string;
  points: Array<{ id: string; kind: string; priceNaira: number; label: string; period?: string }>;
  reasons: string[];
  verdict: string;
  tip: string;
}): string {
  const lines = [
    `Fair Price judgment pack (sanitized, no names, phones, photos, or exact GPS).`,
    `Item: ${input.itemName} per ${input.unit}.`,
    `Area: ${input.areaName}.`,
    `Quoted price: ${input.quoteNaira} naira.`,
    `Code range: mid ${input.mid ?? "none"}, low ${input.low ?? "none"}, high ${input.high ?? "none"}, fallback ${input.fallback}.`,
    `Verdict: ${input.verdict}.`,
    `Reasons: ${input.reasons.join("; ") || "none"}.`,
    `Negotiation tip: ${input.tip}`,
    `Evidence:`,
  ];
  for (const p of input.points) {
    lines.push(`- ${p.id} ${p.kind} ${p.priceNaira} naira (${p.label}${p.period ? ", " + p.period : ""})`);
  }
  return sanitizeForEval(lines.join("\n"));
}
