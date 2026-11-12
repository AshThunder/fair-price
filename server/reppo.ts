import { reppoKey } from "./env.js";
import { addReppo, allReppo, allVerdicts, getVerdict, updateVerdict } from "./store.js";
import type { ReppoRecord } from "../shared/types.js";

const BASE = "https://eval.reppo.xyz/api/v1/agents/evals";

export interface ReppoSubmitResult {
  evalId: string;
  status: string;
  creditsCharged: number | null;
}

function authHeaders(): Record<string, string> {
  const key = reppoKey();
  if (!key) throw new Error("Reppo key is not configured.");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function submitEval(args: {
  taskType: "claim" | "response" | "action";
  input: string;
  verdictId?: string;
}): Promise<ReppoSubmitResult> {
  const response = await fetch(BASE, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      taskType: args.taskType,
      input: args.input.slice(0, 50_000),
    }),
  });
  if (response.status !== 201 && !response.ok) {
    throw new Error(`Reppo submit returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as {
    id?: string;
    status?: string;
    creditsCharged?: number;
  };
  if (!body.id) throw new Error("Reppo submit did not return an id.");
  const record: ReppoRecord = {
    evalId: body.id,
    verdictId: args.verdictId ?? "",
    taskType: args.taskType,
    status: body.status ?? "QUEUED",
    score: null,
    decision: null,
    route: null,
    reason: null,
    creditsCharged: body.creditsCharged ?? 0,
    createdAt: new Date().toISOString(),
  };
  addReppo(record);
  if (args.verdictId) {
    updateVerdict(args.verdictId, { reppoEvalId: body.id, reppoStatus: record.status });
  }
  return { evalId: body.id, status: record.status, creditsCharged: record.creditsCharged };
}

export async function getEval(id: string): Promise<{
  id: string;
  status: string;
  score: number | null;
  decision: string | null;
  route: string | null;
  reason: string | null;
  creditsCharged: number | null;
  result?: unknown;
}> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Reppo poll returned HTTP ${response.status}.`);
  const body = (await response.json()) as {
    id?: string;
    status?: string;
    score?: number | null;
    creditsCharged?: number | null;
    result?: {
      decision?: string;
      route?: string;
      reason?: string;
      score?: number;
    };
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
    result: body.result,
  };
}

export async function pollEval(id: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<ReturnType<typeof getEval>> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const intervalMs = opts?.intervalMs ?? 5_000;
  const start = Date.now();
  let last = await getEval(id);
  while (last.status !== "COMPLETED" && last.status !== "FAILED" && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await getEval(id);
  }
  const record: ReppoRecord = {
    evalId: last.id,
    verdictId: getVerdictByEval(id),
    taskType: "claim",
    status: last.status,
    score: last.score,
    decision: last.decision,
    route: last.route,
    reason: last.reason,
    creditsCharged: last.creditsCharged,
    createdAt: new Date().toISOString(),
    completedAt: last.status === "COMPLETED" || last.status === "FAILED" ? new Date().toISOString() : undefined,
  };
  addReppo(record);
  const verdictId = record.verdictId;
  if (verdictId) {
    updateVerdict(verdictId, {
      reppoEvalId: last.id,
      reppoStatus: last.status,
      reppoScore: last.score,
      reppoRoute: last.route,
      reppoDecision: last.decision,
      reppoReason: last.reason ?? undefined,
    });
  }
  return last;
}


function getVerdictByEval(evalId: string): string {
  const fromRuntime = allReppo().find((r) => r.evalId === evalId)?.verdictId;
  if (fromRuntime) return fromRuntime;
  const fromVerdict = allVerdicts().find((v) => v.reppoEvalId === evalId)?.id;
  return fromVerdict ?? "";
}

export async function attachEvalToVerdict(verdictId: string, evalId: string): Promise<void> {
  const v = getVerdict(verdictId);
  if (v) updateVerdict(verdictId, { reppoEvalId: evalId });
}
