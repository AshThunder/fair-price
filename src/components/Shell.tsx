import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

export function Shell({ demo, onDemo, children }: { demo: boolean; onDemo: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="app-shell">
      {demo ? <div className="demo-banner">Demo mode. Seeded stall data and pre-completed evals. No live credit spend.</div> : null}
      <header className="topbar">
        <Link className="brand" to={demo ? "/?demo=1" : "/"}>
          <svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#F5C518" stroke="#1A1A1A" strokeWidth="4" />
            <circle cx="32" cy="28" r="12" fill="#F6E7C1" stroke="#1A1A1A" strokeWidth="3" />
            <path d="M16 50c4-10 28-10 32 0" fill="#1F4E79" stroke="#1A1A1A" strokeWidth="3" />
            <path d="M20 24c4-8 20-8 24 0" fill="#E23D28" stroke="#1A1A1A" strokeWidth="2.5" />
          </svg>
          <span>
            <h1>Fair Price</h1>
            <small>Stall book for everyday prices</small>
          </span>
        </Link>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/" end>Check</NavLink>
          <NavLink to="/board">Boards</NavLink>
          <NavLink to="/metrics">Metrics</NavLink>
          <button type="button" className="chip" aria-pressed={demo} onClick={() => onDemo(!demo)}>
            {demo ? "Demo on" : "Demo off"}
          </button>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="footer">
        Official anchors are May 2026 averages from the National Bureau of Statistics, not live stall prices. Raw NBS files are not redistributed.
      </footer>
    </div>
  );
}
