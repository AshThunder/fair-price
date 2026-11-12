export interface Catalog {
  currency: string;
  country: string;
  disclaimer: string;
  items: Array<{ id: string; name: string; unit: string; category: string; nbsLabel: string | null }>;
  areas: Array<{ id: string; name: string; kind: string; state: string | null; zone: string | null }>;
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
  disclaimer: string;
  reppo: {
    evalId: string;
    status: string | null;
    score: number | null;
    route: string | null;
    decision: string | null;
  } | null;
  createdAt: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "The request failed.");
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
  verdict: (id: string) => json<{ verdict: PublicVerdict }>(`/api/verdict/${id}`),
  feedback: (input: { verdictId: string; kind: "paid" | "fair" | "not-fair"; paidNaira?: number; deviceId: string; demo: boolean }) =>
    json<{ ok: boolean; observation: { id: string; status: string; reason: string | null } | null }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  board: (areaId: string) =>
    json<{
      area: { id: string; name: string; kind: string };
      areas: Catalog["areas"];
      disclaimer: string;
      rows: Array<{
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
      }>;
    }>(`/api/board?areaId=${encodeURIComponent(areaId)}`),
  metrics: (demo: boolean) => json<Metrics>(`/api/metrics?demo=${demo ? "true" : "false"}`),
};

export interface Metrics {
  generatedAt: string;
  demo: boolean;
  disclaimer: string;
  seedOnly: MetricBlock;
  afterFeedback: MetricBlock;
  reppo: Array<{
    evalId: string;
    status: string;
    score: number | null;
    decision: string | null;
    route: string | null;
    reason: string | null;
    creditsCharged: number | null;
    verdictId: string;
    source: string;
  }>;
  livePaidConfirms: number;
  observationCount: number;
}

export interface MetricBlock {
  mode: string;
  agreementRate: number;
  cases: number;
  agreed: number;
  mape: number | null;
  medianReppoScore: number | null;
  reppoCount: number;
  computedAt: string;
  details: Array<{ id: string; predicted: string; expected: string; mid: number | null }>;
}
