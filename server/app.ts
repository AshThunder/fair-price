import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import {
  applyAntiGaming,
  codeVerdict,
  defaultTip,
  deviceHash,
  hardRulesOverride,
  naira,
  scoreBenchmark,
} from "../shared/engine.js";
import { evidencePackText } from "../shared/sanitize.js";
import { parsePriceFromText } from "../shared/ocr.js";
import type { StoredVerdict, VerdictLabel } from "../shared/types.js";
import { DEMO_DEFAULT } from "./env.js";
import { judgeWithServ, ServUnavailableError } from "./serv.js";
import { getEval, submitEval } from "./reppo.js";
import {
  addFeedback,
  addObservation,
  addVerdict,
  allFeedback,
  allObservations,
  allReppo,
  getSeed,
  getVerdict,
  loadDemoEvals,
} from "./store.js";

const app = new Hono();
app.use("/api/*", cors());

const AS_OF = () => new Date();

function wantDemo(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return DEMO_DEFAULT;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function metricsPayload(demo: boolean) {
  const seed = getSeed();
  const obs = allObservations();
  const asOf = AS_OF();
  const seedOnly = scoreBenchmark(seed.benchmark, seed.items, seed.areas, seed.officialRefs, obs, asOf, {
    seedOnly: true,
  });
  const after = scoreBenchmark(seed.benchmark, seed.items, seed.areas, seed.officialRefs, obs, asOf, {
    includeDemo: true,
  });
  const demoEvals = loadDemoEvals();
  const liveEvals = allReppo().filter((r) => r.status === "COMPLETED" && r.score != null);
  const seen = new Set(demoEvals.map((e) => e.evalId));
  const evals = [...demoEvals, ...liveEvals.filter((e) => !seen.has(e.evalId))];
  const scores = evals.map((e) => e.score).filter((n): n is number => typeof n === "number");
  const liveConfirms = allFeedback().filter((f) => f.kind === "paid");
  return {
    generatedAt: new Date().toISOString(),
    demo,
    disclaimer: seed.disclaimer,
    seedOnly: {
      mode: "seed-only" as const,
      agreementRate: seedOnly.agreementRate,
      cases: seedOnly.cases,
      agreed: seedOnly.agreed,
      mape: seedOnly.mape,
      medianReppoScore: null,
      reppoCount: 0,
      computedAt: new Date().toISOString(),
      details: seedOnly.details,
    },
    afterFeedback: {
      mode: "after-feedback" as const,
      agreementRate: after.agreementRate,
      cases: after.cases,
      agreed: after.agreed,
      mape: after.mape,
      medianReppoScore: median(scores),
      reppoCount: evals.length,
      computedAt: new Date().toISOString(),
      details: after.details,
    },
    reppo: evals.map((e) => ({
      evalId: e.evalId,
      status: e.status,
      score: e.score,
      decision: e.decision,
      route: e.route,
      reason: e.reason,
      creditsCharged: e.creditsCharged,
      verdictId: e.verdictId,
      source: demoEvals.some((d) => d.evalId === e.evalId) ? "demo" : "live",
    })),
    livePaidConfirms: liveConfirms.length,
    observationCount: obs.filter((o) => o.status === "accepted").length,
  };
}

function composeReasons(label: VerdictLabel, itemName: string, areaName: string, areaKind: string, code: ReturnType<typeof codeVerdict>, servReasons: string[], hardReasons: string[]): string[] {
  const reasons = [...hardReasons, ...servReasons];
  if (reasons.length === 0) {
    const mid = code.range.mid != null ? naira(code.range.mid) : "an unknown midpoint";
    if (label === "fair") reasons.push(`The quote sits inside the recent ${areaName} range for ${itemName}, around ${mid}.`);
    else if (label === "high") reasons.push(`The quote is above the recent ${areaName} range for ${itemName}, which centres near ${mid}.`);
    else if (label === "low") reasons.push(`The quote is below the recent ${areaName} range for ${itemName}, which centres near ${mid}.`);
    else reasons.push(`There is not yet a tight local range for ${itemName} in ${areaName}.`);
  }
  if (code.reasonCodes.includes("zone-fallback") && areaKind === "state") {
    reasons.push("No official state figure was on file, so the dated zonal average was used as the anchor.");
  }
  if (code.reasonCodes.includes("national-fallback") && areaKind !== "national") {
    reasons.push("No closer official figure was on file, so the dated national average was used as the anchor.");
  }
  if (code.reasonCodes.includes("has-official")) {
    reasons.push("Official anchors are May 2026 monthly averages, not live stall or pump prices.");
  }
  return reasons.slice(0, 4);
}

app.get("/api/health", (c) => c.json({ status: "ok", service: "fair-price" }));

app.get("/api/catalog", (c) => {
  const seed = getSeed();
  return c.json({
    currency: seed.currency,
    country: seed.country,
    disclaimer: seed.disclaimer,
    items: seed.items,
    areas: seed.areas,
  });
});

app.post("/api/check", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    itemId?: string;
    areaId?: string;
    quoteNaira?: number;
    deviceId?: string;
    demo?: boolean | string;
    source?: "typed" | "photo-confirmed" | "telegram";
  };
  const seed = getSeed();
  const item = seed.items.find((i) => i.id === body.itemId);
  const area = seed.areas.find((a) => a.id === body.areaId);
  const quote = Number(body.quoteNaira);
  if (!item || !area || !Number.isFinite(quote) || quote <= 0) {
    return c.json({ error: "Please choose an item, an area, and a price greater than zero." }, 400);
  }
  const demo = wantDemo(body.demo);
  const asOf = AS_OF();
  const observations = allObservations();
  const code = codeVerdict(item, area, quote, seed.officialRefs, observations, seed.areas, asOf, {
    includeDemo: true,
  });

  let serv = null;
  let servError: string | undefined;
  if (!demo) {
    try {
      serv = await judgeWithServ({ item, area, quote, code });
    } catch (err) {
      servError = err instanceof ServUnavailableError ? err.message : "SERV was unavailable.";
    }
  } else {
    serv = {
      verdict: code.label,
      range_low: code.range.low,
      range_high: code.range.high,
      unit: item.unit,
      confidence: (code.label === "uncertain" ? "low" : "medium") as "low" | "medium",
      reasons: [],
      quotes: code.range.points.slice(0, 3).map((p) => `${p.label}: ${naira(p.priceNaira)}`),
      negotiation_tip: defaultTip(code.label, item, code.range, quote),
      evidence_ids: code.range.points.map((p) => p.id),
    };
  }

  const hard = hardRulesOverride(item, quote, code.range, serv);
  const final = hard.label;
  const tip = (serv?.negotiation_tip && serv.negotiation_tip.trim()) || defaultTip(final, item, code.range, quote);
  const reasons = composeReasons(final, item.name, area.name, area.kind, code, serv?.reasons ?? [], hard.reasons);
  const quotes = serv?.quotes?.length ? serv.quotes : code.range.points.slice(0, 3).map((p) => `${p.label}: ${naira(p.priceNaira)}`);

  const stored: StoredVerdict = {
    id: `v-${randomUUID()}`,
    itemId: item.id,
    areaId: area.id,
    quoteNaira: quote,
    unit: item.unit,
    code,
    serv,
    servError,
    final,
    tip,
    reasons,
    quotes,
    confidence: serv?.confidence ?? (code.label === "uncertain" ? "low" : "medium"),
    createdAt: new Date().toISOString(),
    demo,
  };

  if (demo) {
    const pack = fixtureEvalFor(item.id, area.id, quote, final);
    if (pack) {
      stored.reppoEvalId = pack.evalId;
      stored.reppoStatus = pack.status;
      stored.reppoScore = pack.score;
      stored.reppoRoute = pack.route;
      stored.reppoDecision = pack.decision;
      stored.reppoReason = pack.reason ?? null;
    }
  }

  addVerdict(stored);

  if (!demo) {
    void queueEval(stored, item.name, area.name).catch(() => {
      // Eval submit is best-effort and must never fail the user-facing check.
    });
  }

  return c.json({
    verdict: publicVerdict(stored, item.name, area.name, seed.disclaimer),
  });
});

