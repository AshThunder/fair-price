import { money as fmtMoney } from "../shared/geo";

export interface CountryOption {
  code: string;
  name: string;
  currency: string;
  locale: string;
  units: "metric" | "imperial";
  seeded: boolean;
  unitOptions: string[];
}

export interface CatalogItem {
  id: string;
  name: string;
  unit: string;
  category: string;
  names?: Record<string, string>;
  units?: Record<string, string>;
  aliases?: string[];
  /** Countries with a cited figure for this item. */
  countries?: string[];
}

export interface CatalogArea {
  id: string;
  name: string;
  kind: "country" | "region" | "city";
  country: string;
  currency: string;
  parentId?: string | null;
  aliases?: string[];
}

export interface Catalog {
  disclaimer: string;
  countries: CountryOption[];
  items: CatalogItem[];
  areas: CatalogArea[];
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
  custom: boolean;
  areaId: string;
  areaName: string;
  country: string;
  countryName: string;
  currency: string;
  locale: string;
  guess: { low: number; high: number } | null;
  quote: number;
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
  note: string | null;
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
    byCountry: Record<
      string,
      {
        currency: string;
        crossSource: number;
        control: number;
        seedOnly: ScoreBlock;
        afterFeedback: ScoreBlock;
        testSeedOnly: ScoreBlock;
        testAfterFeedback: ScoreBlock;
      }
    >;
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
      quote: number;
      expected: string;
      seedOnly: string;
      afterFeedback: string;
    }>;
  };
  reppo: {
    completed: number;
    medianScore: number | null;
    dailyCap: number;
    trustEffects?: { boosted: number; reduced: number; unchanged: number };
    evals: Array<{
      evalId: string;
      status: string;
      score: number | null;
      decision: string | null;
      route: string | null;
      reason: string | null;
      creditsCharged: number | null;
      latencyMs: number | null;
      trustEffect?: string | null;
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
    itemId?: string;
    itemText?: string;
    unit?: string;
    areaId?: string;
    country: string;
    place?: string;
    quote: number;
    deviceId: string;
    demo: boolean;
    source: "typed" | "photo-confirmed";
  }) => json<{ verdict: PublicVerdict }>("/api/check", { method: "POST", body: JSON.stringify(input) }),
  verdict: (id: string) => json<{ verdict: PublicVerdict }>(`/api/verdict/${encodeURIComponent(id)}`),
  feedback: (input: { verdictId: string; kind: "paid" | "fair" | "not-fair"; paid?: number; deviceId: string; demo: boolean }) =>
    json<{
      ok: boolean;
      observation: { id: string; status: string; reason: string | null } | null;
      reppo: { state: string } | null;
    }>("/api/feedback", { method: "POST", body: JSON.stringify(input) }),
  board: (country: string, areaId: string | null, demo: boolean) =>
    json<{
      area: { id: string; name: string; kind: string; country: string; currency: string; locale: string };
      areas: CatalogArea[];
      rows: BoardRow[];
    }>(`/api/board?country=${encodeURIComponent(country)}${areaId ? `&areaId=${encodeURIComponent(areaId)}` : ""}&demo=${demo ? "1" : "0"}`),
  metrics: (demo: boolean) => json<Metrics>(`/api/metrics?demo=${demo ? "1" : "0"}`),
};

export function money(n: number, currency: string, locale?: string): string {
  return fmtMoney(n, currency, locale);
}

export const CATEGORY_LABEL: Record<string, string> = {
  food: "Food",
  fuel: "Fuel and gas",
  transport: "Transport fares",
  repair: "Repairs",
  rent: "Rent",
  service: "Services",
  other: "Other",
};
