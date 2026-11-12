import { reppoDailyCap, reppoKey } from "./env.js";
import { getStore } from "./store.js";
import type { ReppoRecord } from "../shared/types.js";

const BASE = "https://eval.reppo.xyz/api/v1/agents/evals";
const TERMINAL = new Set(["COMPLETED", "FAILED"]);

export class ReppoBudgetError extends Error {
  constructor() {
    super("The daily Reppo eval budget is used up.");
    this.name = "ReppoBudgetError";
  }
}

function authHeaders(): Record<string, string> {
  const key = reppoKey();
  if (!key) throw new Error("Reppo key is not configured.");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export function isTerminal(status: string | null | undefined): boolean {
  return Boolean(status && TERMINAL.has(status));
}

/** Submit one eval. Enforces the rolling 24-hour cap before spending credits. */
export async function submitEval(args: {
  taskType: "claim" | "response" | "action";
  input: string;
  verdictId?: string;
}): Promise<ReppoRecord> {
  const store = await getStore();
  const used = await store.countReppoSince(new Date(Date.now() - 24 * 3600_000));
  if (used >= reppoDailyCap()) throw new ReppoBudgetError();

  const response = await fetch(BASE, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ taskType: args.taskType, input: args.input.slice(0, 50_000) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 201 && !response.ok) {
    throw new Error(`Reppo submit returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { id?: string; status?: string; creditsCharged?: number };
  if (!body.id) throw new Error("Reppo submit did not return an id.");
  const record = await store.upsertReppo({
    evalId: body.id,
    verdictId: args.verdictId ?? "",
    taskType: args.taskType,
    status: body.status ?? "QUEUED",
    score: null,
    decision: null,
    route: null,
    reason: null,
    creditsCharged: body.creditsCharged ?? null,
    createdAt: new Date().toISOString(),
  });
  if (args.verdictId) {
    await store.updateVerdict(args.verdictId, { reppoEvalId: body.id, reppoStatus: record.status });
  }
  return record;
}

export async function getEval(id: string): Promise<{
  id: string;
  status: string;
  score: number | null;
  decision: string | null;
  route: string | null;
  reason: string | null;
  creditsCharged: number | null;
}> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Reppo poll returned HTTP ${response.status}.`);
  const body = (await response.json()) as {
    id?: string;
    status?: string;
    score?: number | null;
    creditsCharged?: number | null;
    result?: { decision?: string; route?: string; reason?: string; score?: number };
  };
  const result = body.result ?? {};
  return {
    id: body.id ?? id,
    status: body.status ?? "UNKNOWN",
    score: body.score ?? result.score ?? null,
    decision: result.decision ?? null,
    route: result.route ?? null,
    reason: result.reason ?? null,
    creditsCharged: body.creditsCharged ?? null,
  };
}

/**
 * Poll Reppo once and store the result. Serverless-friendly: callers (the
 * verdict endpoint, the e2e script) call this repeatedly instead of keeping a
 * background loop alive. Skips the network call when polled very recently.
 */
export async function refreshEval(evalId: string, opts?: { minIntervalMs?: number }): Promise<ReppoRecord | undefined> {
  const store = await getStore();
  const existing = await store.getReppo(evalId);
  if (existing && isTerminal(existing.status)) return existing;
  const minInterval = opts?.minIntervalMs ?? 4_000;
  if (existing?.lastPolledAt && Date.now() - Date.parse(existing.lastPolledAt) < minInterval) return existing;

  const live = await getEval(evalId);
  const now = new Date();
  const done = isTerminal(live.status);
  const createdAt = existing?.createdAt ?? now.toISOString();
  const record = await store.upsertReppo({
    evalId,
    verdictId: existing?.verdictId ?? "",
    taskType: existing?.taskType ?? "claim",
    status: live.status,
    score: live.score,
    decision: live.decision,
    route: live.route,
    reason: live.reason,
    creditsCharged: live.creditsCharged,
    latencyMs: done ? now.getTime() - Date.parse(createdAt) : null,
    createdAt,
    completedAt: done ? now.toISOString() : undefined,
    lastPolledAt: now.toISOString(),
  });
  if (record.verdictId) {
    await store.updateVerdict(record.verdictId, {
      reppoEvalId: evalId,
      reppoStatus: record.status,
      reppoScore: record.score,
      reppoRoute: record.route,
      reppoDecision: record.decision,
      reppoReason: record.reason ?? undefined,
    });
    if (record.status === "COMPLETED") {
      const effect = await store.applyReppoTrust(evalId, record.verdictId, record.score, record.decision);
      return { ...record, trustEffect: effect };
    }
  }
  return record;
}

export async function pollEval(evalId: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<ReppoRecord | undefined> {
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const intervalMs = opts?.intervalMs ?? 5_000;
  const start = Date.now();
  let last = await refreshEval(evalId, { minIntervalMs: 0 });
  while (!isTerminal(last?.status) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await refreshEval(evalId, { minIntervalMs: 0 });
  }
  return last;
}
