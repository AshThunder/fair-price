import type { CodeVerdict, Item, ServJudgment, Area } from "../shared/types.js";
import { naira } from "../shared/engine.js";
import { servKey } from "./env.js";

const ENDPOINT = "https://inference-api.openserv.ai/v1/chat/completions";
const MODEL = "gpt-5.4-mini";

const SYSTEM = `You are the judgment voice for Fair Price, a Nigeria-first price-check tool.
You receive a dated evidence pack and a code-computed price band. You do not invent prices.
You only use the evidence in the pack. Official figures are monthly averages, not live stall quotes, and you must say so when you lean on them.
Return a single JSON object with keys:
verdict (fair|high|low|uncertain),
range_low (number or null),
range_high (number or null),
unit (string),
confidence (low|medium|high),
reasons (array of short plain sentences, no emojis, max 3),
quotes (array of short evidence summaries, max 3),
negotiation_tip (one short practical sentence, no emojis),
evidence_ids (array of ids you actually used).
If evidence is thin, dated, or missing, verdict must be uncertain.
Write naira amounts as whole numbers with the ₦ sign, for example ₦1,350.
Do not mention hidden chain-of-thought.`;

export class ServUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServUnavailableError";
  }
}

function parseJudgment(raw: string, fallback: CodeVerdict, item: Item): ServJudgment | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<ServJudgment>;
    const verdict = parsed.verdict;
    if (verdict !== "fair" && verdict !== "high" && verdict !== "low" && verdict !== "uncertain") {
      return null;
    }
    return {
      verdict,
      range_low: typeof parsed.range_low === "number" ? parsed.range_low : fallback.range.low,
      range_high: typeof parsed.range_high === "number" ? parsed.range_high : fallback.range.high,
      unit: typeof parsed.unit === "string" && parsed.unit ? parsed.unit : item.unit,
      confidence: parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low" ? parsed.confidence : "medium",
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 3) : [],
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes.map(String).slice(0, 3) : [],
      negotiation_tip: typeof parsed.negotiation_tip === "string" ? parsed.negotiation_tip : "",
      evidence_ids: Array.isArray(parsed.evidence_ids) ? parsed.evidence_ids.map(String) : [],
    };
  } catch {
    return null;
  }
}

export async function judgeWithServ(args: {
  item: Item;
  area: Area;
  quote: number;
  code: CodeVerdict;
}): Promise<ServJudgment> {
  const key = servKey();
  if (!key) throw new ServUnavailableError("SERV key is not configured.");

  const { item, area, quote, code } = args;
  const r = (n: number | null | undefined) => (typeof n === "number" ? String(Math.round(n)) : "none");
  const evidence = code.range.points
    .map((p) => `${p.id}: ${p.kind} ${Math.round(p.priceNaira)} naira — ${p.label}`)
    .join("\n");
  const user = [
    `Item: ${item.name} (${item.id}), unit ${item.unit}, category ${item.category}.`,
    `Area: ${area.name} (${area.id}), kind ${area.kind}.`,
    `Quoted price: ${quote} naira (${naira(quote)}).`,
    `Code band (naira, rounded): mid ${r(code.range.mid)}, low ${r(code.range.low)}, high ${r(code.range.high)}, fallback ${code.range.fallback}, samples ${code.range.sampleSize}.`,
    `Code verdict: ${code.label}. Reasons: ${code.reasonCodes.join(", ")}.`,
    `Evidence pack:`,
    evidence || "(none)",
  ].join("\n");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(Number(process.env.SERV_TIMEOUT_MS ?? "30000")),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      // gpt-5.x reasoning models reject a custom temperature, and SERV requires a system message.
      reasoning_effort: "low",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = /"message"\s*:\s*"([^"]{0,200})/.exec(detail)?.[1];
    console.warn(`SERV HTTP ${response.status}${message ? `: ${message}` : ""}`);
    throw new ServUnavailableError(`SERV returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  const parsed = parseJudgment(content, code, item);
  if (!parsed) throw new ServUnavailableError("SERV returned an unreadable judgment.");
  return parsed;
}
