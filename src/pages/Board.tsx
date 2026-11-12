import { useEffect, useState } from "react";
import { api } from "../api";
import { Mascot } from "../components/Mascot";

function grainLabel(fallback: string, official: number, confirms: number): string {
  const grain = fallback === "local" ? "state figure" : fallback === "zone" ? "zonal average" : fallback === "national" ? "national average" : "no official grain";
  return `${official} official, ${confirms} confirms, ${grain}`;
}

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

export function Board() {
  const [areaId, setAreaId] = useState("NG-KANO");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.board>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    void api.board(areaId).then(setData).catch((err: Error) => setError(err.message));
  }, [areaId]);

  return (
    <>
      <section className="hero">
        <Mascot mood="idle" compact />
        <div>
          <h2>Area price boards</h2>
          <p>Midpoints and ranges from dated official anchors plus accepted confirmations.</p>
        </div>
      </section>
      <div className="card">
        <label>
          <span>Area</span>
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            {(data?.areas ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {data?.rows.map((row) => (
        <article className="board-row" key={row.itemId}>
          <div>
            <strong>{row.itemName}</strong>
            <div className="hint" style={{ margin: 0 }}>per {row.unit}</div>
          </div>
          <div className="price">
            {row.mid == null ? "Not enough evidence" : `${naira(row.mid)}  (${naira(row.low ?? 0)}–${naira(row.high ?? 0)})`}
            <div className="hint" style={{ margin: 0 }}>
              {grainLabel(row.fallback, row.officialCount, row.observationCount)}
            </div>
          </div>
        </article>
      ))}
      {data ? <p className="footnote">{data.disclaimer}</p> : null}
    </>
  );
}
