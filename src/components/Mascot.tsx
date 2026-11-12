import React from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

export type MascotMood = "idle" | "think" | "fair" | "high" | "low" | "uncertain";

export const mascotCaptions: Record<MascotMood, string> = {
  idle: "Tell me the price. I'll check it",
  think: "Hold on, I'm checking the price book",
  fair: "Fair price. You can buy",
  high: "Ah, this one is too much",
  low: "So cheap? Check the measure first",
  uncertain: "I don't have enough prices here yet",
};

const INK = "#1a1a1a";
const SKIN = "#8a4b2a";
const SKIN_SHADE = "#6f3a20";
const CHEEK = "#b0603a";
const GELE = "#e23d28";
const GELE_FOLD = "#b82a19";
const SUN = "#f5c518";
const NAVY = "#1f4e79";
const WOOD = "#d98b3a";
const WOOD_DARK = "#a8631f";
const LEAF = "#2f9e44";
const LAGOON = "#1f7a8c";
const CREAM = "#f6e7c1";
const KRAFT = "#e9c98f";

type Pt = [number, number];
const L_SHOULDER: Pt = [80, 166];
const R_SHOULDER: Pt = [160, 166];
const UPPER = 36;
const FORE = 34;

/** Hand target for each pose; angles come from two-bone IK so poses stay readable. */
const HANDS: Record<MascotMood, { left: Pt; right: Pt }> = {
  idle: { left: [66, 206], right: [192, 108] },
  think: { left: [70, 208], right: [126, 146] },
  fair: { left: [66, 206], right: [198, 124] },
  high: { left: [46, 92], right: [194, 92] },
  low: { left: [70, 208], right: [158, 120] },
  uncertain: { left: [26, 142], right: [214, 142] },
};

function ik(shoulder: Pt, target: Pt, bend: 1 | -1): [number, number] {
  const dx = target[0] - shoulder[0];
  const dy = target[1] - shoulder[1];
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(UPPER - FORE) + 1), UPPER + FORE - 0.5);
  const base = Math.atan2(-dx, dy);
  const alpha = Math.acos((UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d));
  const upper = base + bend * alpha;
  const ex = shoulder[0] - UPPER * Math.sin(upper);
  const ey = shoulder[1] + UPPER * Math.cos(upper);
  const fore = Math.atan2(-(target[0] - ex), target[1] - ey);
  const deg = (r: number) => (r * 180) / Math.PI;
  return [deg(upper), deg(fore - upper)];
}

function useSpringNumber(target: number, reduce: boolean, stiffness = 260, damping = 16): number {
  const mv = useMotionValue(target);
  const [value, setValue] = useState(target);
  useMotionValueEvent(mv, "change", (v) => setValue(v));
  useEffect(() => {
    if (reduce) {
      mv.jump(target);
      setValue(target);
      return;
    }
    const controls = animate(mv, target, { type: "spring", stiffness, damping });
    return () => controls.stop();
  }, [target, reduce, mv, stiffness, damping]);
  return value;
}

function Arm({ shoulder, angles, side, children }: { shoulder: Pt; angles: [number, number]; side: "left" | "right"; children?: React.ReactNode }) {
  return (
    <g transform={`translate(${shoulder[0]} ${shoulder[1]}) rotate(${angles[0]})`}>
      <line x1="0" y1="0" x2="0" y2={UPPER} stroke={INK} strokeWidth="22" strokeLinecap="round" />
      <line x1="0" y1="0" x2="0" y2={UPPER} stroke={NAVY} strokeWidth="15" strokeLinecap="round" />
      <g transform={`translate(0 ${UPPER}) rotate(${angles[1]})`}>
        <line x1="0" y1="0" x2="0" y2={FORE} stroke={INK} strokeWidth="18" strokeLinecap="round" />
        <line x1="0" y1="0" x2="0" y2={FORE} stroke={SKIN} strokeWidth="11" strokeLinecap="round" />
        <circle cx="0" cy="-2" r="8" fill={SUN} stroke={INK} strokeWidth="3" />
        <g transform={`translate(0 ${FORE + 4})`}>
          <circle cx="0" cy="0" r="10" fill={SKIN} stroke={INK} strokeWidth="3.5" />
          <path d={side === "left" ? "M-4 -6 q-6 2 -5 8" : "M4 -6 q6 2 5 8"} fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
          <g transform={`rotate(${-(angles[0] + angles[1])})`}>{children}</g>
        </g>
      </g>
    </g>
  );
}