function fixtureEvalFor(itemId: string, areaId: string, quote: number, label: VerdictLabel) {
  const evals = loadDemoEvals();
  const match = evals.find((e) => {
    if (e.verdictId === "demo-rice-fair") {
      return itemId === "rice-local" && areaId === "NG" && label === "fair" && Math.abs(quote - 1905.43) < 2;
    }
    if (e.verdictId === "demo-tomatoes-feedback") {
      return itemId === "tomatoes" && areaId === "NG-KANO" && Math.abs(quote - 1400) < 2;
    }
    return false;
  });
  return match ?? null;
}

async function queueEval(stored: StoredVerdict, itemName: string, areaName: string): Promise<void> {
  const pack = evidencePackText({
    itemName,
    areaName,
    unit: stored.unit,
    quoteNaira: stored.quoteNaira,
    mid: stored.code.range.mid,
    low: stored.code.range.low,
    high: stored.code.range.high,
    fallback: stored.code.range.fallback,
    points: stored.code.range.points,
    reasons: stored.reasons,
    verdict: stored.final,
    tip: stored.tip,
  });
  await submitEval({ taskType: "claim", input: pack, verdictId: stored.id });
}

function publicVerdict(stored: StoredVerdict, itemName: string, areaName: string, disclaimer: string) {
  return {
    id: stored.id,
    itemId: stored.itemId,
    itemName,
    areaId: stored.areaId,
    areaName,
    quoteNaira: stored.quoteNaira,
    unit: stored.unit,
    label: stored.final,
    mid: stored.code.range.mid,
    low: stored.code.range.low,
    high: stored.code.range.high,
    fallback: stored.code.range.fallback,
    sampleSize: stored.code.range.sampleSize,
    officialCount: stored.code.range.officialCount,
    observationCount: stored.code.range.observationCount,
    thin: stored.code.range.thin,
    reasons: stored.reasons,
    quotes: stored.quotes,
    tip: stored.tip,
    confidence: stored.confidence,
    servAvailable: Boolean(stored.serv),
    servError: stored.servError ?? null,
    demo: stored.demo,
    disclaimer,
    reppo: stored.reppoEvalId
      ? {
          evalId: stored.reppoEvalId,
          status: stored.reppoStatus ?? null,
          score: stored.reppoScore ?? null,
          route: stored.reppoRoute ?? null,
          decision: stored.reppoDecision ?? null,
        }
      : null,
    createdAt: stored.createdAt,
  };
}

