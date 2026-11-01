import { createContext, type CSSProperties, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AgentDef, MascotSpec } from "../types";
import { useGaze } from "../ui/gaze";

/**
 * Plush mascots with a bit of life: a soft, lit body with little feet and a lighter tummy; shiny eyes that blink on
 * their own rhythm and follow the pointer; a mouth (or a beak) and cheeks that show the mood; and a way of moving for
 * each state — hopping while it runs a tool, a thought bubble while it thinks, a happy wiggle when it replied, dozing
 * when silent. It perks up on hover, squashes when booped, and jumps with confetti when a ticket of its own is
 * verified (`cheer`). Members who would look the same (two developers) each get their own colour and a hair clip.
 */

type Part = { d: string; cls?: string };
type Shape = {
  d: string;
  /** Ears, tufts, the frog's eye bumps: drawn in the body's colour and outline. */
  parts?: Part[];
  /** Inner ears: pink, or a darker shade of the body. */
  inner?: (Part & { tone: "pink" | "shade" })[];
  top: number;
  eyeY: number;
  dx: number;
  mouthY: number;
  belly?: [cx: number, cy: number, rx: number, ry: number];
  feet?: false | "orange";
  muzzle?: boolean;
  beak?: boolean;
  /** Pale rings around the eyes (the owl). */
  discs?: boolean;
  whiskers?: boolean;
  /** Where the hair clip goes, when the top-left of the head is not on the body (the frog's eyes, the gumdrop's tip). */
  clip?: [x: number, y: number];
};

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
const ROUND = "M50 26 C74 26 88 42 88 62 C88 80 72 88 50 88 C28 88 12 80 12 62 C12 42 26 26 50 26 Z";

const SHAPES: Record<string, Shape> = {
  cloud: { d: "M24 86 C10 86 6 70 15 63 C7 52 15 38 29 41 C30 27 45 20 56 29 C66 20 84 27 81 43 C93 46 95 66 84 74 C88 82 82 86 76 86 Z", top: 26, eyeY: 60, dx: 11, mouthY: 71 },
  frog: {
    d: "M12 86 C6 70 12 52 26 47 C28 40 34 38 42 40 C46 39 54 39 58 40 C66 38 72 40 74 47 C88 52 94 70 88 86 Z",
    parts: [{ d: circle(35, 38, 13) }, { d: circle(65, 38, 13) }],
    top: 26,
    eyeY: 37,
    dx: 15,
    mouthY: 62,
    belly: [50, 75, 21, 11],
    clip: [50, 43],
  },
  gumdrop: { d: "M50 14 C60 14 80 52 88 72 C92 82 86 88 76 88 L24 88 C14 88 8 82 12 72 C20 52 40 14 50 14 Z", top: 20, eyeY: 62, dx: 13, mouthY: 74, clip: [43, 36] },
  bean: { d: "M16 60 C16 34 30 18 50 18 C70 18 84 34 84 60 L84 74 C84 84 78 88 68 88 L32 88 C22 88 16 84 16 74 Z", top: 19, eyeY: 54, dx: 13, mouthY: 67 },
  dome: { d: "M50 20 C72 20 88 36 88 58 C88 78 72 88 50 88 C28 88 12 78 12 58 C12 36 28 20 50 20 Z", top: 21, eyeY: 56, dx: 13, mouthY: 69 },
  cat: {
    d: ROUND,
    parts: [
      { d: "M15 50 Q13 24 21 13 Q34 17 45 29 Z", cls: "m-ear-l" },
      { d: "M85 50 Q87 24 79 13 Q66 17 55 29 Z", cls: "m-ear-r" },
    ],
    inner: [
      { d: "M21 40 Q20 27 24 20 Q31 23 37 29 Z", cls: "m-ear-l", tone: "pink" },
      { d: "M79 40 Q80 27 76 20 Q69 23 63 29 Z", cls: "m-ear-r", tone: "pink" },
    ],
    top: 27,
    eyeY: 58,
    dx: 14,
    mouthY: 70,
    belly: [50, 79, 16, 8],
    whiskers: true,
  },
  bunny: {
    d: "M50 34 C72 34 86 48 86 64 C86 80 72 88 50 88 C28 88 14 80 14 64 C14 48 28 34 50 34 Z",
    parts: [
      { d: "M30 41 C21 31 21 6 31 4 C41 4 43 28 41 39 Z", cls: "m-ear-l" },
      { d: "M70 41 C79 31 79 6 69 4 C59 4 57 28 59 39 Z", cls: "m-ear-r" },
    ],
    inner: [
      { d: "M31 34 C27 26 27 12 31 10 C35 10 36 24 35 32 Z", cls: "m-ear-l", tone: "pink" },
      { d: "M69 34 C73 26 73 12 69 10 C65 10 64 24 65 32 Z", cls: "m-ear-r", tone: "pink" },
    ],
    top: 34,
    eyeY: 61,
    dx: 13,
    mouthY: 72,
    belly: [50, 81, 15, 7],
  },
  bear: {
    d: "M50 24 C73 24 88 40 88 60 C88 79 72 88 50 88 C28 88 12 79 12 60 C12 40 27 24 50 24 Z",
    parts: [{ d: circle(23, 30, 10.5) }, { d: circle(77, 30, 10.5) }],
    inner: [
      { d: circle(23, 30, 5.5), tone: "shade" },
      { d: circle(77, 30, 5.5), tone: "shade" },
    ],
    top: 24,
    eyeY: 54,
    dx: 13,
    mouthY: 71,
    muzzle: true,
  },
  chick: {
    d: "M50 18 C72 18 86 38 86 60 C86 80 70 88 50 88 C30 88 14 80 14 60 C14 38 28 18 50 18 Z",
    parts: [
      { d: "M47 21 C43 11 47 3 52 5 C50 9 53 12 57 7 C59 14 56 20 53 21 Z", cls: "m-tuft" },
      { d: "M16 55 C6 59 6 73 17 75 Z" },
      { d: "M84 55 C94 59 94 73 83 75 Z" },
    ],
    top: 18,
    eyeY: 52,
    dx: 13,
    mouthY: 63,
    belly: [50, 78, 18, 9],
    feet: "orange",
    beak: true,
  },
  owl: {
    d: ROUND,
    parts: [
      { d: "M16 48 C12 32 14 21 20 14 C25 23 31 28 41 30 Z", cls: "m-ear-l" },
      { d: "M84 48 C88 32 86 21 80 14 C75 23 69 28 59 30 Z", cls: "m-ear-r" },
    ],
    top: 27,
    eyeY: 53,
    dx: 15,
    mouthY: 66,
    belly: [50, 80, 17, 8],
    feet: "orange",
    beak: true,
    discs: true,
  },
  ghost: {
    d: "M14 54 C14 32 28 16 50 16 C72 16 86 32 86 54 L86 82 Q86 90 79 86 Q73 81 68 87 Q62 92 57 86 Q50 80 43 86 Q38 92 32 87 Q27 81 21 86 Q14 90 14 82 Z",
    top: 16,
    eyeY: 48,
    dx: 12,
    mouthY: 60,
    feet: false,
  },
  mochi: { d: "M10 74 C10 52 28 36 50 36 C72 36 90 52 90 74 C90 84 82 88 72 88 L28 88 C18 88 10 84 10 74 Z", top: 36, eyeY: 62, dx: 15, mouthY: 72 },
};

