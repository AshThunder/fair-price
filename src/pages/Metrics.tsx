import { useEffect, useState } from "react";
import { api, type Metrics } from "../api";
import { Mascot } from "../components/Mascot";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function mape(n: number | null): string {
  return n == null ? "n/a" : `${(n * 100).toFixed(1)}%`;
}

export function MetricsPage({ demo }: { demo: boolean }) {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.metrics(demo).then(setData).catch((err: Error) => setError(err.message));
  }, [demo]);

  return (
    <>
      <section className="hero">
        <Mascot mood="think" compact />
        <div>
          <h2>Does feedback make the stall book better?</h2>
          <p>A fixed held-out benchmark, scored seed-only and again after confirmations. Reppo eval results sit beside the accuracy numbers.</p>
        </div>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {data ? (
        <>
          <div className="metrics-pair">
            <article className="card">
              <h3>Seed only</h3>
              <p className="display" style={{ fontSize: "2.4rem" }}>{pct(data.seedOnly.agreementRate)}</p>
              <p className="hint">Agreement on {data.seedOnly.agreed}/{data.seedOnly.cases} cases. MAPE {mape(data.seedOnly.mape)}.</p>
              <div className="meter" aria-hidden="true"><span style={{ width: pct(data.seedOnly.agreementRate) }} /></div>
            </article>
            <article className="card">
              <h3>After feedback</h3>
              <p className="display" style={{ fontSize: "2.4rem" }}>{pct(data.afterFeedback.agreementRate)}</p>
              <p className="hint">Agreement on {data.afterFeedback.agreed}/{data.afterFeedback.cases} cases. MAPE {mape(data.afterFeedback.mape)}.</p>
              <div className="meter" aria-hidden="true"><span style={{ width: pct(data.afterFeedback.agreementRate) }} /></div>
            </article>
          </div>
          <article className="card">
            <h3>Reppo evals</h3>
            <p className="hint">
              {data.afterFeedback.reppoCount} completed. Median score {data.afterFeedback.medianReppoScore ?? "n/a"}.
              Live paid confirmations are kept separate from this benchmark: {data.livePaidConfirms} so far.
            </p>
            {data.reppo.length === 0 ? <p>No completed evals stored yet. Demo evals appear here once they have been run and saved.</p> : null}
            {data.reppo.map((e) => (
              <div className="metric-row" key={e.evalId}>
                <div>
                  <strong>{e.source} · {e.status}</strong>
                  <div className="hint" style={{ margin: 0 }}>{e.evalId}</div>
                </div>
                <div className="price">
                  Score {e.score ?? "n/a"}
                  <div className="hint" style={{ margin: 0 }}>
                    {e.decision ?? "—"} {e.route ? `via ${e.route}` : ""} {e.creditsCharged != null ? `· ${e.creditsCharged} credits` : ""}
                  </div>
                </div>
              </div>
            ))}
          </article>
          <article className="card">
            <h3>Benchmark cases</h3>
            {data.afterFeedback.details.map((d) => {
              const seed = data.seedOnly.details.find((s) => s.id === d.id);
              return (
                <div className="metric-row" key={d.id}>
                  <div>
                    <strong>{d.id}</strong>
                    <div className="hint" style={{ margin: 0 }}>expected {d.expected}</div>
                  </div>
                  <div className="price">
                    seed {seed?.predicted} → after {d.predicted}
                  </div>
                </div>
              );
            })}
          </article>
          <p className="footnote">{data.disclaimer}</p>
        </>
      ) : null}
    </>
  );
}
