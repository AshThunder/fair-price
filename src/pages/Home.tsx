import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { money, type Catalog, type PublicVerdict } from "../api";
import { countryOf, itemLabel } from "../catalog";
import { CheckForm, type Preset } from "../components/CheckForm";
import { HowItWorks } from "../components/HowItWorks";
import { Mascot, mascotCaptions, type MascotMood } from "../components/Mascot";
import { VerdictCard, VerdictSkeleton } from "../components/VerdictCard";
import { useWide } from "../useWide";

type Example = Omit<Preset, "nonce">;

// Starter examples per country; each uses an item and place with cited data.
const EXAMPLES: Record<string, Example[]> = {
  NG: [
    { country: "NG", itemId: "pms", place: "Kano", quote: 1650 },
    { country: "NG", itemId: "tomatoes", place: "Kano", quote: 1400 },
    { country: "NG", itemId: "okada", place: "Enugu", quote: 400 },
    { country: "NG", itemId: "phone-screen", place: "Abuja", quote: 25000 },
  ],
  US: [
    { country: "US", itemId: "eggs-dozen", place: "", quote: 4.5 },
    { country: "US", itemId: "pms", place: "", quote: 4.59 },
    { country: "US", itemId: "milk", place: "", quote: 3.2 },
  ],
  GB: [
    { country: "GB", itemId: "pms", place: "Belfast", quote: 1.79 },
    { country: "GB", itemId: "bread-white", place: "", quote: 1.4 },
    { country: "GB", itemId: "eggs-dozen", place: "", quote: 2.6 },
  ],
  IN: [
    { country: "IN", itemId: "pms", place: "Mumbai", quote: 111 },
    { country: "IN", itemId: "lpg-12kg", place: "Delhi", quote: 1250 },
  ],
  KE: [
    { country: "KE", itemId: "pms", place: "Nairobi", quote: 240 },
    { country: "KE", itemId: "sugar", place: "", quote: 160 },
  ],
  BR: [
    { country: "BR", itemId: "pms", place: "Manaus", quote: 7.49 },
    { country: "BR", itemId: "lpg-12kg", place: "", quote: 115 },
  ],
};

function exampleText(catalog: Catalog, ex: Example): string {
  const item = catalog.items.find((i) => i.id === ex.itemId);
  const c = countryOf(catalog, ex.country);
  const where = ex.place || c.name;
  return `${item ? itemLabel(item, ex.country) : ex.itemId} in ${where}, ${money(ex.quote, c.currency, c.locale)}`;
}

export function Home({
  demo,
  catalog,
  catalogError,
  onRetry,
  country,
  onCountry,
}: {
  demo: boolean;
  catalog: Catalog | null;
  catalogError: string | null;
  onRetry: () => void;
  country: string;
  onCountry: (code: string) => void;
}) {
  const reduce = useReducedMotion();
  const wide = useWide();
  const [verdict, setVerdict] = useState<PublicVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const mood: MascotMood = busy ? "think" : verdict ? verdict.label : "idle";
  const local = EXAMPLES[country];
  const examples = local ?? [EXAMPLES.KE[0], EXAMPLES.GB[0], EXAMPLES.US[0], EXAMPLES.NG[0]];

  return (
    <>
      <div className="check-layout">
        <section className="ada-stage" aria-labelledby="hero-title">
          <Mascot mood={mood} size={wide ? 230 : 136} />
          <div className="hero-copy">
            <h1 id="hero-title">Is this price fair?</h1>
            <p className="lede">A fair price check for anything, anywhere</p>
            <p className="speech" aria-live="polite">
              {mascotCaptions[mood]}
            </p>
          </div>
        </section>

        <div className="check-left">
          {catalogError ? (
            <div className="card state-card" role="alert">
              <p className="state-title">The price list did not load</p>
              <p className="muted">{catalogError}</p>
              <button type="button" className="btn btn-ghost" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : !catalog ? (
            <div className="card form-grid" aria-busy="true" aria-label="Loading the price list">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton-field">
                  <span className="skeleton skeleton-label" />
                  <span className="skeleton skeleton-input" />
                </div>
              ))}
              <span className="skeleton skeleton-button" />
            </div>
          ) : (
            <CheckForm
              catalog={catalog}
              country={country}
              onCountry={onCountry}
              demo={demo}
              preset={preset}
              onResult={(v) => {
                setVerdict(v);
                if (!wide) {
                  requestAnimationFrame(() =>
                    document.getElementById("verdict")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }),
                  );
                }
              }}
              onBusy={setBusy}
              onError={setError}
            />
          )}
        </div>

        <div id="verdict" className="check-right" aria-live="polite">
          <AnimatePresence mode="wait">
            {busy ? (
              <VerdictSkeleton key="loading" />
            ) : error ? (
              <motion.div key="error" className="card state-card error-card" role="alert" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <p className="state-title">That check did not go through</p>
                <p className="muted">{error}</p>
              </motion.div>
            ) : verdict ? (
              <VerdictCard key={verdict.id} verdict={verdict} demo={demo} onUpdated={setVerdict} showMascot={!wide} />
            ) : catalog ? (
              <motion.section key="empty" className="examples card" aria-label="Try an example" initial={false}>
                <h2 className="section-title">Try one</h2>
                {!local ? (
                  <p className="muted small examples-note">
                    No starter prices for {countryOf(catalog, country).name} yet. Type anything above and Ada gives a rough guess, or try one of
                    these.
                  </p>
                ) : null}
                <ul>
                  {examples.map((ex) => (
                    <li key={`${ex.country}-${ex.itemId}-${ex.place}`}>
                      <button
                        type="button"
                        className="example"
                        onClick={() => {
                          if (ex.country !== country) onCountry(ex.country);
                          setPreset({ ...ex, nonce: Date.now() });
                        }}
                      >
                        {exampleText(catalog, ex)}
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.section>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <HowItWorks compact />
    </>
  );
}