const FALLBACK_COLORS = ["#2f7cf6", "#7ccf3a", "#ffc928", "#ff4fb8", "#ff8a3d", "#22c3ee", "#8b5cf6", "#ff6b7a", "#14b8a6", "#34d399"];
/** Colours for members who would otherwise look like another member: soft, and far from each other. */
const VARIANT_COLORS = ["#ff9f43", "#5b8def", "#f472b6", "#2dd4bf", "#facc15", "#c084fc", "#fb7185", "#a3e635", "#38bdf8", "#f97316", "#818cf8", "#4ade80"];
const TOPPERS = ["flower", "star", "leaf", "heart"];
const HATS = new Set(["beret", "crown", "hardhat"]);
const INK = "#16161a";

/**
 * The mascots the role catalog gave before the animal shapes: a fleet planned then keeps them in its fleet.json, and
 * gets the new look of its role.
 */
const LEGACY: Record<string, MascotSpec> = {
  "bean|#f2b53a|crown": { shape: "chick", color: "#f7b731", eyes: "dots", accessory: "crown" },
  "cloud|#2f7cf6|beret": { shape: "mochi", color: "#4f8cff", eyes: "dots", accessory: "beret" },
  "gumdrop|#ff8a3d|headset": { shape: "cat", color: "#ff8a3d", eyes: "dots", accessory: "headset" },
  "bean|#18c3b0|hardhat": { shape: "bear", color: "#14b8a6", eyes: "dots", accessory: "hardhat" },
  "dome|#a78bfa|glasses": { shape: "owl", color: "#a78bfa", eyes: "googly", accessory: "glasses" },
  "frog|#8fd63a|none": { shape: "frog", color: "#7ccf3a", eyes: "googly", accessory: "none" },
  "dome|#ff5252|magnifier": { shape: "bunny", color: "#ff6b7a", eyes: "dots", accessory: "magnifier" },
  "cloud|#22c3ee|goggles": { shape: "ghost", color: "#38bdf8", eyes: "googly", accessory: "goggles" },
  "heart|#ff3fb4|sunglasses": { shape: "cloud", color: "#ff4fb8", eyes: "dots", accessory: "sunglasses" },
};
/** Shapes no longer drawn, and the one a mascot that still names them gets instead. */
const RETIRED: Record<string, string> = { heart: "cloud" };

