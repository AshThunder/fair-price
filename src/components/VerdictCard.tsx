import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { PublicVerdict } from "../api";
import { api } from "../api";
import { getDeviceId } from "../device";
import { Mascot, type MascotMood } from "./Mascot";

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

export function VerdictCard({ verdict, demo, onUpdated }: { verdict: PublicVerdict; demo: boolean; onUpdated?: (v: PublicVerdict) => void }) {
  const reduce = useReducedMotion();
  const [paid, setPaid] = useState(String(Math.round(verdict.quoteNaira)));
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mood: MascotMood = verdict.label;

  const min = Math.min(verdict.quoteNaira, verdict.low ?? verdict.quoteNaira, verdict.high ?? verdict.quoteNaira, verdict.mid ?? verdict.quoteNaira);
  const max = Math.max(verdict.quoteNaira, verdict.low ?? verdict.quoteNaira, verdict.high ?? verdict.quoteNaira, verdict.mid ?? verdict.quoteNaira);
  const span = Math.max(1, max - min);
  const pos = (n: number) => ((n - min) / span) * 100;

  async function send(kind: "paid" | "fair" | "not-fair") {
    setBusy(true);
    setNote(null);
    try {
      const result = await api.feedback({
        verdictId: verdict.id,
        kind,
        paidNaira: kind === "paid" ? Number(paid) : undefined,
        deviceId: getDeviceId(),
        demo,
      });
      if (result.observation?.status === "rejected") setNote("This confirmation was ignored because the same device already sent a similar price today.");
      else if (result.observation?.status === "quarantine") setNote("This confirmation was quarantined as an outlier until more nearby prices agree.");
      else setNote(kind === "paid" ? "Saved. Thank you — this helps the next person in your area." : "Saved. Thank you.");
      onUpdated?.(verdict);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Feedback could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.article
      className={`verdict ${verdict.label}`}
      initial={reduce ? false : { y: 24, scale: 0.96, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 20 }}
    >
      <div className="verdict-head">
        <Mascot mood={mood} compact />
        <div>
          <span className={`stamp ${verdict.label}`}>{verdict.label}</span>
          <h2 style={{ marginTop: 10 }}>
            {naira(verdict.quoteNaira)} for {verdict.itemName}
          </h2>
          <p className="hint" style={{ marginTop: 6 }}>
            {verdict.areaName}, per {verdict.unit}
          </p>
        </div>
      </div>

      {verdict.low != null && verdict.high != null ? (
        <div className="range">
          <div className="range-track" aria-hidden="true">
            <span className="range-band" style={{ left: `${pos(verdict.low)}%`, width: `${pos(verdict.high) - pos(verdict.low)}%` }} />
            <span className="range-needle" style={{ left: `${pos(verdict.quoteNaira)}%` }} />
          </div>
          <div className="figures">
            <span>{naira(verdict.low)}</span>
            <span>{verdict.mid != null ? `Mid ${naira(verdict.mid)}` : ""}</span>
            <span>{naira(verdict.high)}</span>
          </div>
        </div>
      ) : (
        <p className="hint">No tight local range yet for this item in this area.</p>
      )}

      <ul className="reasons">
        {verdict.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {verdict.quotes.length ? (
        <ul className="reasons">
          {verdict.quotes.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      ) : null}

      <p className="tip"><strong>Negotiation tip. </strong>{verdict.tip}</p>

      {!verdict.servAvailable && !verdict.demo ? (
        <p className="footnote">The judgment service was unavailable, so this result uses the local price band only{verdict.servError ? ` (${verdict.servError})` : "."}</p>
      ) : null}
      {verdict.reppo ? (
        <p className="footnote">
          Reppo eval {verdict.reppo.evalId}: {verdict.reppo.status}
          {verdict.reppo.score != null ? `, score ${verdict.reppo.score}` : ""}
          {verdict.reppo.decision ? `, ${verdict.reppo.decision}` : ""}
          {verdict.reppo.route ? ` via ${verdict.reppo.route}` : ""}.
        </p>
      ) : null}

      <div className="form-grid" style={{ marginTop: 16 }}>
        <label>
          <span>Confirm what you paid, in naira</span>
          <input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
        </label>
        <motion.button type="button" className="btn btn-leaf btn-lg" disabled={busy} whileTap={reduce ? undefined : { scale: 0.96 }} onClick={() => send("paid")}>
          I paid this
        </motion.button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => send("fair")}>Looks fair</button>
          <button type="button" className="btn" disabled={busy} onClick={() => send("not-fair")}>Looks off</button>
        </div>
        {note ? <p className="hint">{note}</p> : null}
      </div>
      <p className="footnote">{verdict.disclaimer}</p>
    </motion.article>
  );
}
