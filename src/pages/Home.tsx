import { useState } from "react";
import { CheckForm } from "../components/CheckForm";
import { Mascot, type MascotMood } from "../components/Mascot";
import { VerdictCard } from "../components/VerdictCard";
import type { PublicVerdict } from "../api";

export function Home({ demo }: { demo: boolean }) {
  const [verdict, setVerdict] = useState<PublicVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const mood: MascotMood = busy ? "think" : verdict ? verdict.label : "idle";

  return (
    <>
      <section className="hero">
        <Mascot mood={mood} />
        <div>
          <h2>Is this price fair for your area?</h2>
          <p>Type a quote or snap a stall ticket. Ada checks the stall book and gives you a range, a verdict, and a negotiation tip.</p>
        </div>
      </section>
      <CheckForm demo={demo} onResult={setVerdict} onBusy={setBusy} />
      {verdict ? <VerdictCard verdict={verdict} demo={demo} /> : null}
    </>
  );
}
