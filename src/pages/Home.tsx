import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { CheckForm, type Preset } from "../components/CheckForm";
import { Mascot, mascotCaptions, type MascotMood } from "../components/Mascot";
import { VerdictCard, VerdictSkeleton } from "../components/VerdictCard";
import type { PublicVerdict } from "../api";

const EXAMPLES: Array<Omit<Preset, "nonce"> & { text: string }> = [
  { itemId: "pms", areaId: "NG-KANO", quote: 1650, text: "Petrol in Kano, ₦1,650 a litre" },
  { itemId: "tomatoes", areaId: "NG-KANO", quote: 1400, text: "Tomatoes in Kano, ₦1,400 a kilo" },
  { itemId: "okada", areaId: "NG-ENUGU", quote: 400, text: "Okada drop in Enugu, ₦400" },
  { itemId: "phone-screen", areaId: "NG-ABUJA", quote: 25000, text: "Phone screen in Abuja, ₦25,000" },
];

export function Home({ demo }: { demo: boolean }) {
  const reduce = useReducedMotion();
  const [verdict, setVerdict] = useState<PublicVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const mood: MascotMood = busy ? "think" : verdict ? verdict.label : "idle";

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <Mascot mood={mood} size={136} />
        <div className="hero-copy">
          <h1 id="hero-title">Is this price fair?</h1>
          <p className="speech" aria-live="polite">{mascotCaptions[mood]}</p>
        </div>
      </section>

      <CheckForm
        demo={demo}
        preset={preset}
        onResult={(v) => {
          setVerdict(v);
          requestAnimationFrame(() => document.getElementById("verdict")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
        }}
        onBusy={setBusy}
        onError={setError}
      />

      <div id="verdict" aria-live="polite">
        <AnimatePresence mode="wait">
          {busy ? (
            <VerdictSkeleton key="loading" />
          ) : error ? (
            <motion.div key="error" className="card state-card error-card" role="alert" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <p className="state-title">That check did not go through</p>
              <p className="muted">{error}</p>
            </motion.div>
          ) : verdict ? (
            <VerdictCard key={verdict.id} verdict={verdict} demo={demo} onUpdated={setVerdict} />
          ) : (
            <motion.section key="empty" className="examples" aria-label="Try an example" initial={false}>
              <h2 className="section-title">Try one</h2>
              <ul>
                {EXAMPLES.map((ex) => (
                  <li key={ex.text}>
                    <button type="button" className="example" onClick={() => setPreset({ ...ex, nonce: Date.now() })}>
                      {ex.text}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
