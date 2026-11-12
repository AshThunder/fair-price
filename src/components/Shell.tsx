import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

export function BrandMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M6 10 h26 l12 14 l-12 14 h-26 z" fill="#f6e7c1" stroke="#1a1a1a" strokeWidth="3.5" strokeLinejoin="round" />
      <circle cx="33" cy="24" r="3" fill="#1a1a1a" />
      <text x="17" y="31" textAnchor="middle" fontFamily="'Baloo 2', sans-serif" fontWeight="700" fontSize="20" fill="#c8321f">₦</text>
    </svg>
  );
}

export function Shell({ demo, onDemo, children }: { demo: boolean; onDemo: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-row">
          <Link className="brand" to="/" aria-label="Fair Price home">
            <BrandMark />
            <span className="brand-name">Fair Price</span>
          </Link>
          <button
            type="button"
            className="demo-switch"
            role="switch"
            aria-checked={demo}
            onClick={() => onDemo(!demo)}
          >
            <span className="demo-switch-track" aria-hidden="true">
              <span className="demo-switch-thumb" />
            </span>
            Demo
          </button>
        </div>
        <nav className="tabs" aria-label="Primary">
          <NavLink to="/" end>Check</NavLink>
          <NavLink to="/board">Price board</NavLink>
          <NavLink to="/metrics">Metrics</NavLink>
        </nav>
      </header>
      {demo ? (
        <p className="demo-strip" role="status">
          Demo mode uses seeded confirmations and saved Reppo results. Nothing live is spent
        </p>
      ) : null}
      <main id="main">{children}</main>
      <footer className="footer">
        <details>
          <summary>About the data</summary>
          <p>
            Ranges start from dated National Bureau of Statistics averages (food, petrol and fares for May 2026, cooking gas for
            April 2026). They are monthly averages, not live stall or pump prices, and are cited in place without redistributing
            NBS workbooks. Confirmed payments from people nearby move the range over time. SERV Reasoning writes the verdict and
            tip, and Reppo scores checks once a payment is confirmed.
          </p>
        </details>
      </footer>
    </div>
  );
}
