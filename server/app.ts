import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import {
  applyAntiGaming,
  codeVerdict,
  defaultTip,
  deviceHash,
  DUPLICATE_WINDOW_MS,
  reconcileVerdict,
} from "../shared/engine.js";
import {
  areaFromId,
  countryArea,
  countryName,
  CURRENCY_BY_COUNTRY,
  itemName as itemNameFor,
  itemUnit,
  localeFor,
  money,
  resolveArea,
  resolveItem,
  unitOptions,
  unitSystem,
} from "../shared/geo.js";
import { runBenchmark, type BenchmarkReport } from "../shared/benchmark.js";
import { evidencePackText } from "../shared/sanitize.js";
import { parsePriceFromText } from "../shared/ocr.js";
import type { Area, Item, Observation, ReppoRecord, StoredVerdict, VerdictLabel } from "../shared/types.js";
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
  area: Area,
  code: ReturnType<typeof codeVerdict>,
  servReasons: string[],
  hardReasons: string[],
): string[] {
  const reasons = [...hardReasons, ...servReasons];
  const m = (n: number) => money(n, area.currency, localeFor(area.country));
  if (reasons.length === 0) {
    const mid = code.range.mid != null ? m(code.range.mid) : "an unknown midpoint";
    if (label === "fair") reasons.push(`The quote sits inside the recent ${area.name} range for ${itemName}, around ${mid}.`);
    else if (label === "high") reasons.push(`The quote is above the recent ${area.name} range for ${itemName}, which centres near ${mid}.`);
    else if (label === "low") reasons.push(`The quote is below the recent ${area.name} range for ${itemName}, which centres near ${mid}.`);
    else reasons.push(`Nobody has confirmed a price for ${itemName} in ${area.name} yet.`);
  }
  if (code.reasonCodes.includes("region-fallback") && area.kind !== "region") {
    reasons.push(`No figure for ${area.name} itself was on file, so the dated regional average was used as the anchor.`);
  } else if (code.reasonCodes.includes("region-fallback")) {
    reasons.push("No figure for this exact area was on file, so a wider regional average was used as the anchor.");
  }
  if (code.reasonCodes.includes("national-fallback") && area.kind !== "country") {
    reasons.push(`No closer figure was on file, so the dated ${countryName(area.country)} national average was used as the anchor.`);
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
  const seeded = new Set(seed.countries.map((x) => x.code));
  const countries = Object.keys(CURRENCY_BY_COUNTRY)
    .map((code) => ({
      code,
      name: countryName(code),
      currency: CURRENCY_BY_COUNTRY[code],
      locale: localeFor(code),
      units: unitSystem(code),
      seeded: seeded.has(code),
      unitOptions: unitOptions(code),
    }))
    .sort((a, b) => Number(b.seeded) - Number(a.seeded) || a.name.localeCompare(b.name));
  return c.json({
    disclaimer: seed.disclaimer,
    countries,
    // Each item lists the countries where it has a cited figure, so the form can suggest local items first.
    items: seed.items.map((i) => ({
      ...i,
      countries: [
        ...new Set(
          seed.officialRefs.filter((r) => r.itemId === i.id).map((r) => areaFromId(seed.areas, r.areaId)?.country).filter(Boolean),
        ),
      ],
    })),
    areas: seed.areas,
  });
});

