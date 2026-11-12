import { motion, useReducedMotion } from "motion/react";

export type MascotMood = "idle" | "fair" | "high" | "low" | "uncertain" | "think";

const captions: Record<MascotMood, string> = {
  idle: "Ada keeps the stall book. Ask her about a price.",
  think: "Ada is checking the stall book.",
  fair: "Ada nods. That sits in the day's range.",
  high: "Ada throws both hands up. Ask them to come down.",
  low: "Ada leans in. Check the measure before you pay.",
  uncertain: "Ada shrugs. The stall book is still thin here.",
};

export function Mascot({ mood, compact = false }: { mood: MascotMood; compact?: boolean }) {
  const reduce = useReducedMotion();
  const bounce = reduce
    ? { type: "tween" as const, duration: 0 }
    : { type: "spring" as const, stiffness: 420, damping: 16 };
  const y = mood === "high" ? -8 : mood === "fair" ? -3 : mood === "low" ? 4 : 0;

  return (
    <figure className="mascot" style={{ margin: 0 }}>
      <motion.div
        animate={{ y, rotate: mood === "high" ? -6 : mood === "low" ? 4 : 0 }}
        transition={bounce}
        aria-hidden="true"
      >
        <svg viewBox="0 0 200 220" width={compact ? 120 : 160} height={compact ? 132 : 176} role="img">
          <title>Ada the market trader</title>
          <ellipse cx="100" cy="208" rx="58" ry="8" fill="#1A1A1A" opacity="0.18" />
          {/* wrapper cloth */}
          <path d="M48 118c8 52 96 52 104 0c-2 44-20 78-52 86c-32-8-50-42-52-86z" fill="#1F4E79" stroke="#1A1A1A" strokeWidth="4" />
          <path d="M70 150h60v8H70z" fill="#F5C518" stroke="#1A1A1A" strokeWidth="3" />
          {/* arms */}
          <path d={armPath(mood, "left")} fill="#F3C7A3" stroke="#1A1A1A" strokeWidth="4" strokeLinejoin="round" />
          <path d={armPath(mood, "right")} fill="#F3C7A3" stroke="#1A1A1A" strokeWidth="4" strokeLinejoin="round" />
          {/* neck and face */}
          <rect x="88" y="96" width="24" height="22" rx="8" fill="#F3C7A3" stroke="#1A1A1A" strokeWidth="3" />
          <circle cx="100" cy="72" r="40" fill="#F3C7A3" stroke="#1A1A1A" strokeWidth="4" />
          {/* gele */}
          <path d="M62 64c6-34 70-34 76 0c-8-16-24-24-38-24S70 48 62 64z" fill="#E23D28" stroke="#1A1A1A" strokeWidth="4" />
          <path d="M148 58c12-4 24 10 14 22c-6 6-16 4-20-2c-2-8 0-16 6-20z" fill="#F5C518" stroke="#1A1A1A" strokeWidth="3" />
          <circle cx="100" cy="46" r="7" fill="#F5C518" stroke="#1A1A1A" strokeWidth="3" />
          {/* face details */}
          {eyes(mood)}
          {mouth(mood)}
          <path d="M80 70c-6 8-6 16 0 18" fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round" />
          <path d="M120 70c6 8 6 16 0 18" fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round" />
          {/* beads */}
          <circle cx="90" cy="112" r="5" fill="#F08C2E" stroke="#1A1A1A" strokeWidth="2.5" />
          <circle cx="100" cy="116" r="5" fill="#2F9E44" stroke="#1A1A1A" strokeWidth="2.5" />
          <circle cx="110" cy="112" r="5" fill="#F5C518" stroke="#1A1A1A" strokeWidth="2.5" />
        </svg>
      </motion.div>
      {compact ? null : <figcaption className="hint">{captions[mood]}</figcaption>}
    </figure>
  );
}

function armPath(mood: MascotMood, side: "left" | "right"): string {
  if (mood === "high") {
    return side === "left" ? "M62 128c-28-40-36-44-40-28c4 2 16 18 22 36z" : "M138 128c28-40 36-44 40-28c-4 2-16 18-22 36z";
  }
  if (mood === "low") {
    return side === "left" ? "M64 132c-24 18-20 36-8 38c8-2 16-16 18-30z" : "M136 132c24 18 20 36 8 38c-8-2-16-16-18-30z";
  }
  if (mood === "uncertain") {
    return side === "left" ? "M62 128c-30-8-32 16-18 22c8 2 20-8 24-20z" : "M138 128c22-28 40-16 34 0c-4 10-18 16-28 14z";
  }
  return side === "left" ? "M64 130c-26 6-28 28-14 32c10 0 20-14 22-28z" : "M136 130c26 6 28 28 14 32c-10 0-20-14-22-28z";
}

function eyes(mood: MascotMood) {
  if (mood === "high") {
    return (
      <>
        <path d="M82 68l12 6l-12 6" fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round" />
        <path d="M118 68l-12 6l12 6" fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round" />
      </>
    );
  }
  if (mood === "uncertain") {
    return (
      <>
        <ellipse cx="86" cy="74" rx="6" ry="8" fill="#1A1A1A" />
        <ellipse cx="114" cy="74" rx="6" ry="8" fill="#1A1A1A" />
        <circle cx="88" cy="72" r="2" fill="#fff" />
        <circle cx="116" cy="72" r="2" fill="#fff" />
      </>
    );
  }
  return (
    <>
      <circle cx="86" cy="74" r="7" fill="#1A1A1A" />
      <circle cx="114" cy="74" r="7" fill="#1A1A1A" />
      <circle cx="88" cy="72" r="2.2" fill="#fff" />
      <circle cx="116" cy="72" r="2.2" fill="#fff" />
    </>
  );
}

function mouth(mood: MascotMood) {
  if (mood === "fair") return <path d="M86 90c8 12 20 12 28 0" fill="none" stroke="#1A1A1A" strokeWidth="3.5" strokeLinecap="round" />;
  if (mood === "high") return <ellipse cx="100" cy="94" rx="10" ry="8" fill="#1A1A1A" />;
  if (mood === "low") return <path d="M88 96c8-8 16-8 24 0" fill="none" stroke="#1A1A1A" strokeWidth="3.5" strokeLinecap="round" />;
  if (mood === "uncertain") return <line x1="90" y1="94" x2="110" y2="94" stroke="#1A1A1A" strokeWidth="3.5" strokeLinecap="round" />;
  if (mood === "think") return <path d="M90 92c6 8 14 8 20 0" fill="none" stroke="#1A1A1A" strokeWidth="3.5" strokeLinecap="round" />;
  return <path d="M88 90c8 10 16 10 24 0" fill="none" stroke="#1A1A1A" strokeWidth="3.5" strokeLinecap="round" />;
}

export { captions as mascotCaptions };
