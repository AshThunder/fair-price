import { useEffect, useId, useState } from "react";
import { api, CATEGORY_LABEL, money, type BoardRow, type Catalog, type CatalogArea } from "../api";
import { Mascot } from "../components/Mascot";
import { perUnit } from "../../shared/geo";

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function sourceNote(r: BoardRow): string {
  if (r.mid == null) return "Not enough prices yet";
  const parts: string[] = [];
  if (r.officialCount) {
    parts.push(r.fallback === "national" ? "national average" : r.fallback === "region" || r.fallback === "zone" ? "regional average" : "local average");
  }
  if (r.observationCount) parts.push(`${r.observationCount} confirmed`);
  return parts.join(" + ");
}

type BoardData = {
  area: { id: string; name: string; country: string; currency: string; locale: string };
  areas: CatalogArea[];
  rows: BoardRow[];
};

export function Board({
  demo,
  catalog,
  country,
  onCountry,
}: {
  demo: boolean;
  catalog: Catalog | null;
  country: string | null;
  onCountry: (code: string) => void;
}) {
  const ids = useId();
  const cc = country ?? "NG";
  const [areaId, setAreaId] = useState<string | null>(null);
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => setAreaId(null), [cc]);

  useEffect(() => {
    if (!country) return;
    let live = true;
    setLoading(true);
    setError(null);
    api
      .board(cc, areaId, demo)
      .then((d) => live && setData(d))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [cc, country, areaId, demo, nonce]);

  const categories = data ? [...new Set(data.rows.map((r) => r.category))] : [];
  const covered = data?.rows.filter((r) => r.mid != null).length ?? 0;
  const fmt = (n: number) => (data ? money(n, data.area.currency, data.area.locale) : String(n));
  const seeded = catalog?.countries.filter((c) => c.seeded) ?? [];
  const rest = catalog?.countries.filter((c) => !c.seeded) ?? [];
  const places = (data?.areas ?? []).filter((a) => a.kind !== "country");

  return (
    <>
      <section className="page-head board-head">
        <div>
          <h1>Price board</h1>
          <p className="muted">Usual prices by place, from cited public figures and confirmed payments</p>
        </div>
        <div className="board-pickers">
          <div className="field compact">
            <label htmlFor={`${ids}-country`}>Country</label>
            <select id={`${ids}-country`} value={cc} onChange={(e) => onCountry(e.target.value)}>
              <optgroup label="With starter prices">
                {seeded.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Everywhere else">
                {rest.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="field compact">
            <label htmlFor={`${ids}-area`}>Place</label>
            <select id={`${ids}-area`} value={areaId ?? ""} onChange={(e) => setAreaId(e.target.value || null)}>
              <option value="">Whole country</option>
              {places.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
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
            {covered} of {data.rows.length} items have a usual price in {data.area.name}, in {data.area.currency}
          </p>
          {data.rows.length === 0 ? (
            <div className="card state-card">
              <Mascot mood="uncertain" size={96} />
              <p className="state-title">Not sure yet, be the first to confirm</p>
              <p className="muted">
                There are no prices for this place yet. Check a price and confirm what you paid, and it shows up here for the next person.
              </p>
            </div>
          ) : null}
          <div className="board-grid">
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
                          {cap(perUnit(r.unit))} · {sourceNote(r)}
                        </p>
                      </div>
                      <div className="board-price">
                        {r.mid != null ? (
                          <>
                            <p className="figure">{fmt(r.mid)}</p>
                            <p className="muted small figure">
                              {fmt(r.low ?? r.mid)} to {fmt(r.high ?? r.mid)}
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
        </div>
      ) : null}
    </>
  );
}