app.post("/api/check", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    itemId?: string;
    /** Free-text item, used when itemId is not a catalog id. */
    itemText?: string;
    unit?: string;
    areaId?: string;
    /** ISO 3166-1 alpha-2 country, with an optional free-text city or region. */
    country?: string;
    place?: string;
    quote?: number;
    deviceId?: string;
    demo?: boolean | string;
    source?: "typed" | "photo-confirmed" | "telegram";
  };
  if (rateLimited(c, "check", body.deviceId, 30, 10 * 60_000)) {
    return c.json({ error: "Too many checks in a short time. Try again in a few minutes." }, 429);
  }
  const seed = getSeed();
  const area = resolveArea(seed.areas, { areaId: body.areaId, country: body.country, place: body.place });
  const item = area ? resolveItem(seed.items, { itemId: body.itemId, text: body.itemText, unit: body.unit, country: area.country }) : undefined;
  const quote = Number(body.quote);
  if (!item || !area || !Number.isFinite(quote) || quote <= 0 || quote > MAX_QUOTE) {
    return c.json({ error: "Choose a country, say what you are buying, and enter a price greater than zero." }, 400);
  }
  const shownName = itemNameFor(item, area.country);
  const unit = itemUnit(item, area.country);
  const demo = wantDemo(body.demo);
  const asOf = new Date();
  const observations = await observationsFor(demo, item.id);
  const code = codeVerdict(item, area, quote, seed.officialRefs, observations, seed.areas, asOf, { includeDemo: demo });

  let serv = null;
  let servError: string | undefined;
  const servStarted = Date.now();
  if (!demo) {
    try {
      serv = await judgeWithServ({ item, area, quote, code, itemName: shownName, unit });
    } catch (err) {
      servError = err instanceof ServUnavailableError ? err.message : "SERV was unavailable.";
    }
  } else {
    serv = {
      verdict: code.label,
      range_low: code.range.low,
      range_high: code.range.high,
      unit,
      confidence: (code.label === "uncertain" ? "low" : "medium") as "low" | "medium",
      reasons: [],
      quotes: code.range.points.slice(0, 3).map((p) => `${p.label}: ${money(p.price, area.currency, localeFor(area.country))}`),
      negotiation_tip: defaultTip(code.label, item, code.range, quote, area.country),
      evidence_ids: code.range.points.map((p) => p.id),
    };
  }
  const servMs = Date.now() - servStarted;

  // The code band decides the label; SERV text is only used when it agrees with it.
  const rec = reconcileVerdict(quote, code.range, serv);
  const final = rec.label;
  const servText = rec.useServText ? serv : null;
  const tip = (servText?.negotiation_tip && servText.negotiation_tip.trim()) || defaultTip(final, item, code.range, quote, area.country);
  const reasons = composeReasons(final, shownName, area, code, servText?.reasons ?? [], rec.reasons);
  const quotes = servText?.quotes?.length ? servText.quotes : code.range.points.slice(0, 3).map((p) => `${p.label}: ${money(p.price, area.currency, localeFor(area.country))}`);
  // With no local data at all, SERV's own rough range is shown as a labelled guess, never as the band.
  const guess =
    code.range.mid == null && servText && typeof serv?.range_low === "number" && typeof serv?.range_high === "number" && serv.range_low > 0 && serv.range_high >= serv.range_low
      ? { low: serv.range_low, high: serv.range_high }
      : null;

  const stored: StoredVerdict = {
    id: `v-${randomUUID()}`,
    itemId: item.id,
    areaId: area.id,
    quote: quote,
    currency: area.currency,
    country: area.country,
    unit,
    itemName: shownName,
    areaName: area.name,
    guess,
    code,
    serv,
    servError,
    final,
    tip,
    note: rec.note,
    reasons,
    quotes,
    confidence: servText?.confidence ?? (code.label === "uncertain" ? "low" : "medium"),
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
  return c.json({ verdict: publicVerdict(stored), timing: { servMs } });
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

function publicVerdict(stored: StoredVerdict) {
  const seed = getSeed();
  const country = stored.country ?? "NG";
  const item = resolveItem(seed.items, { itemId: stored.itemId });
  const area = areaFromId(seed.areas, stored.areaId);
  return {
    id: stored.id,
    itemId: stored.itemId,
    itemName: stored.itemName ?? (item ? itemNameFor(item, country) : stored.itemId),
    custom: Boolean(item?.custom),
    areaId: stored.areaId,
    areaName: stored.areaName ?? area?.name ?? stored.areaId,
    country,
    countryName: countryName(country),
    currency: stored.currency ?? "NGN",
    locale: localeFor(country),
    quote: stored.quote,
    unit: stored.unit,
    guess: stored.guess ?? null,
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
    note: stored.note ?? null,
    confidence: stored.confidence,
    servAvailable: Boolean(stored.serv),
    servError: stored.servError ?? null,
    demo: stored.demo,
    reppo: reppoSummary(stored),
    createdAt: stored.createdAt,
  };
}

app.get("/api/verdict/:id", async (c) => {
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
  return c.json({ verdict: publicVerdict(stored) });
});

app.post("/api/feedback", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    verdictId?: string;
    kind?: "paid" | "fair" | "not-fair";
    paid?: number;
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
  const paid = body.kind === "paid" ? Number(body.paid ?? stored.quote) : undefined;
  if (paid !== undefined && (!Number.isFinite(paid) || paid <= 0 || paid > MAX_QUOTE)) {
    return c.json({ error: "Enter the amount you paid, in the local currency." }, 400);
  }
  const seed = getSeed();
  const hash = deviceHash(body.deviceId || "anonymous");
  const demo = stored.demo || wantDemo(body.demo);
  const currency = stored.currency ?? "NGN";
  const feedback = await store.addFeedback({ verdictId: stored.id, kind: body.kind, paid, currency, deviceHash: hash });

  let observation: Observation | null = null;
  if (paid !== undefined) {
    const now = new Date();
    const device = await store.getDevice(hash);
    let gate = applyAntiGaming({
      itemId: stored.itemId,
      areaId: stored.areaId,
      price: paid,
      deviceHash: hash,
      now,
      observations: (await observationsFor(demo, stored.itemId)).filter((o) => (o.currency ?? currency) === currency),
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
      price: paid,
      currency,
      unit: stored.unit,
      itemName: stored.itemName,
      verdictId: stored.id,
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
    const pub = publicVerdict(stored);
    const pack = evidencePackText({
      itemName: pub.itemName,
      areaName: `${pub.areaName}, ${pub.countryName}`,
      currency,
      unit: stored.unit,
      quote: stored.quote,
      mid: stored.code.range.mid,
      low: stored.code.range.low,
      high: stored.code.range.high,
      fallback: stored.code.range.fallback,
      points: stored.code.range.points,
      reasons: stored.reasons,
      verdict: stored.final,
      tip: stored.tip,
      paid: paid,
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
  const country = (c.req.query("country") || "").toUpperCase() || areaFromId(seed.areas, c.req.query("areaId") || "NG")?.country || "NG";
  const area =
    (c.req.query("areaId") ? areaFromId(seed.areas, c.req.query("areaId")!) : undefined) ?? countryArea(seed.areas, country);
  if (!area || area.country !== country) return c.json({ error: "Unknown area." }, 404);
  const demo = wantDemo(c.req.query("demo"));
  const asOf = new Date();
  const obs = (await observationsFor(demo)).filter((o) => (o.currency ?? "NGN") === area.currency);
  // Catalog items with any data in this country, plus free-text items people confirmed here.
  const countryAreaIds = new Set(seed.areas.filter((a) => a.country === country).map((a) => a.id));
  const inCountry = (id: string) => countryAreaIds.has(id) || id === country || id.startsWith(`${country}:`);
  const catalog = seed.items.filter(
    (i) => seed.officialRefs.some((r) => r.itemId === i.id && inCountry(r.areaId)) || obs.some((o) => o.itemId === i.id && inCountry(o.areaId)),
  );
  const customIds = [...new Set(obs.filter((o) => o.itemId.startsWith("x-") && inCountry(o.areaId)).map((o) => o.itemId))];
  const custom: Item[] = customIds.map((id) => {
    const named = obs.find((o) => o.itemId === id && o.itemName);
    const base = resolveItem(seed.items, { itemId: id })!;
    return { ...base, name: named?.itemName ?? base.name, unit: named?.unit ?? base.unit };
  });
  const rows = [...catalog, ...custom].map((item) => {
    const v = codeVerdict(item, area, 0, seed.officialRefs, obs, seed.areas, asOf, { includeDemo: demo });
    return {
      itemId: item.id,
      itemName: itemNameFor(item, country),
      unit: itemUnit(item, country),
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
    area: { id: area.id, name: area.name, kind: area.kind, country, currency: area.currency, locale: localeFor(country) },
    areas: seed.areas.filter((a) => a.country === country),
    countries: seed.countries,
    rows,
  });
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
      byCountry: bench.byCountry,
      feedback: bench.feedback,
      labelRule: bench.labelRule,
      method: bench.method,
      sources: bench.sources,
      results: bench.results.map((r) => ({
        id: r.id,
        itemId: r.itemId,
        areaId: r.areaId,
        country: r.country,
        currency: r.currency,
        category: r.category,
        split: r.split,
        quote: r.quote,
        expected: r.expected,
        seedOnly: r.seedOnly.label,
        afterFeedback: r.afterFeedback.label,
      })),
    },
    reppo: {
      completed: completed.length,
      medianScore: median(completed.map((r) => r.score as number)),
      dailyCap: reppoDailyCap(),
      trustEffects: {
        boosted: live.filter((r) => r.trustEffect === "boosted").length,
        reduced: live.filter((r) => r.trustEffect === "reduced").length,
        unchanged: live.filter((r) => r.trustEffect === "unchanged").length,
      },
      evals: all.map((e) => ({
        evalId: e.evalId,
        status: e.status,
        score: e.score,
        decision: e.decision,
        route: e.route,
        reason: e.reason,
        creditsCharged: e.creditsCharged,
        latencyMs: e.latencyMs ?? null,
        trustEffect: e.trustEffect ?? null,
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
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; currency?: string };
  const text = String(body.text ?? "").slice(0, 5000);
  const currency = /^[A-Z]{3}$/.test(String(body.currency ?? "")) ? String(body.currency) : "NGN";
  return c.json({ hint: parsePriceFromText(text, currency) });
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