export type Look = Required<MascotSpec> & { topper: string };

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function rgb(hex: string) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex: string, to: number, amount: number) {
  const c = rgb(hex).map((v) => Math.round(v + (to - v) * amount));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const distance = (a: string, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
};

export function specOf(agent: AgentDef): Look {
  const h = hash(agent.id);
  const shapes = Object.keys(SHAPES);
  const spec = {
    shape: agent.mascot?.shape ?? shapes[h % shapes.length]!,
    color: agent.mascot?.color ?? FALLBACK_COLORS[h % FALLBACK_COLORS.length]!,
    eyes: agent.mascot?.eyes ?? "dots",
    accessory: agent.mascot?.accessory ?? "none",
  };
  const look = { ...spec, ...LEGACY[`${spec.shape}|${spec.color.toLowerCase()}|${spec.accessory}`], topper: "none" };
  return { ...look, shape: RETIRED[look.shape] ?? look.shape };
}

/**
 * Every member's look in a fleet: its role's mascot, except that members who would look the same (same shape, colour
 * and accessory: two developers, two testers) keep the shape and accessory of their role but each get a colour of
 * their own, as far as can be from every colour in use, and a hair clip.
 */
export function looksOf(agents: AgentDef[]): Map<string, Look> {
  const looks = new Map(agents.filter((a) => a.mascot).map((a) => [a.id, specOf(a)]));
  const used = [...looks.values()].map((l) => l.color);
  const farthest = (from: string[]) => from.reduce((best, c) => (Math.min(...used.map((u) => distance(c, u))) > Math.min(...used.map((u) => distance(best, u))) ? c : best));
  // A member of a custom role has no mascot of its own: a shape nobody has yet, in a colour unlike the others.
  for (const agent of agents.filter((a) => !a.mascot)) {
    const taken = new Set([...looks.values()].map((l) => l.shape));
    const shapes = Object.keys(SHAPES);
    const start = hash(agent.id) % shapes.length;
    const shape = [...shapes.slice(start), ...shapes.slice(0, start)].find((s) => !taken.has(s)) ?? shapes[start]!;
    const color = used.length === 0 ? specOf(agent).color : farthest(FALLBACK_COLORS);
    used.push(color);
    looks.set(agent.id, { ...specOf(agent), shape, color });
  }
  const seen = new Map<string, number>();
  for (const agent of agents) {
    const look = looks.get(agent.id)!;
    const key = `${look.shape}|${look.color}|${look.accessory}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) continue;
    const color = farthest(VARIANT_COLORS);
    used.push(color);
    looks.set(agent.id, { ...look, color, topper: TOPPERS[(n - 1) % TOPPERS.length]! });
  }
  return looks;
}

/** The looks of the fleet on screen, so every mascot of a member is the same wherever it appears. */
export const LooksContext = createContext<Map<string, Look>>(new Map());
export const useLooks = (agents: AgentDef[]) => useMemo(() => looksOf(agents), [agents]);

/** What the face shows: the agent state (lib `agentStatus` kinds) plus the old board's "quiet". */
type Mood = "busy" | "thinking" | "happy" | "calm" | "sleepy" | "off" | "cheer";
function moodOf(kind: string | undefined, cheering: boolean): Mood {
  if (cheering) return "cheer";
  switch (kind) {
    case "running":
      return "busy";
    case "thinking":
      return "thinking";
    case "replied":
      return "happy";
    case "silent":
    case "quiet":
      return "sleepy";
    case "offline":
      return "off";
    default:
      return "calm";
  }
}

function Eyes({ shape, style, mood, disc }: { shape: Shape; style: string; mood: Mood; disc: string }) {
  const { eyeY: y, dx } = shape;
  const xs = [50 - dx, 50 + dx];
  const discs = shape.discs && (
    <g className="m-discs" fill={disc}>
      {xs.map((x) => (
        <circle key={x} cx={x} cy={y} r="11.5" />
      ))}
    </g>
  );
  if (style === "hidden") return null;
  // Closed (asleep, off) or happy arcs (cheering, the "smile" eye style).
  if (mood === "sleepy" || mood === "off") {
    return (
      <g className="m-eyes">
        {discs}
        {xs.map((x) => (
          <path key={x} d={`M${x - 5.5} ${y + 1} Q${x} ${y + 5} ${x + 5.5} ${y + 1}`} stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        ))}
      </g>
    );
  }
  if (mood === "cheer" || style === "smile") {
    return (
      <g className="m-eyes">
        {discs}
        {xs.map((x) => (
          <path key={x} d={`M${x - 5.5} ${y + 2} Q${x} ${y - 5} ${x + 5.5} ${y + 2}`} stroke={INK} strokeWidth="3.2" fill="none" strokeLinecap="round" />
        ))}
      </g>
    );
  }
  if (style === "googly") {
    const r = shape.parts?.length && !shape.discs ? 8.5 : 8;
    return (
      <g className="m-eyes">
        {discs}
        {xs.map((x) => (
          <g key={x} className="m-eye">
            <circle cx={x} cy={y} r={r} fill="#fff" stroke="rgba(0,0,0,.18)" strokeWidth="1" />
            <g className="m-gaze">
              <circle cx={x} cy={y + 0.5} r={r * 0.56} fill={INK} />
              <circle cx={x + 1.9} cy={y - 1.7} r={r * 0.2} fill="#fff" />
              <circle cx={x - 1.6} cy={y + 2.2} r={r * 0.09} fill="#fff" opacity=".8" />
            </g>
          </g>
        ))}
      </g>
    );
  }
  // Big shiny eyes: a dark oval with one large and one small highlight.
  return (
    <g className="m-eyes">
      {discs}
      {xs.map((x) => (
        <g key={x} className="m-eye">
          <g className="m-gaze">
            <ellipse cx={x} cy={y} rx="5" ry="6.6" fill={INK} />
            <ellipse cx={x + 1.6} cy={y - 2.4} rx="1.9" ry="2.3" fill="#fff" />
            <circle cx={x - 1.5} cy={y + 2.7} r="1" fill="#fff" opacity=".75" />
          </g>
        </g>
      ))}
    </g>
  );
}

function Mouth({ shape, mood }: { shape: Shape; mood: Mood }) {
  const y = shape.mouthY;
  if (shape.beak) return <Beak y={y} open={mood === "happy" || mood === "cheer" || mood === "busy"} />;
  switch (mood) {
    case "busy": // concentrating: a small, determined "o"
      return <ellipse className="m-mouth" cx="50" cy={y} rx="2.6" ry="2.2" fill={INK} />;
    case "thinking": // pursed, off to one side
      return <path className="m-mouth" d={`M45 ${y} q2.5 -2 5 0 t5 0`} stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
    case "happy":
      return (
        <g className="m-mouth">
          <path d={`M43 ${y - 1.5} Q50 ${y + 6} 57 ${y - 1.5} Z`} fill={INK} />
          <path d={`M46.5 ${y + 2.2} Q50 ${y + 4.6} 53.5 ${y + 2.2}`} fill="#ff7a8a" />
        </g>
      );
    case "cheer":
      return (
        <g className="m-mouth">
          <path d={`M41 ${y - 3} Q50 ${y + 9} 59 ${y - 3} Z`} fill={INK} />
          <path d={`M45.5 ${y + 2.4} Q50 ${y + 6.4} 54.5 ${y + 2.4}`} fill="#ff7a8a" />
        </g>
      );
    case "sleepy": // a small snoring "o" that breathes
      return <ellipse className="m-mouth m-snore" cx="50" cy={y + 0.5} rx="1.8" ry="1.6" fill={INK} opacity=".8" />;
    case "off":
      return <path className="m-mouth" d={`M46.5 ${y} L53.5 ${y}`} stroke={INK} strokeWidth="2.2" strokeLinecap="round" />;
    default: // a little cat-like "w"
      return <path className="m-mouth" d={`M44.5 ${y - 1} Q47.2 ${y + 2.6} 50 ${y - 0.4} Q52.8 ${y + 2.6} 55.5 ${y - 1}`} stroke={INK} strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
}

function Beak({ y, open }: { y: number; open: boolean }) {
  return open ? (
    <g className="m-mouth" fill="#ff9f1c" stroke="#d9770b" strokeWidth="1.2" strokeLinejoin="round">
      <path d={`M44.5 ${y - 4} L55.5 ${y - 4} L50 ${y + 0.5} Z`} />
      <path d={`M46.5 ${y + 1.8} L53.5 ${y + 1.8} L50 ${y + 5.5} Z`} />
    </g>
  ) : (
    <path className="m-mouth" d={`M44.5 ${y - 3} L55.5 ${y - 3} L50 ${y + 3.5} Z`} fill="#ff9f1c" stroke="#d9770b" strokeWidth="1.2" strokeLinejoin="round" />
  );
}

function Accessory({ kind, shape }: { kind: string; shape: Shape }) {
  const t = shape.top;
  const y = shape.eyeY;
  const dx = shape.dx;
  switch (kind) {
    case "beret":
      return (
        <g className="m-acc">
          <ellipse cx="53" cy={t - 1} rx="27" ry="10.5" fill="#1d1d22" transform={`rotate(-8 53 ${t - 1})`} />
          <ellipse cx="50" cy={t + 3} rx="22" ry="4" fill="#111114" />
          <circle cx="51" cy={t - 12} r="4.5" fill="#1d1d22" />
          <ellipse cx="44" cy={t - 5} rx="9" ry="2.6" fill="rgba(255,255,255,.12)" transform={`rotate(-12 44 ${t - 5})`} />
        </g>
      );
    case "crown":
      return (
        <g className="m-acc m-crown">
          <path d={`M33 ${t + 4} L33 ${t - 11} L41.5 ${t - 3} L50 ${t - 16} L58.5 ${t - 3} L67 ${t - 11} L67 ${t + 4} Z`} fill="#f7c948" stroke="#b7860f" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="50" cy={t - 16} r="2.6" fill="#ff5d73" />
          <circle cx="33" cy={t - 11} r="2.2" fill="#5dd6ff" />
          <circle cx="67" cy={t - 11} r="2.2" fill="#5dd6ff" />
          <rect x="33" y={t} width="34" height="4" fill="#e3ad1f" />
          <path className="m-glint" d={`M40 ${t - 2} l3 -6`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "headset":
      return (
        <g className="m-acc" fill="none" strokeLinecap="round">
          <path d={`M19 ${y - 4} C19 ${t - 14} 81 ${t - 14} 81 ${y - 4}`} stroke="#23232a" strokeWidth="5" />
          <rect x="11" y={y - 12} width="12" height="18" rx="5" fill="#2c2c34" />
          <rect x="77" y={y - 12} width="12" height="18" rx="5" fill="#2c2c34" />
          <path d={`M83 ${y + 5} C84 ${y + 20} 70 ${y + 22} 60 ${y + 20}`} stroke="#23232a" strokeWidth="3" />
          <circle className="m-led" cx="58.5" cy={y + 20} r="3.4" fill="#ff5d73" />
        </g>
      );
    case "hardhat":
      return (
        <g className="m-acc">
          <path d={`M27 ${t + 7} C27 ${t - 15} 73 ${t - 15} 73 ${t + 7} Z`} fill="#ffd23f" />
          <rect x="20" y={t + 4} width="60" height="6" rx="3" fill="#f0b400" />
          <path d={`M50 ${t - 9} L50 ${t + 5}`} stroke="#e6a800" strokeWidth="4" strokeLinecap="round" />
          <path d={`M35 ${t - 2} Q38 ${t - 9} 44 ${t - 10}`} stroke="rgba(255,255,255,.6)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </g>
      );
    case "glasses":
      return (
        <g className="m-acc" fill="none" stroke={INK} strokeWidth="3">
          <circle cx={50 - dx} cy={y} r="10.5" fill="rgba(255,255,255,.12)" />
          <circle cx={50 + dx} cy={y} r="10.5" fill="rgba(255,255,255,.12)" />
          <path d={`M${50 - dx + 10.5} ${y - 1} Q50 ${y - 5} ${50 + dx - 10.5} ${y - 1}`} />
          <path d={`M${50 - dx - 10.5} ${y - 2} L${50 - dx - 18} ${y - 5}`} />
          <path d={`M${50 + dx + 10.5} ${y - 2} L${50 + dx + 18} ${y - 5}`} />
        </g>
      );
    case "sunglasses":
      return (
        <g className="m-acc">
          <ellipse cx={50 - dx} cy={y} rx="11" ry="9" fill="#101014" />
          <ellipse cx={50 + dx} cy={y} rx="11" ry="9" fill="#101014" />
          <path d={`M${50 - dx + 10} ${y - 3} Q50 ${y - 7} ${50 + dx - 10} ${y - 3}`} stroke="#101014" strokeWidth="3" fill="none" />
          <ellipse className="m-glint" cx={50 - dx - 3} cy={y - 3.5} rx="3.5" ry="2" fill="rgba(255,255,255,.4)" />
          <ellipse className="m-glint" cx={50 + dx - 3} cy={y - 3.5} rx="3.5" ry="2" fill="rgba(255,255,255,.4)" />
        </g>
      );
    case "goggles":
      return (
        <g className="m-acc">
          <rect x="12" y={y - 4} width="76" height="7" rx="3.5" fill="#3a3a44" />
          <circle cx={50 - dx} cy={y} r="11" fill="rgba(170,225,255,.4)" stroke="#2b2b33" strokeWidth="3.5" />
          <circle cx={50 + dx} cy={y} r="11" fill="rgba(170,225,255,.4)" stroke="#2b2b33" strokeWidth="3.5" />
          <path d={`M${50 - dx - 5} ${y - 5} l4 -2`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d={`M${50 + dx - 5} ${y - 5} l4 -2`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "magnifier":
      return (
        <g className="m-acc m-lens">
          <path d="M84 80 L93 92" stroke="#5b3a1e" strokeWidth="5" strokeLinecap="round" />
          <circle cx="77" cy="71" r="11" fill="rgba(200,240,255,.35)" stroke="#2b2b33" strokeWidth="3.5" />
          <path d="M71 67 q3 -4 7 -3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case "bowtie":
      return (
        <g className="m-acc">
          <path d="M50 81 L37 74 L37 88 Z" fill="#e11d48" />
          <path d="M50 81 L63 74 L63 88 Z" fill="#e11d48" />
          <circle cx="50" cy="81" r="3.4" fill="#be123c" />
        </g>
      );
    case "bow":
      return (
        <g className="m-acc">
          <ellipse cx="60" cy={t + 1} rx="9" ry="6" fill="#ffe066" transform={`rotate(-25 60 ${t + 1})`} />
          <ellipse cx="76" cy={t + 1} rx="9" ry="6" fill="#ffe066" transform={`rotate(25 76 ${t + 1})`} />
          <circle cx="68" cy={t + 3} r="3.6" fill="#f5c518" />
        </g>
      );
    case "antenna":
      return (
        <g className="m-acc m-antenna">
          <path d={`M50 ${t + 2} Q47 ${t - 6} 50 ${t - 13}`} stroke="#2b2b33" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle className="m-blink" cx="50" cy={t - 15} r="4.5" fill="#f7c948" />
        </g>
      );
    default:
      return null;
  }
}

/** A hair clip that tells apart members who share a role: on the left of the head, clear of hats and ears. */
function Topper({ kind, shape }: { kind: string; shape: Shape }) {
  const [x, y] = shape.clip ?? [50 - shape.dx - 4, shape.top + 12];
  switch (kind) {
    case "flower":
      return (
        <g className="m-topper" transform={`translate(${x} ${y})`}>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={4.2 * Math.cos((a * Math.PI) / 180)} cy={4.2 * Math.sin((a * Math.PI) / 180)} r="3.4" fill="#fff" stroke="rgba(0,0,0,.12)" strokeWidth=".8" />
          ))}
          <circle r="2.6" fill="#ffc928" />
        </g>
      );
    case "star":
      return (
        <path
          className="m-topper"
          transform={`translate(${x} ${y})`}
          d="M0 -7 L2 -2.3 L7 -2.2 L3.1 1 L4.4 6 L0 3.2 L-4.4 6 L-3.1 1 L-7 -2.2 L-2 -2.3 Z"
          fill="#ffd23f"
          stroke="#d4a106"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      );
    case "leaf":
      return (
        <g className="m-topper" transform={`translate(${x} ${y}) rotate(-30)`}>
          <path d="M0 6 C-6 2 -6 -6 0 -9 C6 -6 6 2 0 6 Z" fill="#4ade80" stroke="#15803d" strokeWidth="1.1" />
          <path d="M0 5 L0 -6" stroke="#15803d" strokeWidth="1" strokeLinecap="round" />
        </g>
      );
    case "heart":
      return <path className="m-topper" transform={`translate(${x} ${y})`} d="M0 6 C-4 3 -7 0 -7 -3 C-7 -6 -3 -7 0 -4 C3 -7 7 -6 7 -3 C7 0 4 3 0 6 Z" fill="#ff5d8f" stroke="#e11d48" strokeWidth="1" />;
    default:
      return null;
  }
}

/** Little extras around the body for the state: sparks while it works, a thought bubble, Zzz, confetti. */
function Extras({ shape, mood, big, seed }: { shape: Shape; mood: Mood; big: boolean; seed: number }) {
  if (!big) return null;
  const t = shape.top;
  if (mood === "busy") {
    return (
      <g className="m-sparks" stroke="#ffd36b" strokeWidth="2.6" strokeLinecap="round">
        <path d={`M84 ${t + 2} l6 -5`} />
        <path d={`M88 ${t + 12} l8 -1`} />
        <path d={`M15 ${t + 4} l-6 -5`} />
      </g>
    );
  }
  if (mood === "thinking") {
    return (
      <g className="m-bubble">
        <circle cx="80" cy={t + 4} r="2.4" fill="#fff" />
        <circle cx="86" cy={t - 4} r="3.4" fill="#fff" />
        <g transform={`translate(92 ${t - 17})`}>
          <rect x="-13" y="-8.5" width="26" height="17" rx="8.5" fill="#fff" />
          <circle className="m-dot" cx="-6.5" cy="0" r="2.3" fill="#6b7280" />
          <circle className="m-dot" cx="0" cy="0" r="2.3" fill="#6b7280" />
          <circle className="m-dot" cx="6.5" cy="0" r="2.3" fill="#6b7280" />
        </g>
      </g>
    );
  }
  if (mood === "sleepy") {
    return (
      <g className="m-zzz" fill="currentColor" fontWeight="800">
        <text x="78" y={t + 2} fontSize="11">z</text>
        <text x="85" y={t - 7} fontSize="14">z</text>
        <text x="93" y={t - 18} fontSize="17">Z</text>
      </g>
    );
  }
  if (mood === "cheer") {
    const colors = ["#ffd23f", "#ff5d8f", "#5dd6ff", "#7ee08a", "#b48cff", "#ff9f43"];
    return (
      <g className="m-confetti">
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2 + (seed % 7) * 0.2;
          const r = 34 + ((seed >> i) % 3) * 9;
          const style = { "--cx": `${(Math.cos(a) * r).toFixed(1)}px`, "--cy": `${(Math.sin(a) * r - 18).toFixed(1)}px`, "--cr": `${(i * 47) % 360}deg`, animationDelay: `${(i % 4) * 30}ms` } as CSSProperties;
          return i % 3 === 0 ? <circle key={i} cx="50" cy="45" r="2.6" fill={colors[i % colors.length]} style={style} /> : <rect key={i} x="48.5" y="42" width="3" height="6" rx="1" fill={colors[i % colors.length]} style={style} />;
        })}
      </g>
    );
  }
  return null;
}

interface MascotProps {
  agent: AgentDef;
  /** The agent's state (lib `agentStatus().kind`); none = a still portrait. */
  kind?: string;
  size?: number;
  /** The full figure (state extras like the thought bubble, a finer outline); off for small avatars. */
  fuzzy?: boolean;
  label?: boolean;
  /** A count that rises when the agent has something to celebrate (a ticket of theirs verified): it jumps for joy. */
  cheer?: number;
}

export function Mascot({ agent, kind, size = 40, fuzzy = true, label, cheer }: MascotProps) {
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const spec = useContext(LooksContext).get(agent.id) ?? specOf(agent);
  const shape = SHAPES[spec.shape] ?? SHAPES.dome!;
  const seed = hash(agent.id);
  const [boop, setBoop] = useState(0);
  const [cheering, setCheering] = useState(false);
  const last = useRef(cheer);

  useEffect(() => {
    if (cheer !== undefined && last.current !== undefined && cheer > last.current) {
      setCheering(true);
      const id = setTimeout(() => setCheering(false), 1800);
      last.current = cheer;
      return () => clearTimeout(id);
    }
    last.current = cheer;
  }, [cheer]);

  const mood = moodOf(kind, cheering);
  const awake = mood !== "sleepy" && mood !== "off";
  // The bubble, Zzz and sparks reach past the figure: only where there is room around it (the stage, the drawer).
  const big = size >= 70;
  useGaze(ref, awake && size >= 30 && kind !== undefined);

  const fill = `url(#g${uid})`;
  const outline = mix(spec.color, 0, 0.45);
  const shade = mix(spec.color, 0, 0.28);
  const pale = mix(spec.color, 255, 0.62);
  // Each mascot blinks and breathes on its own rhythm, so a row of them never moves in lockstep.
  const rhythm = {
    "--blink": `${(3.2 + (seed % 37) / 10).toFixed(1)}s`,
    "--blink-delay": `${-((seed >> 3) % 50) / 10}s`,
    "--breath": `${(3.4 + ((seed >> 5) % 12) / 10).toFixed(1)}s`,
    "--sway-delay": `${-((seed >> 7) % 30) / 10}s`,
    "--twitch": `${(5 + (seed % 23) / 10).toFixed(1)}s`,
  } as CSSProperties;
  const body = (
    <>
      {shape.parts?.map((p) => (
        <path key={p.d} d={p.d} className={p.cls} />
      ))}
      <path d={shape.d} />
    </>
  );

  return (
    <svg
      ref={ref}
      className={`mascot s-${spec.shape} m-${kind ?? "still"} mood-${mood}${boop ? " m-boop" : ""}${cheering ? " m-cheer" : ""}`}
      style={rhythm}
      width={size}
      height={size}
      viewBox="-4 -4 108 108"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label ? agent.name : undefined}
      onPointerDown={() => setBoop((n) => n + 1)}
      onAnimationEnd={(e) => e.animationName === "m-boop" && setBoop(0)}
    >
      <defs>
        <radialGradient id={`g${uid}`} cx="34%" cy="28%" r="80%">
          <stop offset="0%" stopColor={mix(spec.color, 255, 0.45)} />
          <stop offset="45%" stopColor={spec.color} />
          <stop offset="100%" stopColor={mix(spec.color, 0, 0.38)} />
        </radialGradient>
        <radialGradient id={`h${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity=".75" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`s${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity=".24" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`d${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity=".32" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`c${uid}`}>{body}</clipPath>
      </defs>

      <ellipse className="m-shadow" cx="50" cy="93.5" rx="31" ry="5.5" fill={`url(#d${uid})`} />
      <g className="m-rig">
        <g className="m-squash">
          {/* Little feet peeking out under the body. */}
          {shape.feet !== false && (
            <g className="m-feet" fill={shape.feet === "orange" ? "#ff9f1c" : shade} stroke={shape.feet === "orange" ? "#d9770b" : outline} strokeWidth="1.6">
              <ellipse cx="36" cy="88.5" rx="7.5" ry="4.2" />
              <ellipse cx="64" cy="88.5" rx="7.5" ry="4.2" />
            </g>
          )}
          {/* A smooth body: a thin darker outline drawn behind the fill, so only its outer edge shows (no seams
              where ears or eye bumps meet the body), then the lit fill. */}
          <g className="m-outline" fill={outline} stroke={outline} strokeWidth={fuzzy ? 2.6 : 3.4} strokeLinejoin="round">
            {body}
          </g>
          <g className="m-body" fill={fill}>
            {body}
          </g>
          {shape.inner?.map((p) => (
            <path key={p.d} d={p.d} className={p.cls} fill={p.tone === "pink" ? "#ffb3c6" : shade} opacity={p.tone === "pink" ? 0.9 : 0.75} />
          ))}
          {/* Light: a soft highlight top-left, a lighter tummy, a shaded belly bottom-right. */}
          <g clipPath={`url(#c${uid})`} pointerEvents="none">
            <ellipse cx="36" cy={shape.top + 14} rx="20" ry="13" fill={`url(#h${uid})`} opacity=".75" />
            {shape.belly && <ellipse cx={shape.belly[0]} cy={shape.belly[1]} rx={shape.belly[2]} ry={shape.belly[3]} fill={pale} opacity=".7" />}
            <ellipse cx="60" cy="94" rx="52" ry="30" fill={`url(#s${uid})`} />
          </g>
          {HATS.has(spec.accessory) && <Accessory kind={spec.accessory} shape={shape} />}
          <Topper kind={spec.topper} shape={shape} />
          <g className="m-face">
            <g className="m-cheeks" fill="#ff8fa3">
              <ellipse cx={50 - shape.dx - 8} cy={shape.mouthY - 2} rx="5.5" ry="3.2" />
              <ellipse cx={50 + shape.dx + 8} cy={shape.mouthY - 2} rx="5.5" ry="3.2" />
            </g>
            {shape.muzzle && (
              <g className="m-muzzle">
                <ellipse cx="50" cy={shape.mouthY - 2.5} rx="10.5" ry="7.5" fill={pale} />
                <path d={`M46.4 ${shape.mouthY - 7} Q50 ${shape.mouthY - 9} 53.6 ${shape.mouthY - 7} Q53 ${shape.mouthY - 3.6} 50 ${shape.mouthY - 3} Q47 ${shape.mouthY - 3.6} 46.4 ${shape.mouthY - 7} Z`} fill={INK} />
              </g>
            )}
            {shape.whiskers && (
              <g className="m-whiskers" stroke={INK} strokeWidth="1.4" strokeLinecap="round" opacity=".45">
                <path d={`M23 ${shape.mouthY - 3} L12 ${shape.mouthY - 5}`} />
                <path d={`M23 ${shape.mouthY} L12 ${shape.mouthY + 1}`} />
                <path d={`M77 ${shape.mouthY - 3} L88 ${shape.mouthY - 5}`} />
                <path d={`M77 ${shape.mouthY} L88 ${shape.mouthY + 1}`} />
              </g>
            )}
            <Eyes shape={shape} style={spec.accessory === "sunglasses" ? "hidden" : spec.eyes} mood={mood} disc={pale} />
            <Mouth shape={shape} mood={mood} />
            {!HATS.has(spec.accessory) && <Accessory kind={spec.accessory} shape={shape} />}
          </g>
          {boop > 0 && big && (
            <path key={boop} className="m-heart" d="M50 14 C46 8 38 10 40 17 C41 21 50 26 50 26 C50 26 59 21 60 17 C62 10 54 8 50 14 Z" fill="#ff5d8f" />
          )}
        </g>
        <Extras shape={shape} mood={mood} big={big && fuzzy} seed={seed} />
      </g>
    </svg>
  );
}
