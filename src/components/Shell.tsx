import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

export function BrandMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M6 10 h26 l12 14 l-12 14 h-26 z" fill="#f6e7c1" stroke="#1a1a1a" strokeWidth="3.5" strokeLinejoin="round" />
      <circle cx="33" cy="24" r="3" fill="#1a1a1a" />
      <path d="M11 24.5l5 5l9-10" fill="none" stroke="#1f7a32" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
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
          <NavLink to="/board">Board</NavLink>
          <NavLink to="/how">How it works</NavLink>
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
            Starter ranges come from dated, cited public figures: national statistics offices (NBS Nigeria, US BLS, UK ONS, KNBS
            Kenya), fuel regulators and price surveys (EPRA, ANP, RAC, oil marketing companies in India) and dated press reports.
            They are national, regional or city averages, not live stall or pump prices, and every amount stays in its own
            currency. Confirmed payments from people nearby move the range over time. The Fair Price engine sets the range and
            verdict, SERV Reasoning by OpenServ explains it, and Reppo's Eval Router scores each confirmed check.
          </p>
        </details>
      </footer>
    </div>
  );
}
