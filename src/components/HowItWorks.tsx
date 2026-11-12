import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router-dom";

const INK = "#1a1a1a";

function EngineArt() {
  return (
    <svg viewBox="0 0 120 90" width="120" height="90" aria-hidden="true">
      <rect x="8" y="34" width="104" height="24" rx="12" fill="#fff" stroke={INK} strokeWidth="4" />
      <rect x="38" y="34" width="44" height="24" fill="#f5c518" stroke={INK} strokeWidth="4" />
      <line x1="60" y1="38" x2="60" y2="54" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      {[18, 28, 92, 102].map((x) => (
        <line key={x} x1={x} y1="64" x2={x} y2="72" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      ))}
      <circle cx="30" cy="18" r="9" fill="#1f7a32" stroke={INK} strokeWidth="3.5" />
      <circle cx="56" cy="14" r="9" fill="#1f7a32" stroke={INK} strokeWidth="3.5" />
      <circle cx="84" cy="20" r="9" fill="#f08c2e" stroke={INK} strokeWidth="3.5" />
      <path d="M26 18l3 3l5-6M52 14l3 3l5-6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ServArt() {
  return (
    <svg viewBox="0 0 120 90" width="120" height="90" aria-hidden="true">
      <path d="M14 12h80a10 10 0 0 1 10 10v30a10 10 0 0 1-10 10H52l-18 16v-16H14A10 10 0 0 1 4 52V22a10 10 0 0 1 10-10z" fill="#fff" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <line x1="20" y1="28" x2="84" y2="28" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <line x1="20" y1="40" x2="70" y2="40" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <circle cx="100" cy="70" r="14" fill="#f5c518" stroke={INK} strokeWidth="4" />
      <path d="M96 66h8M100 62v16" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

function ReppoArt() {
  return (
    <svg viewBox="0 0 120 90" width="120" height="90" aria-hidden="true">
      <path d="M60 6l34 13v24c0 20-15 34-34 42c-19-8-34-22-34-42V19z" fill="#d7f0dc" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M45 45l11 11l20-22" fill="none" stroke="#1f7a32" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="86" y="58" width="30" height="22" rx="8" fill="#fff" stroke={INK} strokeWidth="3.5" />
      <text x="101" y="74" textAnchor="middle" fontFamily="'Baloo 2', sans-serif" fontWeight="700" fontSize="13" fill={INK}>
        92
      </text>
    </svg>
  );
}

export const STACK = [
  {
    key: "engine",
    step: "1",
    title: "Fair Price engine finds the usual range",
    who: "Our own code",
    body: "It starts from cited public prices for your country, city or region, then mixes in payments people nearby confirmed. Trusted, recent confirmations count more. It never mixes currencies.",
    Art: EngineArt,
    tone: "sun",
  },
  {
    key: "serv",
    step: "2",
    title: "SERV Reasoning explains it",
    who: "OpenServ",
    body: "SERV reads your quote against that range and the local data, then writes why the price looks fair, high or low and a haggling tip. With no local data, it gives a rough guess and says so.",
    Art: ServArt,
    tone: "lagoon",
  },
  {
    key: "reppo",
    step: "3",
    title: "Reppo keeps it honest",
    who: "Reppo Eval Router",
    body: "When you confirm what you paid, Reppo scores the check independently. High scores raise how much that confirmation counts, low scores cut it. The scores are on the Metrics page.",
    Art: ReppoArt,
    tone: "leaf",
  },
] as const;

export function HowItWorks({ compact = false }: { compact?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <section className="how" aria-labelledby="how-title">
      <div className="how-head">
        <h2 id="how-title" className="section-title">
          How it works
        </h2>
        {compact ? (
          <Link to="/how" className="how-more">
            More detail
          </Link>
        ) : null}
      </div>
      <ol className="how-cards">
        {STACK.map(({ key, step, title, who, body, Art, tone }, i) => (
          <motion.li
            key={key}
            className={`how-card how-${tone}`}
            initial={reduce ? false : { y: 16, opacity: 0, rotate: 0 }}
            whileInView={{ y: 0, opacity: 1, rotate: i === 1 ? 0.6 : -0.6 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 20, delay: i * 0.08 }}
          >
            <span className="how-step" aria-hidden="true">
              {step}
            </span>
            <Art />
            <h3>{title}</h3>
            <p className="how-who">{who}</p>
            <p>{body}</p>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

export function HowPage() {
  return (
    <>
      <section className="page-head">
        <div>
          <h1>How Fair Price works</h1>
          <p className="muted">A fair price check for anything, anywhere. Three parts, each with one job</p>
        </div>
      </section>
      <HowItWorks />
      <article className="card how-flow" aria-labelledby="flow-title">
        <h2 id="flow-title" className="section-title">
          What happens to one check
        </h2>
        <ol className="flow">
          <li>
            <strong>You</strong> type an item, a place and the price you were quoted, in your own currency.
          </li>
          <li>
            <strong>Fair Price engine</strong> builds the usual range from cited public prices and confirmed payments for that place. If the city
            has none, it uses the region, then the whole country, and says so. It decides the verdict: fair, too high, suspiciously low, or not
            sure yet.
          </li>
          <li>
            <strong>SERV Reasoning</strong> by OpenServ reads the quote and the range and explains the verdict in plain words, with a haggling
            tip. If SERV disagrees with the range, its view is shown separately as Ada's note and the verdict still follows the range.
          </li>
          <li>
            <strong>You confirm</strong> what you actually paid. Anti-gaming checks hold back duplicates and outliers.
          </li>
          <li>
            <strong>Reppo's Eval Router</strong> scores the confirmed check. A high score raises the trust of that confirmation, a low score or a
            rejection cuts it, and the next person nearby gets a better range. Accuracy before and after confirmations is on the Metrics page.
          </li>
        </ol>
        <p className="muted small">
          Where there is no local data at all, Ada says Not sure yet and shows SERV's rough guess, clearly marked as a guess. Your confirmation
          starts the range for everyone after you.
        </p>
      </article>
    </>
  );
}
