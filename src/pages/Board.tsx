import { useEffect, useId, useState } from "react";
import { api, CATEGORY_LABEL, naira, type BoardRow, type Catalog } from "../api";
import { Mascot } from "../components/Mascot";

function sourceNote(r: BoardRow): string {
  if (r.mid == null) return "Not enough prices yet";
  const parts: string[] = [];
  if (r.officialCount) parts.push(r.fallback === "national" ? "national average" : r.fallback === "zone" ? "zone average" : "state average");
  if (r.observationCount) parts.push(`${r.observationCount} confirmed`);
  return parts.join(" + ");
}

export function Board({ demo }: { demo: boolean }) {
  const ids = useId();
  const [areaId, setAreaId] = useState("NG-KANO");
  const [data, setData] = useState<{ area: { name: string }; areas: Catalog["areas"]; rows: BoardRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api
      .board(areaId, demo)
      .then((d) => live && setData(d))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [areaId, demo, nonce]);

  const categories = data ? [...new Set(data.rows.map((r) => r.category))] : [];
  const covered = data?.rows.filter((r) => r.mid != null).length ?? 0;

  return (
    <>
      <section className="page-head">
        <div>
          <h1>Price board</h1>
          <p className="muted">Usual prices by area, from dated averages and confirmed payments</p>
        </div>
        <div className="field compact">
          <label htmlFor={`${ids}-area`}>Area</label>
          <select id={`${ids}-area`} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            {(data?.areas ?? [{ id: "NG-KANO", name: "Kano", kind: "state", state: null, zone: null }]).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error ? (
        <div className="card state-card" role="alert">
          <Mascot mood="uncertain" size={96} />
          <p className="state-title">The board did not load</p>
          <p className="muted">{error}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setNonce((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : loading && !data ? (
        <div className="card" aria-busy="true" aria-label="Loading prices">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      ) : data ? (
        <div aria-busy={loading}>
          <p className="muted board-summary">
            {covered} of {data.rows.length} items have a usual price in {data.area.name}
          </p>
          {categories.map((cat) => (
            <section className="card board-group" key={cat} aria-labelledby={`${ids}-${cat}`}>
              <h2 id={`${ids}-${cat}`} className="section-title">
                {CATEGORY_LABEL[cat] ?? cat}
              </h2>
              <ul className="board-list">
                {data.rows
                  .filter((r) => r.category === cat)
                  .map((r) => (
                    <li key={r.itemId} className={r.mid == null ? "board-row empty" : "board-row"}>
                      <div>
                        <p className="board-item">{r.itemName}</p>
                        <p className="muted small">
                          Per {r.unit} · {sourceNote(r)}
                        </p>
                      </div>
                      <div className="board-price">
                        {r.mid != null ? (
                          <>
                            <p className="figure">{naira(r.mid)}</p>
                            <p className="muted small figure">
                              {naira(r.low ?? r.mid)} to {naira(r.high ?? r.mid)}
                            </p>
                          </>
                        ) : (
                          <p className="muted small">Be the first to confirm</p>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}
