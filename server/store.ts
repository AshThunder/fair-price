import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  FeedbackRecord,
  Observation,
  ReppoRecord,
  SeedFile,
  StoredVerdict,
} from "../shared/types.js";
import { ROOT } from "./env.js";

export interface RuntimeState {
  observations: Observation[];
  verdicts: StoredVerdict[];
  feedback: FeedbackRecord[];
  reppo: ReppoRecord[];
}

const seed: SeedFile = JSON.parse(readFileSync(join(ROOT, "data/seed.json"), "utf8")) as SeedFile;

const demoStamp = "2026-11-01T09:00:00.000Z";
const seededObs: Observation[] = seed.demoObservations.map((o, i) => ({
  ...o,
  createdAt: o.createdAt ?? new Date(Date.parse(demoStamp) + i * 3600_000).toISOString(),
  tag: o.tag ?? "demo",
}));

const memory: RuntimeState = { observations: [], verdicts: [], feedback: [], reppo: [] };

function runtimePaths(): string[] {
  return [join(ROOT, "data/runtime.json"), "/tmp/fair-price-runtime.json"];
}

function loadRuntime(): RuntimeState {
  for (const path of runtimePaths()) {
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeState;
        memory.observations = parsed.observations ?? [];
        memory.verdicts = parsed.verdicts ?? [];
        memory.feedback = parsed.feedback ?? [];
        memory.reppo = parsed.reppo ?? [];
        return memory;
      }
    } catch {
      // Fall through to the next path or to a fresh memory store.
    }
  }
  return memory;
}

let persistable: string | null = null;

function tryPersist(): void {
  const payload = JSON.stringify(memory, null, 2);
  const paths = persistable ? [persistable, ...runtimePaths()] : runtimePaths();
  for (const path of paths) {
    try {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, payload);
      persistable = path;
      return;
    } catch {
      // Vercel and similar hosts may have a read-only app filesystem.
    }
  }
}

loadRuntime();

export function getSeed(): SeedFile {
  return seed;
}

export function allObservations(): Observation[] {
  return [...seededObs, ...memory.observations];
}

export function liveObservations(): Observation[] {
  return memory.observations;
}

export function allVerdicts(): StoredVerdict[] {
  return memory.verdicts;
}

export function allFeedback(): FeedbackRecord[] {
  return memory.feedback;
}

export function allReppo(): ReppoRecord[] {
  return memory.reppo;
}

export function getVerdict(id: string): StoredVerdict | undefined {
  return memory.verdicts.find((v) => v.id === id);
}

export function addVerdict(v: StoredVerdict): StoredVerdict {
  memory.verdicts.unshift(v);
  tryPersist();
  return v;
}

export function updateVerdict(id: string, patch: Partial<StoredVerdict>): StoredVerdict | undefined {
  const v = getVerdict(id);
  if (!v) return undefined;
  Object.assign(v, patch);
  tryPersist();
  return v;
}

export function addObservation(o: Omit<Observation, "id" | "createdAt"> & { id?: string; createdAt?: string }): Observation {
  const row: Observation = {
    ...o,
    id: o.id ?? `obs-${randomUUID()}`,
    createdAt: o.createdAt ?? new Date().toISOString(),
  };
  memory.observations.unshift(row);
  tryPersist();
  return row;
}

export function addFeedback(f: Omit<FeedbackRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }): FeedbackRecord {
  const row: FeedbackRecord = {
    ...f,
    id: f.id ?? `fb-${randomUUID()}`,
    createdAt: f.createdAt ?? new Date().toISOString(),
  };
  memory.feedback.unshift(row);
  tryPersist();
  return row;
}

export function addReppo(r: ReppoRecord): ReppoRecord {
  const existing = memory.reppo.find((x) => x.evalId === r.evalId);
  if (existing) {
    Object.assign(existing, r);
    tryPersist();
    return existing;
  }
  memory.reppo.unshift(r);
  tryPersist();
  return r;
}

export function loadDemoEvals(): ReppoRecord[] {
  const path = join(ROOT, "data/demo-evals.json");
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { evals?: ReppoRecord[] };
    return raw.evals ?? [];
  } catch {
    return [];
  }
}
