import type { CodeVerdict, Item, ServJudgment, Area } from "../shared/types.js";
import { money } from "../shared/engine.js";
import { countryName, localeFor } from "../shared/geo.js";
import { servKey } from "./env.js";

const ENDPOINT = "https://inference-api.openserv.ai/v1/chat/completions";
const MODEL = "gpt-5.4-mini";

const SYSTEM = `You are the judgment voice for Fair Price, a fair price check for anything, anywhere.
You receive the country, currency, a dated evidence pack, and a code-computed price band. You do not invent local prices.
You only use the evidence in the pack. Official figures are monthly averages, not live stall quotes, and you must say so when you lean on them.
The code band and code verdict are final. Your job is to explain them and give a practical tip, not to re-judge.
Copy the code verdict into "verdict" and the code band into range_low and range_high. Every reason and the tip must agree with the code verdict and use only the code band numbers.
If you have a specific, evidence-based reason to think the band is misleading for this quote (for example the only anchor is old, or the unit looks wrong), still copy the code verdict, and put that reason in "note" as one short sentence. Otherwise set "note" to null.
Return a single JSON object with keys:
verdict (fair|high|low|uncertain, the code verdict),
range_low (number or null),
range_high (number or null),
unit (string),
confidence (low|medium|high),
reasons (array of short plain sentences, no emojis, max 3),
quotes (array of short evidence summaries, max 3),
negotiation_tip (one short practical sentence, no emojis),
evidence_ids (array of ids you actually used),
note (string or null).
Write amounts in the given currency with its usual symbol, for example ₦1,350, $4.48, £1.68, KSh 227 or R$ 6,51. Never convert between currencies.
If the pack says there is no local data: verdict must be "uncertain". You may give a cautious rough range from general knowledge of typical prices for this item in this country in range_low and range_high, in the same currency, and say plainly in one reason that it is a rough guess, not local data. The tip should tell the shopper to compare two sellers and confirm what they pay.
Write for a shopper in plain words. Call the band "the usual range". Never say "code", "band", "evidence pack", or "sample" in reasons, the tip, or the note.
Do not mention hidden chain-of-thought.`;

export class ServUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServUnavailableError";
  }
}

/** Swap internal words SERV sometimes uses for shopper-facing ones. */
export function plainWords(text: string): string {
  return text
    .replace(/\b(t)he evidence pack\b/gi, (_m, t: string) => `${t}he data`)
    .replace(/\bevidence pack\b/gi, "data")
    .replace(/\bcode[- ](?:computed )?(high |low )?band\b/gi, (_m, edge: string | undefined) => (edge ? `${edge.trim()} end of the usual range` : "usual range"))
    .replace(/\bcomputed band\b/gi, "usual range")
    .replace(/\bcode verdict\b/gi, "verdict");
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
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((r) => plainWords(String(r))).slice(0, 3) : [],
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes.map(String).slice(0, 3) : [],
      negotiation_tip: typeof parsed.negotiation_tip === "string" ? plainWords(parsed.negotiation_tip) : "",
      evidence_ids: Array.isArray(parsed.evidence_ids) ? parsed.evidence_ids.map(String) : [],
      note: typeof parsed.note === "string" ? plainWords(parsed.note) : null,
    };
  } catch {
    return null;
  }
}

interface JudgeArgs {
  item: Item;
  area: Area;
  quote: number;
  code: CodeVerdict;
  /** Display name and unit for the area's country. */
  itemName?: string;
  unit?: string;
}

async function judgeOnce(args: JudgeArgs): Promise<ServJudgment> {
  const key = servKey();
  if (!key) throw new ServUnavailableError("SERV key is not configured.");

  const { item, area, quote, code } = args;
  const cur = area.currency;
  const fmt = (n: number) => money(n, cur, localeFor(area.country));
  const r = (n: number | null | undefined) => (typeof n === "number" ? fmt(n) : "none");
  const evidence = code.range.points.map((p) => `${p.id}: ${p.kind} ${fmt(p.price)} — ${p.label}`).join("\n");
  const user = [
    `Item: ${args.itemName ?? item.name} (${item.id}), unit ${args.unit ?? item.unit}, category ${item.category}${item.custom ? ", typed by the shopper" : ""}.`,
    `Country: ${countryName(area.country)} (${area.country}). Currency: ${cur}.`,
    `Area: ${area.name} (${area.id}), kind ${area.kind}.`,
    `Quoted price: ${fmt(quote)}.`,
    code.range.mid == null
      ? `There is no local data for this item here yet. Code verdict is uncertain.`
      : `Code band: mid ${r(code.range.mid)}, low ${r(code.range.low)}, high ${r(code.range.high)}, fallback ${code.range.fallback}, samples ${code.range.sampleSize}.`,
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
  if (!parsed) {
    console.warn(`SERV unreadable judgment: ${JSON.stringify(content.slice(0, 400))}`);
    throw new ServUnavailableError("SERV returned an unreadable judgment.");
  }
  return parsed;
}

/** One retry when SERV answers but the reply is empty or not valid JSON (seen occasionally in live runs). */
export async function judgeWithServ(args: JudgeArgs): Promise<ServJudgment> {
  try {
    return await judgeOnce(args);
  } catch (err) {
    if (err instanceof ServUnavailableError && /unreadable/.test(err.message)) return judgeOnce(args);
    throw err;
  }
}