function Eyes({ mood }: { mood: MascotMood }) {
  const white = (cx: number, rx = 8, ry = 9) => <ellipse cx={cx} cy="98" rx={rx} ry={ry} fill="#fff" stroke={INK} strokeWidth="3" />;
  switch (mood) {
    case "fair":
      return (
        <g fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round">
          <path d="M96 100 q8 -10 16 0" />
          <path d="M128 100 q8 -10 16 0" />
        </g>
      );
    case "high":
      return (
        <g>
          {white(104, 10, 12)}
          {white(136, 10, 12)}
          <circle cx="104" cy="98" r="3" fill={INK} />
          <circle cx="136" cy="98" r="3" fill={INK} />
        </g>
      );
    case "low":
      return (
        <g>
          {white(104)}
          {white(136)}
          <circle cx="108" cy="100" r="4.5" fill={INK} />
          <circle cx="140" cy="100" r="4.5" fill={INK} />
          <path d="M95 94 h18 v-5 h-18 z" fill={SKIN} />
          <path d="M95 94 h18" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        </g>
      );
    case "think":
      return (
        <g>
          {white(104)}
          {white(136)}
          <circle cx="107" cy="94" r="4.5" fill={INK} />
          <circle cx="139" cy="94" r="4.5" fill={INK} />
        </g>
      );
    case "uncertain":
      return (
        <g>
          {white(104)}
          {white(136)}
          <circle cx="100" cy="95" r="4.5" fill={INK} />
          <circle cx="132" cy="95" r="4.5" fill={INK} />
        </g>
      );
    default:
      return (
        <g>
          {white(104)}
          {white(136)}
          <circle cx="105" cy="99" r="4.5" fill={INK} />
          <circle cx="137" cy="99" r="4.5" fill={INK} />
          <circle cx="107" cy="96" r="1.6" fill="#fff" />
          <circle cx="139" cy="96" r="1.6" fill="#fff" />
        </g>
      );
  }
}

function Brows({ mood }: { mood: MascotMood }) {
  const p = {
    idle: ["M94 82 q10 -6 20 -1", "M126 81 q10 -5 20 1"],
    think: ["M94 80 q10 -8 20 -2", "M126 84 q10 0 20 2"],
    fair: ["M94 80 q10 -7 20 -2", "M126 78 q10 -5 20 2"],
    high: ["M92 74 q11 -9 22 -3", "M126 71 q11 -6 22 3"],
    low: ["M94 86 q10 0 20 3", "M126 80 q10 -8 20 -4"],
    uncertain: ["M94 84 q10 -7 20 -8", "M126 76 q10 1 20 8"],
  }[mood];
  return (
    <g fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round">
      <path d={p[0]} />
      <path d={p[1]} />
    </g>
  );
}

function Mouth({ mood }: { mood: MascotMood }) {
  switch (mood) {
    case "fair":
      return (
        <g>
          <path d="M104 116 q16 22 32 0 z" fill="#5a1a10" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M107 117 h26 l-2 4 h-22 z" fill="#fff" />
          <path d="M113 126 q7 -5 14 0 q-7 4 -14 0z" fill={GELE} />
        </g>
      );
    case "high":
      return <ellipse cx="120" cy="124" rx="9" ry="11" fill="#5a1a10" stroke={INK} strokeWidth="3.5" />;
    case "low":
      return <path d="M108 122 q10 4 22 -4" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />;
    case "think":
      return <path d="M112 123 q6 -3 12 0 t10 -1" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />;
    case "uncertain":
      return <path d="M106 124 q5 -4 10 0 t10 0 t10 0" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />;
    default:
      return <path d="M106 117 q14 14 28 0" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />;
  }
}

