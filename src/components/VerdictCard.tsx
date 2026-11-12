import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { api, naira, type PublicVerdict, type ReppoBadge as Badge } from "../api";
import { getDeviceId } from "../device";
import { Mascot } from "./Mascot";

const STAMP: Record<PublicVerdict["label"], string> = {
  fair: "Fair price",
  high: "Too high",
  low: "Suspiciously low",
  uncertain: "Not sure yet",
};

const FALLBACK_NOTE: Record<string, string> = {
  local: "local figures",
  zone: "the zone average",
  national: "the national average",
  none: "no figures yet",
};

function RangeRuler({ v }: { v: PublicVerdict }) {
  const reduce = useReducedMotion();
  if (v.low == null || v.high == null || v.mid == null) {
    return <p className="range-empty">No usual range for this area yet. Your confirmed payment starts one.</p>;
  }
  const lo = Math.min(v.low, v.quoteNaira) * 0.9;
  const hi = Math.max(v.high, v.quoteNaira) * 1.1;
  const pos = (n: number) => `${((n - lo) / (hi - lo)) * 100}%`;
  return (
    <figure className="ruler" aria-label={`Usual range ${naira(v.low)} to ${naira(v.high)}, middle ${naira(v.mid)}. Your quote ${naira(v.quoteNaira)}.`}>
      <div className="ruler-track" aria-hidden="true">
        <span className="ruler-band" style={{ left: pos(v.low), width: `calc(${pos(v.high)} - ${pos(v.low)})` }} />
        <span className="ruler-mid" style={{ left: pos(v.mid) }} />
        <motion.span
          className={`ruler-needle ${v.label}`}
          initial={reduce ? false : { left: pos(v.mid) }}
          animate={{ left: pos(v.quoteNaira) }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 14, delay: 0.15 }}
        >
          <span className="ruler-needle-label">You</span>
        </motion.span>
      </div>
      <figcaption className="ruler-legend">
        <span>
          <i className="ruler-key ruler-key-band" aria-hidden="true" />
          Usual {naira(v.low)} to {naira(v.high)}
        </span>
        <span>
          <i className={`ruler-key ruler-key-you ${v.label}`} aria-hidden="true" />
          You {naira(v.quoteNaira)}
        </span>
      </figcaption>
    </figure>
  );
}

export function ReppoBadge({ reppo, confirmed, demo }: { reppo: Badge | null; confirmed: boolean; demo: boolean }) {
  if (!reppo) {
    if (demo) return null;
    return (
      <p className="reppo reppo-idle">
        <ReppoMark />
        {confirmed ? "Reppo will score this check shortly" : "Confirm what you paid and Reppo scores this check"}
      </p>
    );
  }
  if (reppo.state === "pending") {
    return (
      <p className="reppo reppo-pending" role="status">
        <span className="dot-spinner" aria-hidden="true" />
        Reppo is scoring this check. It takes about a minute
      </p>
    );
  }
  if (reppo.state === "failed") {
    return (
      <p className="reppo reppo-failed">
        <ReppoMark />
        Reppo could not score this check
      </p>
    );
  }
  return (
    <details className="reppo reppo-checked">
      <summary>
        <ReppoMark />
        <span>
          Checked by Reppo
          {reppo.score != null ? <strong className="reppo-score"> {Math.round(reppo.score)}/100</strong> : null}
        </span>
      </summary>
      <dl className="reppo-details">
        {reppo.decision ? (
          <>
            <dt>Decision</dt>
            <dd>{reppo.decision === "accept" ? "Accepted" : reppo.decision === "reject" ? "Not accepted" : reppo.decision}</dd>
          </>
        ) : null}
        {reppo.route ? (
          <>
            <dt>Route</dt>
            <dd>{reppo.route}</dd>
          </>
        ) : null}
        {reppo.reason ? (
          <>
            <dt>Why</dt>
            <dd>{reppo.reason}</dd>
          </>
        ) : null}
        <dt>Eval ID</dt>
        <dd className="mono">{reppo.evalId}</dd>
      </dl>
    </details>
  );
}

function ReppoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4-3 7-7 9c-4-2-7-5-7-9V6z" />
      <path d="M8.5 12l2.5 2.5l4.5-5" />
    </svg>
  );
}

export function VerdictSkeleton() {
  return (
    <motion.article className="verdict verdict-loading card" aria-busy="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="verdict-head">
        <span className="skeleton skeleton-stamp" />
      </div>
      <span className="skeleton skeleton-line wide" />
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-ruler" />
      <p className="muted">Comparing your quote with dated averages and recent confirmed payments</p>
    </motion.article>
  );
}

