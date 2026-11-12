export interface Catalog {
  currency: string;
  country: string;
  disclaimer: string;
  items: Array<{ id: string; name: string; unit: string; category: string; nbsLabel: string | null }>;
  areas: Array<{ id: string; name: string; kind: string; state: string | null; zone: string | null }>;
}

export interface ReppoBadge {
  evalId: string;
  status: string | null;
  state: "checked" | "pending" | "failed";
  score: number | null;
  route: string | null;
  decision: string | null;
  reason: string | null;
}

export interface PublicVerdict {
  id: string;
  itemId: string;
  itemName: string;
  areaId: string;
  areaName: string;
  quoteNaira: number;
  unit: string;
  label: "fair" | "high" | "low" | "uncertain";
  mid: number | null;
  low: number | null;
  high: number | null;
  fallback: string;
  sampleSize: number;
  officialCount: number;
  observationCount: number;
  thin: boolean;
  reasons: string[];
  quotes: string[];
  tip: string;
  confidence: "low" | "medium" | "high";
  servAvailable: boolean;
  servError: string | null;
  demo: boolean;
  reppo: ReppoBadge | null;
  createdAt: string;
}

export interface BoardRow {
  itemId: string;
  itemName: string;
  unit: string;
  category: string;
  mid: number | null;
  low: number | null;
  high: number | null;
  fallback: string;
  officialCount: number;
  observationCount: number;
  sampleSize: number;
}

export interface ScoreBlock {
  cases: number;
  correct: number;
  accuracy: number;
  answered: number;
  coverage: number;
  answeredAccuracy: number | null;
  mape: number | null;
}

export interface Metrics {
  generatedAt: string;
  demo: boolean;
  benchmark: {
    version: string;
    asOf: string;
    totalCases: number;
    splits: Record<"dev" | "test" | "all", { seedOnly: ScoreBlock; afterFeedback: ScoreBlock }>;
    byCategory: Record<string, { seedOnly: ScoreBlock; afterFeedback: ScoreBlock }>;
    feedback: { pairs: number; coveredPairs: number; submitted: number; accepted: number; quarantined: number; rejected: number };
    labelRule: string;
    method: string[];
    sources: Array<{ id: string; title: string; url: string; published: string; kind: string; note: string }>;
    results: Array<{
      id: string;
      itemId: string;
      areaId: string;
      category: string;
      split: "dev" | "test";
      quoteNaira: number;
      expected: string;
      seedOnly: string;
      afterFeedback: string;
    }>;
  };
  reppo: {
    completed: number;
    medianScore: number | null;
    dailyCap: number;
    evals: Array<{
      evalId: string;
      status: string;
      score: number | null;
      decision: string | null;
      route: string | null;
      reason: string | null;
      creditsCharged: number | null;
      latencyMs: number | null;
      createdAt: string;
      source: "demo" | "live";
    }>;
  };
  live: { checks: number; paidConfirms: number; acceptedConfirms: number; quarantined: number; rejected: number };
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new Error("You seem to be offline. Check your connection and try again.");
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "The request failed. Try again.");
  return body;
}

export const api = {
  catalog: () => json<Catalog>("/api/catalog"),
  check: (input: {
    itemId: string;
    areaId: string;
    quoteNaira: number;
    deviceId: string;
    demo: boolean;
    source: "typed" | "photo-confirmed";
  }) => json<{ verdict: PublicVerdict }>("/api/check", { method: "POST", body: JSON.stringify(input) }),
  verdict: (id: string) => json<{ verdict: PublicVerdict }>(`/api/verdict/${encodeURIComponent(id)}`),
  feedback: (input: { verdictId: string; kind: "paid" | "fair" | "not-fair"; paidNaira?: number; deviceId: string; demo: boolean }) =>
    json<{
      ok: boolean;
      observation: { id: string; status: string; reason: string | null } | null;
      reppo: { state: string } | null;
    }>("/api/feedback", { method: "POST", body: JSON.stringify(input) }),
  board: (areaId: string, demo: boolean) =>
    json<{ area: { id: string; name: string; kind: string }; areas: Catalog["areas"]; rows: BoardRow[] }>(
      `/api/board?areaId=${encodeURIComponent(areaId)}&demo=${demo ? "1" : "0"}`,
    ),
  metrics: (demo: boolean) => json<Metrics>(`/api/metrics?demo=${demo ? "1" : "0"}`),
};

export function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

export const CATEGORY_LABEL: Record<string, string> = {
  food: "Food",
  fuel: "Fuel and gas",
  transport: "Transport fares",
  repair: "Repairs",
  rent: "Rent",
  service: "Services",
};