function Extras({ mood }: { mood: MascotMood }) {
  if (mood === "think") {
    return (
      <g className="ada-think-dots" fill="#fff" stroke={INK} strokeWidth="3">
        <circle cx="62" cy="52" r="5" />
        <circle cx="46" cy="34" r="7" />
        <circle cx="26" cy="14" r="10" />
      </g>
    );
  }
  if (mood === "high") {
    return (
      <g>
        <path d="M168 66 q8 12 0 18 q-8 -6 0 -18z" fill="#bfe6ee" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <g stroke={INK} strokeWidth="4" strokeLinecap="round">
          <path d="M28 70 l-10 -6" />
          <path d="M26 86 l-12 0" />
          <path d="M212 70 l10 -6" />
          <path d="M214 86 l12 0" />
        </g>
      </g>
    );
  }
  if (mood === "uncertain") {
    return (
      <text x="190" y="54" fontFamily="'Baloo 2', sans-serif" fontWeight="700" fontSize="44" fill={NAVY} stroke={INK} strokeWidth="2" paintOrder="stroke">
        ?
      </text>
    );
  }
  return null;
}

function HandProp({ mood }: { mood: MascotMood }) {
  if (mood === "fair") {
    // Price tag with a tick
    return (
      <g transform="translate(6 -30) rotate(12)">
        <path d="M0 0 h26 l8 10 l-8 10 h-26 z" fill={KRAFT} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <circle cx="26" cy="10" r="2.5" fill={INK} />
        <path d="M6 10 l5 5 l9 -10" fill="none" stroke={LEAF} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  if (mood === "low") {
    // Magnifying glass held up to the eye
    return (
      <g>
        <line x1="0" y1="0" x2="-10" y2="-18" stroke={INK} strokeWidth="8" strokeLinecap="round" />
        <line x1="0" y1="0" x2="-10" y2="-18" stroke={WOOD} strokeWidth="4" strokeLinecap="round" />
        <circle cx="-20" cy="-34" r="16" fill="#d6eef2" fillOpacity="0.55" stroke={INK} strokeWidth="4" />
        <path d="M-28 -40 q4 -6 10 -6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </g>
    );
  }
  return null;
}

/**
 * Ada, the market trader who keeps the stall book. Flat colours, chunky ink
 * outlines, one pose per verdict. Arms and the body hop use Motion springs;
 * everything snaps without animation when reduced motion is on.
 */
export function Mascot({ mood, size = 168, label }: { mood: MascotMood; size?: number; label?: string }) {
  const reduce = Boolean(useReducedMotion());
  const hands = HANDS[mood];
  const [lu, lf] = ik(L_SHOULDER, hands.left, -1);
  const [ru, rf] = ik(R_SHOULDER, hands.right, 1);
  const angles = {
    lu: useSpringNumber(lu, reduce),
    lf: useSpringNumber(lf, reduce),
    ru: useSpringNumber(ru, reduce),
    rf: useSpringNumber(rf, reduce),
    tilt: useSpringNumber(mood === "uncertain" ? -7 : mood === "think" ? 5 : mood === "low" ? 4 : 0, reduce, 200, 14),
  };

  // One playful hop each time the mood changes, bigger for a shock.
  const hopMv = useMotionValue(0);
  const [hop, setHop] = useState(0);
  useMotionValueEvent(hopMv, "change", (v) => setHop(v));
  useEffect(() => {
    if (reduce) return;
    hopMv.jump(mood === "high" ? -18 : mood === "idle" ? 0 : -8);
    const c = animate(hopMv, 0, { type: "spring", stiffness: 420, damping: 11 });
    return () => c.stop();
  }, [mood, reduce, hopMv]);

  const height = Math.round((size * 260) / 240);
  return (
    <svg
      className={`ada ada-${mood}`}
      viewBox="0 0 240 260"
      width={size}
      height={height}
      role="img"
      aria-label={label ?? `Ada the market trader. ${mascotCaptions[mood]}`}
    >
      <ellipse cx="120" cy="252" rx="96" ry="6" fill={INK} opacity="0.15" />
      <g transform={`translate(0 ${hop})`}>
        {/* Back arm sits behind the body */}
        <Arm shoulder={L_SHOULDER} angles={[angles.lu, angles.lf]} side="left" />
        {/* Torso: navy blouse with sun dots */}
        <path d="M76 164 q44 -20 88 0 l14 60 h-116 z" fill={NAVY} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <g fill={SUN}>
          <circle cx="96" cy="186" r="4" />
          <circle cx="120" cy="198" r="4" />
          <circle cx="144" cy="186" r="4" />
          <circle cx="104" cy="212" r="4" />
          <circle cx="136" cy="212" r="4" />
        </g>
        <path d="M104 160 q16 14 32 0" fill={SKIN_SHADE} stroke={INK} strokeWidth="3.5" />
        {/* Head group tilts */}
        <g transform={`rotate(${angles.tilt} 120 140)`}>
          <rect x="108" y="132" width="24" height="26" rx="8" fill={SKIN} stroke={INK} strokeWidth="3.5" />
          {/* Ears and gold hoops */}
          <circle cx="72" cy="104" r="9" fill={SKIN} stroke={INK} strokeWidth="3.5" />
          <circle cx="168" cy="104" r="9" fill={SKIN} stroke={INK} strokeWidth="3.5" />
          <circle cx="71" cy="120" r="6" fill="none" stroke={INK} strokeWidth="6" />
          <circle cx="71" cy="120" r="6" fill="none" stroke={SUN} strokeWidth="3" />
          <circle cx="169" cy="120" r="6" fill="none" stroke={INK} strokeWidth="6" />
          <circle cx="169" cy="120" r="6" fill="none" stroke={SUN} strokeWidth="3" />
          <ellipse cx="120" cy="102" rx="47" ry="44" fill={SKIN} stroke={INK} strokeWidth="4" />
          <circle cx="94" cy="114" r="7" fill={CHEEK} />
          <circle cx="146" cy="114" r="7" fill={CHEEK} />
          <path d="M118 104 q-4 8 2 10" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <Brows mood={mood} />
          <Eyes mood={mood} />
          <Mouth mood={mood} />
          {/* Gele: big head-tie with pleats and a side fan */}
          <g transform="translate(0 -9)">
          <path d="M66 84 q-6 -46 54 -60 q60 6 56 58 q-24 -18 -56 -18 q-32 0 -54 20 z" fill={GELE} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
          <g fill="none" stroke={GELE_FOLD} strokeWidth="4" strokeLinecap="round">
            <path d="M82 58 q36 -22 76 2" />
            <path d="M88 40 q30 -14 60 0" />
          </g>
          <path d="M150 40 q34 -30 56 -6 q-10 10 -24 8 q10 14 -4 28 q-14 -14 -28 -30z" fill={SUN} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
          <path d="M160 40 q18 -12 34 -4" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M66 84 q54 -34 110 -2" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          </g>
        </g>
        {/* Stall counter with produce */}
        <g>
          <rect x="16" y="214" width="208" height="38" rx="8" fill={WOOD} stroke={INK} strokeWidth="4" />
          <path d="M16 226 h208" stroke={WOOD_DARK} strokeWidth="4" />
          <path d="M60 238 h30 M140 242 h44" stroke={WOOD_DARK} strokeWidth="3" strokeLinecap="round" />
          <g stroke={INK} strokeWidth="3">
            <circle cx="40" cy="206" r="11" fill={GELE} />
            <circle cx="62" cy="208" r="10" fill={GELE} />
            <circle cx="51" cy="192" r="10" fill={GELE} />
          </g>
          <g fill={LEAF} stroke={INK} strokeWidth="2">
            <path d="M37 196 l4 -4 l4 4z" />
            <path d="M59 199 l4 -4 l4 4z" />
            <path d="M48 183 l4 -4 l4 4z" />
          </g>
          <path d="M168 200 q18 -18 38 0 z" fill={CREAM} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <path d="M160 200 h54 q-4 16 -27 16 q-23 0 -27 -16z" fill={LAGOON} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        </g>
        {/* Front arm over the counter */}
        <Arm shoulder={R_SHOULDER} angles={[angles.ru, angles.rf]} side="right">
          <HandProp mood={mood} />
        </Arm>
        <Extras mood={mood} />
      </g>
    </svg>
  );
}