export function VerdictCard({ verdict, demo, onUpdated }: { verdict: PublicVerdict; demo: boolean; onUpdated?: (v: PublicVerdict) => void }) {
  const reduce = useReducedMotion();
  const ids = useId();
  const [paid, setPaid] = useState(String(Math.round(verdict.quoteNaira)));
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const pollTimer = useRef<number | null>(null);

  // After a live confirmation, poll the verdict until Reppo finishes (about a minute).
  useEffect(() => {
    if (!confirmed || verdict.demo || verdict.reppo?.state !== "pending") return;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const { verdict: next } = await api.verdict(verdict.id);
        onUpdated?.(next);
        if (next.reppo && next.reppo.state !== "pending") return;
      } catch {
        // keep trying quietly
      }
      if (tries < 40) pollTimer.current = window.setTimeout(tick, 5000);
    };
    pollTimer.current = window.setTimeout(tick, 3000);
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [confirmed, verdict.id, verdict.demo, verdict.reppo?.state, onUpdated]);

  async function send(kind: "paid" | "fair" | "not-fair") {
    const amount = Number(paid.replace(/[,\s₦]/g, ""));
    if (kind === "paid" && (!Number.isFinite(amount) || amount <= 0)) {
      setNote({ tone: "warn", text: "Type the amount you paid, in naira" });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const result = await api.feedback({ verdictId: verdict.id, kind, paidNaira: kind === "paid" ? amount : undefined, deviceId: getDeviceId(), demo });
      const status = result.observation?.status;
      if (status === "rejected") setNote({ tone: "warn", text: "You already confirmed this item here today, so this one was not counted" });
      else if (status === "quarantine") setNote({ tone: "warn", text: "That amount is far from what others paid, so it is on hold until more prices agree" });
      else setNote({ tone: "ok", text: kind === "paid" ? "Saved. The next person in your area gets a better range" : "Thanks for the feedback" });
      if (kind === "paid") {
        setConfirmed(true);
        if (result.reppo?.state === "pending") {
          const { verdict: next } = await api.verdict(verdict.id);
          onUpdated?.(next);
        }
      }
    } catch (err) {
      setNote({ tone: "warn", text: err instanceof Error ? err.message : "That did not save. Try again" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.article
      className={`verdict card verdict-${verdict.label}`}
      initial={reduce ? false : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 24 }}
      aria-labelledby={`${ids}-title`}
    >
      <div className="verdict-head">
        <div>
          <motion.p
            className={`stamp stamp-${verdict.label}`}
            initial={reduce ? false : { scale: 1.6, rotate: -14, opacity: 0 }}
            animate={{ scale: 1, rotate: -3, opacity: 1 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 18, delay: 0.1 }}
          >
            {STAMP[verdict.label]}
          </motion.p>
          <h2 id={`${ids}-title`} className="verdict-title">
            <span className="figure">{naira(verdict.quoteNaira)}</span> for {verdict.itemName.toLowerCase()}
          </h2>
          <p className="muted">
            {verdict.areaName}, per {verdict.unit}
          </p>
        </div>
        <Mascot mood={verdict.label} size={104} label={`Ada reacts: ${STAMP[verdict.label]}`} />
      </div>

      <RangeRuler v={verdict} />

      <ul className="reasons">
        {verdict.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      <div className="tip">
        <p className="tip-title">Ada's tip</p>
        <p>{verdict.tip}</p>
      </div>

      {verdict.note ? (
        <aside className="ada-note" aria-label="Ada's note">
          <p className="tip-title">Ada's note</p>
          <p>{verdict.note}</p>
          <p className="ada-note-foot">The verdict above still follows the price range.</p>
        </aside>
      ) : null}

      <ReppoBadge reppo={verdict.reppo} confirmed={confirmed} demo={verdict.demo} />

      <details className="evidence">
        <summary>Where this range comes from</summary>
        <ul>
          <li>
            Based on {verdict.officialCount} official figure{verdict.officialCount === 1 ? "" : "s"} and {verdict.observationCount} confirmed payment
            {verdict.observationCount === 1 ? "" : "s"}, using {FALLBACK_NOTE[verdict.fallback] ?? verdict.fallback}
          </li>
          {verdict.quotes.map((q) => (
            <li key={q}>{q}</li>
          ))}
          <li>
            {verdict.demo
              ? "Demo mode: the verdict uses the code band and seeded data"
              : verdict.servAvailable
                ? "Verdict and tip written by SERV Reasoning, checked against the code band"
                : "SERV Reasoning was unavailable, so this uses the code band only"}
          </li>
        </ul>
      </details>

      <section className="confirm" aria-labelledby={`${ids}-confirm`}>
        <h3 id={`${ids}-confirm`}>Did you buy it</h3>
        <div className="confirm-row">
          <div className="money-input">
            <span aria-hidden="true">₦</span>
            <input
              aria-label="Amount you paid, in naira"
              inputMode="numeric"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              disabled={busy || confirmed}
            />
          </div>
          <button type="button" className="btn btn-leaf" disabled={busy || confirmed} onClick={() => void send("paid")}>
            I paid this
          </button>
        </div>
        {!confirmed ? (
          <div className="quiet-actions">
            <span className="muted">Or just tell Ada:</span>
            <button type="button" className="link-btn" disabled={busy} onClick={() => void send("fair")}>
              Looks fair
            </button>
            <button type="button" className="link-btn" disabled={busy} onClick={() => void send("not-fair")}>
              Looks off
            </button>
          </div>
        ) : null}
        {note ? (
          <p className={`note note-${note.tone}`} role="status">
            {note.text}
          </p>
        ) : null}
      </section>
    </motion.article>
  );
}
