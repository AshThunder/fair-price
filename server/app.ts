import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import {
  applyAntiGaming,
  codeVerdict,
  defaultTip,
  deviceHash,
  DUPLICATE_WINDOW_MS,
  hardRulesOverride,
  naira,
} from "../shared/engine.js";
import { runBenchmark, type BenchmarkReport } from "../shared/benchmark.js";
import { evidencePackText } from "../shared/sanitize.js";
import { parsePriceFromText } from "../shared/ocr.js";
import type { Observation, ReppoRecord, StoredVerdict, VerdictLabel } from "../shared/types.js";
import { DEMO_DEFAULT, hasReppo, hasServ, hasTelegram, reppoDailyCap, telegramWebhookSecret } from "./env.js";
import { judgeWithServ, ServUnavailableError } from "./serv.js";
import { isTerminal, refreshEval, ReppoBudgetError, submitEval } from "./reppo.js";
import { demoObservations, getBenchmark, getSeed, getStore, loadDemoEvals } from "./store.js";

const app = new Hono();
app.use("/api/*", cors());

const MAX_QUOTE = 100_000_000;

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

// Small per-instance rate limit so a public deploy cannot burn SERV or Reppo
// credits from one client. Serverless instances each keep their own window.
const hits = new Map<string, number[]>();
function rateLimited(c: Context, bucket: string, deviceId: string | undefined, limit: number, windowMs: number): boolean {
  const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const key = `${bucket}:${ip}:${deviceId ?? ""}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}

async function observationsFor(demo: boolean, itemId?: string): Promise<Observation[]> {
  const store = await getStore();
  const stored = await store.listObservations(itemId ? { itemId } : undefined);
  const live = stored.filter((o) => demo || o.tag !== "demo");
  const seeded = demo ? demoObservations().filter((o) => !itemId || o.itemId === itemId) : [];
  return [...seeded, ...live];
}

let benchCache: BenchmarkReport | null = null;
function benchmarkReport(): BenchmarkReport {
  if (!benchCache) {
    const seed = getSeed();
    benchCache = runBenchmark(getBenchmark(), seed.items, seed.areas, seed.officialRefs);
  }
  return benchCache;
}

function composeReasons(
  label: VerdictLabel,
  itemName: string,
  areaName: string,
  areaKind: string,
  code: ReturnType<typeof codeVerdict>,
  servReasons: string[],
  hardReasons: string[],
): string[] {
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
  // De-duplicate near-identical sentences from SERV and code.
  const seen = new Set<string>();
  return reasons
    .filter((r) => {
      const k = r.toLowerCase().replace(/[^a-z]/g, "").slice(0, 60);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 3);
}

app.get("/api/health", async (c) => {
  let store: { kind: string; durable: boolean; migrations: string[] } | { error: string };
  try {
    const s = await getStore();
    store = { kind: s.kind, durable: s.durable, migrations: await s.appliedMigrations() };
  } catch {
    store = { error: "Store is unavailable." };
  }
  return c.json({
    status: "error" in store ? "degraded" : "ok",
    service: "fair-price",
    store,
    configured: { serv: hasServ(), reppo: hasReppo(), telegram: hasTelegram() },
  });
});

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
  const body = (await c.req.json().catch(() => ({}))) as {
    itemId?: string;
    areaId?: string;
    quoteNaira?: number;
    deviceId?: string;
    demo?: boolean | string;
    source?: "typed" | "photo-confirmed" | "telegram";
  };
  if (rateLimited(c, "check", body.deviceId, 30, 10 * 60_000)) {
    return c.json({ error: "Too many checks in a short time. Try again in a few minutes." }, 429);
  }
  const seed = getSeed();
  const item = seed.items.find((i) => i.id === body.itemId);
  const area = seed.areas.find((a) => a.id === body.areaId);
  const quote = Number(body.quoteNaira);
  if (!item || !area || !Number.isFinite(quote) || quote <= 0 || quote > MAX_QUOTE) {
    return c.json({ error: "Choose an item, an area, and a price greater than zero." }, 400);
  }
  const demo = wantDemo(body.demo);
  const asOf = new Date();
  const observations = await observationsFor(demo, item.id);
  const code = codeVerdict(item, area, quote, seed.officialRefs, observations, seed.areas, asOf, { includeDemo: demo });

  let serv = null;
  let servError: string | undefined;
  const servStarted = Date.now();
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
  const servMs = Date.now() - servStarted;

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
    const pack = fixtureEvalFor(item.id, area.id, quote);
    if (pack) {
      stored.reppoEvalId = pack.evalId;
      stored.reppoStatus = pack.status;
      stored.reppoScore = pack.score;
      stored.reppoRoute = pack.route;
      stored.reppoDecision = pack.decision;
      stored.reppoReason = pack.reason ?? null;
    }
  }

  const store = await getStore();
  await store.addVerdict(stored);
  return c.json({ verdict: publicVerdict(stored, item.name, area.name), timing: { servMs } });
});

function fixtureEvalFor(itemId: string, areaId: string, quote: number) {
  return (
    loadDemoEvals().find((e) => {
      if (e.verdictId === "demo-rice-fair") return itemId === "rice-local" && areaId === "NG" && Math.abs(quote - 1905.43) < 2;
      if (e.verdictId === "demo-tomatoes-feedback") return itemId === "tomatoes" && areaId === "NG-KANO" && Math.abs(quote - 1400) < 2;
      return false;
    }) ?? null
  );
}

function reppoSummary(stored: StoredVerdict) {
  if (!stored.reppoEvalId) return null;
  const status = stored.reppoStatus ?? null;
  return {
    evalId: stored.reppoEvalId,
    status,
    state: status === "COMPLETED" ? "checked" : status === "FAILED" ? "failed" : "pending",
    score: stored.reppoScore ?? null,
    route: stored.reppoRoute ?? null,
    decision: stored.reppoDecision ?? null,
    reason: stored.reppoReason ?? null,
  };
}

function publicVerdict(stored: StoredVerdict, itemName: string, areaName: string) {
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
    reppo: reppoSummary(stored),
    createdAt: stored.createdAt,
  };
}

app.get("/api/verdict/:id", async (c) => {
  const seed = getSeed();
  const store = await getStore();
  let stored = await store.getVerdict(c.req.param("id"));
  if (!stored) return c.json({ error: "That check was not found." }, 404);
  // Lazy poll: serverless functions cannot keep a background loop, so each read
  // of a pending eval refreshes it from Reppo at most every few seconds.
  if (stored.reppoEvalId && !stored.demo && !isTerminal(stored.reppoStatus) && hasReppo()) {
    try {
      await refreshEval(stored.reppoEvalId);
      stored = (await store.getVerdict(stored.id)) ?? stored;
    } catch {
      // Keep the last known status; the next read will try again.
    }
  }
  const item = seed.items.find((i) => i.id === stored.itemId);
  const area = seed.areas.find((a) => a.id === stored.areaId);
  return c.json({ verdict: publicVerdict(stored, item?.name ?? stored.itemId, area?.name ?? stored.areaId) });
});

app.post("/api/feedback", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    verdictId?: string;
    kind?: "paid" | "fair" | "not-fair";
    paidNaira?: number;
    deviceId?: string;
    demo?: boolean | string;
  };
  if (rateLimited(c, "feedback", body.deviceId, 20, 10 * 60_000)) {
    return c.json({ error: "Too many confirmations in a short time. Try again later." }, 429);
  }
  const store = await getStore();
  const stored = body.verdictId ? await store.getVerdict(body.verdictId) : undefined;
  if (!stored) return c.json({ error: "That check was not found." }, 404);
  if (body.kind !== "paid" && body.kind !== "fair" && body.kind !== "not-fair") {
    return c.json({ error: "Choose a feedback type." }, 400);
  }
  const paid = body.kind === "paid" ? Number(body.paidNaira ?? stored.quoteNaira) : undefined;
  if (paid !== undefined && (!Number.isFinite(paid) || paid <= 0 || paid > MAX_QUOTE)) {
    return c.json({ error: "Enter the amount you paid, in naira." }, 400);
  }
  const seed = getSeed();
  const hash = deviceHash(body.deviceId || "anonymous");
  const demo = stored.demo || wantDemo(body.demo);
  const feedback = await store.addFeedback({ verdictId: stored.id, kind: body.kind, paidNaira: paid, deviceHash: hash });

  let observation: Observation | null = null;
  if (paid !== undefined) {
    const now = new Date();
    const device = await store.getDevice(hash);
    let gate = applyAntiGaming({
      itemId: stored.itemId,
      areaId: stored.areaId,
      priceNaira: paid,
      deviceHash: hash,
      now,
      observations: await observationsFor(demo, stored.itemId),
      refs: seed.officialRefs,
      areas: seed.areas,
      device,
    });
    if (gate.status !== "rejected") {
      const fresh = await store.claimDeviceKey({
        deviceHash: hash,
        itemId: stored.itemId,
        areaId: stored.areaId,
        now,
        windowMs: DUPLICATE_WINDOW_MS,
      });
      if (!fresh) gate = { status: "rejected", trust: 0, reason: "duplicate-device-window" };
    }
    await store.recordDeviceOutcome(hash, gate.status === "pending" ? "accepted" : gate.status);
    observation = await store.addObservation({
      itemId: stored.itemId,
      areaId: stored.areaId,
      priceNaira: paid,
      source: "typed",
      status: gate.status,
      trust: gate.trust,
      deviceHash: hash,
      tag: demo ? "demo" : "live",
      note: gate.reason,
    });
  }

  // A paid confirmation on a live check is the feedback signal Reppo scores:
  // the verdict, its evidence, and what the buyer actually paid. One eval per check.
  let reppo: { state: string; message?: string } | null = null;
  if (paid !== undefined && !demo && !stored.reppoEvalId && observation?.status !== "rejected" && hasReppo()) {
    const seedItem = seed.items.find((i) => i.id === stored.itemId);
    const seedArea = seed.areas.find((a) => a.id === stored.areaId);
    const pack = evidencePackText({
      itemName: seedItem?.name ?? stored.itemId,
      areaName: seedArea?.name ?? stored.areaId,
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
      paidNaira: paid,
    });
    try {
      const rec = await submitEval({ taskType: "claim", input: pack, verdictId: stored.id });
      reppo = { state: "pending", message: rec.status };
    } catch (err) {
      reppo = { state: err instanceof ReppoBudgetError ? "skipped" : "error" };
    }
  }

  return c.json({
    ok: true,
    feedbackId: feedback.id,
    observation: observation ? { id: observation.id, status: observation.status, reason: observation.note ?? null } : null,
    reppo,
  });
});

app.get("/api/board", async (c) => {
  const seed = getSeed();
  const areaId = c.req.query("areaId") || "NG";
  const area = seed.areas.find((a) => a.id === areaId);
  if (!area) return c.json({ error: "Unknown area." }, 404);
  const demo = wantDemo(c.req.query("demo"));
  const asOf = new Date();
  const obs = await observationsFor(demo);
  const rows = seed.items.map((item) => {
    const v = codeVerdict(item, area, 0, seed.officialRefs, obs, seed.areas, asOf, { includeDemo: demo });
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
  return c.json({ area: { id: area.id, name: area.name, kind: area.kind }, areas: seed.areas, rows });
});

app.get("/api/metrics", async (c) => {
  const demo = wantDemo(c.req.query("demo"));
  const store = await getStore();
  const bench = benchmarkReport();
  const demoEvals = demo ? loadDemoEvals() : [];
  const live = await store.listReppo();
  const all: Array<ReppoRecord & { source: "demo" | "live" }> = [
    ...live.map((r) => ({ ...r, source: "live" as const })),
    ...demoEvals.filter((d) => !live.some((l) => l.evalId === d.evalId)).map((r) => ({ ...r, source: "demo" as const })),
  ];
  const completed = all.filter((r) => r.status === "COMPLETED" && r.score != null);
  const feedback = await store.listFeedback();
  const liveObs = (await store.listObservations()).filter((o) => o.tag !== "demo");
  return c.json({
    generatedAt: new Date().toISOString(),
    demo,
    benchmark: {
      version: bench.version,
      asOf: bench.asOf,
      totalCases: bench.totalCases,
      splits: bench.splits,
      byCategory: bench.byCategory,
      feedback: bench.feedback,
      labelRule: bench.labelRule,
      method: bench.method,
      sources: bench.sources,
      results: bench.results.map((r) => ({
        id: r.id,
        itemId: r.itemId,
        areaId: r.areaId,
        category: r.category,
        split: r.split,
        quoteNaira: r.quoteNaira,
        expected: r.expected,
        seedOnly: r.seedOnly.label,
        afterFeedback: r.afterFeedback.label,
      })),
    },
    reppo: {
      completed: completed.length,
      medianScore: median(completed.map((r) => r.score as number)),
      dailyCap: reppoDailyCap(),
      evals: all.map((e) => ({
        evalId: e.evalId,
        status: e.status,
        score: e.score,
        decision: e.decision,
        route: e.route,
        reason: e.reason,
        creditsCharged: e.creditsCharged,
        latencyMs: e.latencyMs ?? null,
        createdAt: e.createdAt,
        source: e.source,
      })),
    },
    live: {
      checks: await store.countVerdicts(),
      paidConfirms: feedback.filter((f) => f.kind === "paid").length,
      acceptedConfirms: liveObs.filter((o) => o.status === "accepted").length,
      quarantined: liveObs.filter((o) => o.status === "quarantine").length,
      rejected: liveObs.filter((o) => o.status === "rejected").length,
    },
  });
});

app.get("/api/reppo/:id", async (c) => {
  const id = c.req.param("id");
  const store = await getStore();
  const stored = await store.getReppo(id);
  if (stored) return c.json({ eval: stored, source: "live" });
  const demo = loadDemoEvals().find((e) => e.evalId === id);
  if (demo) return c.json({ eval: demo, source: "demo" });
  return c.json({ error: "Eval was not found." }, 404);
});

app.post("/api/ocr-hint", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text ?? "").slice(0, 5000);
  return c.json({ hint: parsePriceFromText(text) });
});

app.post("/api/telegram", async (c) => {
  const secret = telegramWebhookSecret();
  if (secret && c.req.header("x-telegram-bot-api-secret-token") !== secret) {
    return c.json({ ok: false }, 401);
  }
  const update = await c.req.json().catch(() => null);
  if (!update) return c.json({ ok: false }, 400);
  const { handleTelegramUpdate } = await import("./telegram.js");
  try {
    await handleTelegramUpdate(update);
  } catch {
    // Always 200 so Telegram does not retry a poison update forever.
  }
  return c.json({ ok: true });
});

app.onError((_err, c) => c.json({ error: "Something went wrong on our side. Try again." }, 500));

export default app;
