import { useEffect, useState } from "react";
import { api, CATEGORY_LABEL, type Metrics, type ScoreBlock } from "../api";
import { Mascot } from "../components/Mascot";

const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${Math.round(n * 100)}%`);

function Meter({ value, tone }: { value: number; tone: "seed" | "after" }) {
  return (
    <span className={`meter meter-${tone}`} aria-hidden="true">
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

function ScoreRow({ label, block }: { label: string; block: { seedOnly: ScoreBlock; afterFeedback: ScoreBlock } }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="figure">{block.seedOnly.cases}</td>
      <td className="figure">{pct(block.seedOnly.accuracy)}</td>
      <td className="figure">{pct(block.afterFeedback.accuracy)}</td>
      <td className="figure">
        {Math.round(block.seedOnly.coverage * 100)}→{pct(block.afterFeedback.coverage)}
      </td>
    </tr>
  );
}

export function MetricsPage({ demo }: { demo: boolean }) {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setError(null);
    api.metrics(demo).then(setData).catch((err: Error) => setError(err.message));
  }, [demo, nonce]);

  if (error) {
    return (
      <div className="card state-card" role="alert">
        <Mascot mood="uncertain" size={96} />
        <p className="state-title">Metrics did not load</p>
        <p className="muted">{error}</p>
        <button type="button" className="btn btn-ghost" onClick={() => setNonce((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card" aria-busy="true" aria-label="Loading metrics">
        <span className="skeleton skeleton-line wide" />
        <span className="skeleton skeleton-ruler" />
        <span className="skeleton skeleton-ruler" />
      </div>
    );
  }

  const b = data.benchmark;
  const test = b.splits.test;
  const live = data.reppo.evals.filter((e) => e.source === "live");

  return (
    <>
      <section className="page-head">
        <div>
          <h1>Does feedback help?</h1>
          <p className="muted">
            {b.totalCases} price cases in {Object.keys(b.byCountry).length} countries, each with a cited reference price. Scored on a held-out
            test split the engine was never tuned on
          </p>
        </div>
      </section>

      <article className="card headline-metric" aria-labelledby="m-test">
        <h2 id="m-test" className="section-title">
          Held-out test split, {test.seedOnly.cases} cases
        </h2>
        <div className="metric-bars">
          <div>
            <p className="muted small">Public figures only</p>
            <p className="big-figure">{pct(test.seedOnly.accuracy)}</p>
            <Meter value={test.seedOnly.accuracy} tone="seed" />
            <p className="muted small">
              {test.seedOnly.correct} of {test.seedOnly.cases} right, answers {pct(test.seedOnly.coverage)} of cases
            </p>
          </div>
          <div>
            <p className="muted small">After confirmed payments</p>
            <p className="big-figure accent">{pct(test.afterFeedback.accuracy)}</p>
            <Meter value={test.afterFeedback.accuracy} tone="after" />
            <p className="muted small">
              {test.afterFeedback.correct} of {test.afterFeedback.cases} right, answers {pct(test.afterFeedback.coverage)} of cases
            </p>
          </div>
        </div>
        <p className="muted small">
          Confirmations are simulated from each reference price, never from the quotes, and pass through the real anti-gaming gate:{" "}
          {b.feedback.accepted} accepted, {b.feedback.quarantined} outliers held, {b.feedback.rejected} duplicates refused, {b.feedback.pairs - b.feedback.coveredPairs} of{" "}
          {b.feedback.pairs} item and area pairs left with no confirmations at all
        </p>
      </article>

      <article className="card" aria-labelledby="m-country">
        <h2 id="m-country" className="section-title">By country</h2>
        <div className="table-wrap">
          <table className="metric-table">
            <thead>
              <tr>
                <th scope="col">Country</th>
                <th scope="col">Cases</th>
                <th scope="col">Cross-source</th>
                <th scope="col">Seed only</th>
                <th scope="col">After</th>
                <th scope="col">Test after</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(b.byCountry).map(([cc, row]) => (
                <tr key={cc}>
                  <th scope="row">
                    {cc} <span className="muted small">{row.currency}</span>
                  </th>
                  <td className="figure">{row.seedOnly.cases}</td>
                  <td className="figure">{row.crossSource}</td>
                  <td className="figure">{pct(row.seedOnly.accuracy)}</td>
                  <td className="figure">{pct(row.afterFeedback.accuracy)}</td>
                  <td className="figure">
                    {pct(row.testAfterFeedback.accuracy)} <span className="muted small">of {row.testAfterFeedback.cases}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Control cases reuse the same figure the seed holds, so they only test the range maths and are easy. Cross-source cases compare against a
          different publication or a town with no seed figure. Outside Nigeria most cases are controls or close anchors, so treat those 100%
          scores as a sanity check, not proof
        </p>
      </article>

      <article className="card" aria-labelledby="m-splits">
        <h2 id="m-splits" className="section-title">By split and category</h2>
        <div className="table-wrap">
          <table className="metric-table">
            <thead>
              <tr>
                <th scope="col">Set</th>
                <th scope="col">Cases</th>
                <th scope="col">Seed only</th>
                <th scope="col">After</th>
                <th scope="col">Answered</th>
              </tr>
            </thead>
            <tbody>
              <ScoreRow label="Test" block={b.splits.test} />
              <ScoreRow label="Dev" block={b.splits.dev} />
              <ScoreRow label="All" block={b.splits.all} />
              {Object.entries(b.byCategory).map(([cat, block]) => (
                <ScoreRow key={cat} label={CATEGORY_LABEL[cat] ?? cat} block={block} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          A wrong answer and a "not sure yet" both count as misses. Answered shows how often the engine commits to fair, high or low
        </p>
      </article>

      <article className="card" aria-labelledby="m-reppo">
        <h2 id="m-reppo" className="section-title">Reppo scores on real checks</h2>
        <p className="muted small">
          Each confirmed payment on a live check is sent to the Reppo Eval Router with its evidence. {data.reppo.completed} scored so far, median{" "}
          {data.reppo.medianScore ?? "n/a"}. Capped at {data.reppo.dailyCap} evals a day
        </p>
        {data.reppo.trustEffects ? (
          <p className="trust-effects">
            <span className="tag tag-live">{data.reppo.trustEffects.boosted} boosted</span>
            <span className="tag tag-demo">{data.reppo.trustEffects.unchanged} unchanged</span>
            <span className="tag tag-reduced">{data.reppo.trustEffects.reduced} reduced</span>
            <span className="muted small">
              Score 85 or more raises that confirmation's trust by 15%. A rejection or a score under 60 halves it
            </span>
          </p>
        ) : null}
        {data.reppo.evals.length === 0 ? (
          <p className="empty-line">No checks scored yet. Confirm a payment on a live check to send the first one</p>
        ) : (
          <ul className="eval-list">
            {data.reppo.evals.map((e) => (
              <li key={e.evalId} className="eval-row">
                <div>
                  <p className="board-item">
                    {e.score != null ? `${Math.round(e.score)}/100` : e.status.toLowerCase()}
                    <span className={`tag tag-${e.source}`}>{e.source === "live" ? "Live" : "Demo"}</span>
                  </p>
                  <p className="muted small">
                    {[
                      e.decision === "accept" ? "Accepted" : e.decision === "reject" ? "Not accepted" : null,
                      e.route ? `route ${e.route}` : null,
                      e.latencyMs ? `${Math.round(e.latencyMs / 1000)} s` : null,
                      e.creditsCharged ? `${e.creditsCharged} credits` : null,
                      e.trustEffect ? `trust ${e.trustEffect}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mono small">{e.evalId}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Live so far: {data.live.checks} checks, {data.live.paidConfirms} payments confirmed, {data.live.acceptedConfirms} counted,{" "}
          {data.live.quarantined} held as outliers, {data.live.rejected} refused as duplicates
        </p>
        {live.length === 0 && demo ? <p className="muted small">Demo mode shows two saved evals from earlier real runs</p> : null}
      </article>

      <details className="card method">
        <summary>How the benchmark is built</summary>
        <p>{b.labelRule}</p>
        <ul>
          {b.method.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <h3>Sources</h3>
        <ul className="sources">
          {b.sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
              <span className="muted small"> {s.note}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className="card method">
        <summary>All {b.totalCases} cases</summary>
        <div className="table-wrap">
          <table className="metric-table cases">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Split</th>
                <th scope="col">Truth</th>
                <th scope="col">Seed</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {b.results.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="mono small">{r.id.replace(/^bm-/, "")}</th>
                  <td>{r.split}</td>
                  <td>{r.expected}</td>
                  <td className={r.seedOnly === r.expected ? "hit" : "miss"}>{r.seedOnly}</td>
                  <td className={r.afterFeedback === r.expected ? "hit" : "miss"}>{r.afterFeedback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