app.get("/api/verdict/:id", (c) => {
  const seed = getSeed();
  const stored = getVerdict(c.req.param("id"));
  if (!stored) return c.json({ error: "That check was not found." }, 404);
  const item = seed.items.find((i) => i.id === stored.itemId);
  const area = seed.areas.find((a) => a.id === stored.areaId);
  return c.json({
    verdict: publicVerdict(stored, item?.name ?? stored.itemId, area?.name ?? stored.areaId, seed.disclaimer),
  });
});

app.post("/api/feedback", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    verdictId?: string;
    kind?: "paid" | "fair" | "not-fair";
    paidNaira?: number;
    deviceId?: string;
    demo?: boolean | string;
  };
  const stored = body.verdictId ? getVerdict(body.verdictId) : undefined;
  if (!stored) return c.json({ error: "That check was not found." }, 404);
  if (body.kind !== "paid" && body.kind !== "fair" && body.kind !== "not-fair") {
    return c.json({ error: "Choose a feedback type." }, 400);
  }
  const seed = getSeed();
  const hash = deviceHash(body.deviceId || "anonymous");
  const feedback = addFeedback({
    verdictId: stored.id,
    kind: body.kind,
    paidNaira: body.kind === "paid" ? Number(body.paidNaira ?? stored.quoteNaira) : undefined,
    deviceHash: hash,
  });

  let observation = null;
  if (body.kind === "paid") {
    const paid = Number(body.paidNaira ?? stored.quoteNaira);
    const gate = applyAntiGaming({
      itemId: stored.itemId,
      areaId: stored.areaId,
      priceNaira: paid,
      deviceHash: hash,
      now: new Date(),
      observations: allObservations(),
      refs: seed.officialRefs,
      areas: seed.areas,
    });
    observation = addObservation({
      itemId: stored.itemId,
      areaId: stored.areaId,
      priceNaira: paid,
      source: "typed",
      status: gate.status,
      trust: gate.trust,
      deviceHash: hash,
      tag: wantDemo(body.demo) ? "demo" : "live",
      note: gate.reason,
    });
  }

  return c.json({
    ok: true,
    feedbackId: feedback.id,
    observation: observation
      ? { id: observation.id, status: observation.status, reason: observation.note ?? null }
      : null,
  });
});

app.get("/api/board", (c) => {
  const seed = getSeed();
  const areaId = c.req.query("areaId") || "NG";
  const area = seed.areas.find((a) => a.id === areaId);
  if (!area) return c.json({ error: "Unknown area." }, 404);
  const asOf = AS_OF();
  const obs = allObservations();
  const rows = seed.items.map((item) => {
    const v = codeVerdict(item, area, 0, seed.officialRefs, obs, seed.areas, asOf);
    return {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      category: item.category,
      mid: v.range.mid,
      low: v.range.low,
      high: v.range.high,
      fallback: v.range.fallback,
      officialCount: v.range.officialCount,
      observationCount: v.range.observationCount,
      sampleSize: v.range.sampleSize,
    };
  });
  return c.json({
    area: { id: area.id, name: area.name, kind: area.kind },
    areas: seed.areas,
    disclaimer: seed.disclaimer,
    rows,
  });
});

app.get("/api/metrics", (c) => {
  return c.json(metricsPayload(wantDemo(c.req.query("demo"))));
});

app.get("/api/reppo/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await getEval(id);
    return c.json({ eval: result });
  } catch {
    const demo = loadDemoEvals().find((e) => e.evalId === id);
    if (demo) return c.json({ eval: demo, source: "demo" });
    return c.json({ error: "Eval was not found or is not readable." }, 404);
  }
});

app.post("/api/ocr-hint", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { text?: string };
  const text = String(body.text ?? "");
  return c.json({ hint: parsePriceFromText(text) });
});

app.post("/api/telegram", async (c) => {
  const update = await c.req.json().catch(() => null);
  if (!update) return c.json({ ok: false }, 400);
  const { handleTelegramUpdate } = await import("./telegram.js");
  await handleTelegramUpdate(update);
  return c.json({ ok: true });
});

export default app;
